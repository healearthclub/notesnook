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
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, randomBytes } from "@noble/hashes/utils.js";
import { base64urlnopad } from "@scure/base";

export const BACKUP_FORMAT_VERSION = 1;
export const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;

const KEY_BYTES = 32;
const NONCE_BYTES = 24;
const TAG_BYTES = 16;
const KEY_HEADER_BYTES = 4 + 4 + KEY_BYTES + NONCE_BYTES;
const SNAPSHOT_HEADER_BYTES = 4 + 4 + 4 + NONCE_BYTES;
const RECOVERY_PREFIX = "ohai1_";
const KEY_MAGIC = ascii("OHK1");
const SNAPSHOT_MAGIC = ascii("OHB1");
const WRAP_CONTEXT = ascii("ohai/cloud-backup/v1/vault-key");
const ACCOUNT_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export type KeyEnvelope = {
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  keyVersion: number;
  envelope: string;
};

export type SnapshotContext = {
  accountId: string;
  keyVersion: number;
  payloadVersion: number;
};

export function generateRecoveryKey(): string {
  const secret = randomBytes(KEY_BYTES);
  try {
    return RECOVERY_PREFIX + base64urlnopad.encode(secret);
  } finally {
    secret.fill(0);
  }
}

export function generateVaultKey(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

export function wrapVaultKey(
  accountId: string,
  keyVersion: number,
  recoveryKey: string,
  vaultKey: Uint8Array
): KeyEnvelope {
  assertVaultKey(vaultKey);
  const salt = randomBytes(KEY_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const header = concatBytes(KEY_MAGIC, versionBytes(keyVersion), salt, nonce);
  const aad = associatedData(header, accountId);
  const key = deriveWrappingKey(recoveryKey, salt);
  try {
    const ciphertext = xchacha20poly1305(key, nonce, aad).encrypt(vaultKey);
    return {
      formatVersion: BACKUP_FORMAT_VERSION,
      keyVersion,
      envelope: base64urlnopad.encode(concatBytes(header, ciphertext))
    };
  } finally {
    key.fill(0);
  }
}

export function unwrapVaultKey(
  accountId: string,
  recoveryKey: string,
  envelope: KeyEnvelope
): Uint8Array {
  if (envelope.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error("Unsupported key envelope format.");
  }
  const size = KEY_HEADER_BYTES + KEY_BYTES + TAG_BYTES;
  const bytes = decodeBase64url(envelope.envelope, size);
  const header = bytes.subarray(0, KEY_HEADER_BYTES);
  const keyPrefix = concatBytes(KEY_MAGIC, versionBytes(envelope.keyVersion));
  assertPrefix(header, keyPrefix);
  const aad = associatedData(header, accountId);
  const salt = header.subarray(8, 8 + KEY_BYTES);
  const nonce = header.subarray(8 + KEY_BYTES);
  const key = deriveWrappingKey(recoveryKey, salt);
  try {
    return xchacha20poly1305(key, nonce, aad).decrypt(
      bytes.subarray(KEY_HEADER_BYTES)
    );
  } finally {
    key.fill(0);
  }
}

export function encryptSnapshot(
  context: SnapshotContext,
  vaultKey: Uint8Array,
  archive: Uint8Array
): Uint8Array {
  assertVaultKey(vaultKey);
  const size = SNAPSHOT_HEADER_BYTES + archive.length + TAG_BYTES;
  assertSnapshotSize(size);
  const nonce = randomBytes(NONCE_BYTES);
  const header = concatBytes(snapshotPrefix(context), nonce);
  const result = new Uint8Array(size);
  result.set(header);
  xchacha20poly1305(
    vaultKey,
    nonce,
    associatedData(header, context.accountId)
  ).encrypt(archive, result.subarray(SNAPSHOT_HEADER_BYTES));
  return result;
}

export function decryptSnapshot(
  context: SnapshotContext,
  vaultKey: Uint8Array,
  snapshot: Uint8Array
): Uint8Array {
  assertVaultKey(vaultKey);
  assertSnapshotSize(snapshot.length);
  const header = snapshot.subarray(0, SNAPSHOT_HEADER_BYTES);
  assertPrefix(header, snapshotPrefix(context));
  const nonce = header.subarray(12);
  return xchacha20poly1305(
    vaultKey,
    nonce,
    associatedData(header, context.accountId)
  ).decrypt(snapshot.subarray(SNAPSHOT_HEADER_BYTES));
}

export function snapshotUploadMetadata(
  context: SnapshotContext,
  deviceId: string,
  snapshot: Uint8Array
) {
  assertSnapshotSize(snapshot.length);
  assertPrefix(snapshot, snapshotPrefix(context));
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    keyVersion: context.keyVersion,
    sizeBytes: snapshot.length,
    sha256: bytesToHex(sha256(snapshot)),
    deviceId
  };
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

function associatedData(header: Uint8Array, accountId: string): Uint8Array {
  if (!ACCOUNT_ID.test(accountId))
    throw new Error("Invalid backup account ID.");
  return concatBytes(header, ascii(accountId));
}

function decodeBase64url(text: string, size: number): Uint8Array {
  if (text.length !== Math.ceil((size * 8) / 6)) {
    throw new Error("Invalid backup key or envelope.");
  }
  const bytes = base64urlnopad.decode(text);
  if (bytes.length !== size) throw new Error("Invalid backup key or envelope.");
  return bytes;
}

function deriveWrappingKey(recoveryKey: string, salt: Uint8Array): Uint8Array {
  if (!recoveryKey.startsWith(RECOVERY_PREFIX)) {
    throw new Error("Unsupported recovery key format.");
  }
  const secret = decodeBase64url(
    recoveryKey.slice(RECOVERY_PREFIX.length),
    KEY_BYTES
  );
  try {
    return hkdf(sha256, secret, salt, WRAP_CONTEXT, KEY_BYTES);
  } finally {
    secret.fill(0);
  }
}

function versionBytes(version: number): Uint8Array {
  if (!Number.isInteger(version) || version < 1 || version > 0xffffffff) {
    throw new Error("Invalid backup version.");
  }
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, version, false);
  return bytes;
}

function snapshotPrefix(context: SnapshotContext): Uint8Array {
  return concatBytes(
    SNAPSHOT_MAGIC,
    versionBytes(context.keyVersion),
    versionBytes(context.payloadVersion)
  );
}

function assertVaultKey(key: Uint8Array) {
  if (key.length !== KEY_BYTES) throw new Error("Invalid vault key length.");
}

function assertSnapshotSize(size: number) {
  if (size < SNAPSHOT_HEADER_BYTES + TAG_BYTES || size > MAX_SNAPSHOT_BYTES) {
    throw new Error("Snapshot is outside the supported size range.");
  }
}

function assertPrefix(bytes: Uint8Array, prefix: Uint8Array) {
  if (prefix.some((byte, index) => bytes[index] !== byte)) {
    throw new Error("Invalid backup format or version.");
  }
}
