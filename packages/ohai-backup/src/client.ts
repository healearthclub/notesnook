/*
This file is part of the Notesnook project (https://notesnook.com/)

Copyright (C) 2023 Streetwriters (Private) Limited

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
import {
  BACKUP_FORMAT_VERSION,
  MAX_SNAPSHOT_BYTES,
  decryptSnapshot,
  encryptSnapshot,
  snapshotUploadMetadata,
  type KeyEnvelope,
  type SnapshotContext
} from "./index.js";

export type BackupAccount = {
  accountId: string;
  deviceId: string;
  email: string | null;
  displayName: string | null;
  backupOptIn: boolean;
  paused: boolean;
};

export type BackupEntitlement = {
  provider: string | null;
  uploadAllowed: boolean;
  downloadAllowed: boolean;
  uploadUntil: number | null;
  downloadUntil: number | null;
  storageBytes: number;
  snapshotLimit: number;
  maxSnapshotBytes: number;
  backupOptIn: boolean;
  paused: boolean;
};

export type BackupRecord = ReturnType<typeof snapshotUploadMetadata> & {
  id: string;
  status: "reserved" | "uploaded" | "committed" | "deleting";
  reservedAt: number;
  committedAt: number | null;
};

type PreparedBackup = {
  idempotencyKey: string;
  metadata: ReturnType<typeof snapshotUploadMetadata>;
  ciphertext: Uint8Array;
};

export class BackupApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(`Backup request failed (${status}, ${code}).`);
  }
}

/**
 * Prepare once and reuse the same encrypted bytes and request ID on retries.
 * The caller owns the ciphertext and must retain it until commit succeeds.
 */
export function prepareBackup(
  context: SnapshotContext,
  deviceId: string,
  idempotencyKey: string,
  vaultKey: Uint8Array,
  archive: Uint8Array
): PreparedBackup {
  const ciphertext = encryptSnapshot(context, vaultKey, archive);
  return {
    idempotencyKey,
    metadata: snapshotUploadMetadata(context, deviceId, ciphertext),
    ciphertext
  };
}

/**
 * The web client uses its same-origin session cookie. Native clients can
 * supply an access token and handle refresh in the existing auth layer.
 */
export class BackupClient {
  constructor(
    private readonly origin: string,
    private readonly getAccessToken?: () => Promise<string>,
    private readonly fetcher: typeof fetch = (input, init) =>
      globalThis.fetch(input, init)
  ) {
    const url = new URL(origin);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (
      url.origin !== origin ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && local))
    ) {
      throw new Error("Invalid backup service origin.");
    }
  }

  account(): Promise<BackupAccount> {
    return this.json("/v1/me");
  }

  async signOut(): Promise<void> {
    await this.request("/auth/sign-out", { method: "POST" });
  }

  entitlement(): Promise<BackupEntitlement> {
    return this.json("/v1/entitlement");
  }

  keyEnvelope(): Promise<KeyEnvelope> {
    return this.json("/v1/vault/key-envelope");
  }

  updateKeyEnvelope(envelope: KeyEnvelope, previousKeyVersion: number) {
    return this.json<KeyEnvelope>("/v1/vault/key-envelope", "PUT", {
      ...envelope,
      previousKeyVersion
    });
  }

  async setBackupEnabled(enabled: boolean): Promise<void> {
    await this.request("/v1/device/backup", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled })
    });
  }

  async setAccountPaused(paused: boolean): Promise<void> {
    await this.request("/v1/vault/pause", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused })
    });
  }

  async listBackups(): Promise<BackupRecord[]> {
    const { backups } = await this.json<{ backups: BackupRecord[] }>(
      "/v1/backups"
    );
    return backups;
  }

  async upload(backup: PreparedBackup): Promise<BackupRecord> {
    const { metadata, idempotencyKey, ciphertext } = backup;
    let record = await this.json<BackupRecord>(
      "/v1/backups",
      "POST",
      metadata,
      {
        "Idempotency-Key": idempotencyKey
      }
    );
    assertMatchingBackup(record, metadata);
    const id = record.id;
    const path = `/v1/backups/${encodeURIComponent(id)}`;
    if (record.status === "reserved") {
      const response = await this.request(`${path}/content`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: ciphertext
      });
      record = (await response.json()) as BackupRecord;
      assertMatchingBackup(record, metadata, id);
    }
    if (record.status === "uploaded") {
      record = await this.json<BackupRecord>(`${path}/commit`, "POST");
      assertMatchingBackup(record, metadata, id);
    }
    if (record.status !== "committed") {
      throw new Error("Backup service did not commit this snapshot.");
    }
    return record;
  }

  async deleteBackup(id: string): Promise<void> {
    await this.request(`/v1/backups/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
  }

  async revokeDevice(id: string): Promise<void> {
    await this.request(`/v1/devices/${encodeURIComponent(id)}/revoke`, {
      method: "POST"
    });
  }

  async requestAccountDeletion(): Promise<void> {
    await this.request("/v1/account/deletion", { method: "POST" });
  }

  async downloadAndDecrypt(
    record: BackupRecord,
    context: SnapshotContext,
    vaultKey: Uint8Array
  ): Promise<Uint8Array> {
    if (
      record.status !== "committed" ||
      record.formatVersion !== BACKUP_FORMAT_VERSION ||
      record.keyVersion !== context.keyVersion ||
      !Number.isSafeInteger(record.sizeBytes) ||
      record.sizeBytes < 1 ||
      record.sizeBytes > MAX_SNAPSHOT_BYTES ||
      !/^[a-f0-9]{64}$/.test(record.sha256)
    ) {
      throw new Error("Invalid snapshot metadata.");
    }
    const path = `/v1/backups/${encodeURIComponent(record.id)}/content`;
    const response = await this.request(path);
    if (
      response.headers.get("content-length") !== String(record.sizeBytes) ||
      response.headers.get("x-ohai-sha256") !== record.sha256
    ) {
      throw new Error("Backup download does not match the snapshot metadata.");
    }
    const snapshot = new Uint8Array(await response.arrayBuffer());
    const metadata = snapshotUploadMetadata(context, record.deviceId, snapshot);
    if (
      metadata.sizeBytes !== record.sizeBytes ||
      metadata.sha256 !== record.sha256
    ) {
      throw new Error("Backup download failed its checksum.");
    }
    return decryptSnapshot(context, vaultKey, snapshot);
  }

  private async json<T>(
    path: string,
    method = "GET",
    body?: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<T> {
    const response = await this.request(path, {
      method,
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return (await response.json()) as T;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    const token = await this.getAccessToken?.();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await this.fetcher(`${this.origin}${path}`, {
      ...init,
      headers,
      redirect: "error",
      credentials: this.getAccessToken ? "omit" : "same-origin"
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      const code = payload?.error;
      throw new BackupApiError(
        response.status,
        typeof code === "string" && /^[A-Z_]{1,64}$/.test(code)
          ? code
          : "HTTP_ERROR"
      );
    }
    return response;
  }
}

function assertMatchingBackup(
  record: BackupRecord,
  expected: ReturnType<typeof snapshotUploadMetadata>,
  id?: string
) {
  if (
    typeof record.id !== "string" ||
    (id !== undefined && record.id !== id) ||
    record.deviceId !== expected.deviceId ||
    record.sizeBytes !== expected.sizeBytes ||
    record.sha256 !== expected.sha256 ||
    record.formatVersion !== expected.formatVersion ||
    record.keyVersion !== expected.keyVersion
  ) {
    throw new Error("Backup service returned a different snapshot.");
  }
}
