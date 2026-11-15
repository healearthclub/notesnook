import {
  activeUpload,
  FORMAT_VERSION,
  MAX_SNAPSHOT_BYTES,
  requireDownload,
  requireUpload,
  SNAPSHOT_LIMIT
} from "./accounts";
import { activeSession, type Session } from "./auth";
import { type Env, fail, json, readJson, toHex, uuid } from "./http";

const RESERVATION_MS = 30 * 60 * 1000;
const UPLOAD_TIMEOUT_MS = 90_000;
const UPLOAD_LEASE_MS = 120_000;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RESERVATIONS_PER_WINDOW = 12;
const CHECKSUM = /^[0-9a-f]{64}$/;
const OBJECT_PREFIX = "snapshot/";
const selectBackup = `
  SELECT id, device_id AS deviceId, object_key AS objectKey, size_bytes AS sizeBytes,
         sha256, format_version AS formatVersion, key_version AS keyVersion,
         status, reserved_at AS reservedAt, committed_at AS committedAt, expires_at AS expiresAt
  FROM backups`;

type Status = "reserved" | "uploaded" | "committed" | "deleting" | "deleted";
interface Backup {
  id: string;
  deviceId: string;
  objectKey: string;
  sizeBytes: number;
  sha256: string;
  formatVersion: number;
  keyVersion: number;
  status: Status;
  reservedAt: number;
  committedAt: number | null;
  expiresAt: number;
}

function publicBackup(backup: Backup) {
  const {
    id,
    deviceId,
    sizeBytes,
    sha256,
    formatVersion,
    keyVersion,
    status,
    reservedAt,
    committedAt
  } = backup;
  return {
    id,
    deviceId,
    sizeBytes,
    sha256,
    formatVersion,
    keyVersion,
    status,
    reservedAt,
    committedAt
  };
}

async function findBackup(env: Env, session: Session, id: string) {
  const backup = await env.DB.prepare(
    `${selectBackup} WHERE account_id = ? AND id = ?`
  )
    .bind(session.accountId, id)
    .first<Backup>();
  if (!backup || ["deleting", "deleted"].includes(backup.status))
    fail(404, "BACKUP_NOT_FOUND");
  return backup;
}

export async function reserveBackup(
  request: Request,
  env: Env,
  session: Session
) {
  await requireUpload(env, session);
  const idempotency = request.headers.get("idempotency-key") ?? "";
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(idempotency))
    fail(400, "INVALID_IDEMPOTENCY_KEY");
  const { deviceId, formatVersion, keyVersion, sizeBytes, sha256 } =
    await readJson(request);
  if (deviceId !== session.deviceId) fail(403, "DEVICE_MISMATCH");
  if (formatVersion !== FORMAT_VERSION) fail(400, "UNSUPPORTED_FORMAT");
  if (
    typeof sizeBytes !== "number" ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 1
  ) {
    fail(400, "INVALID_SNAPSHOT_SIZE");
  }
  if (sizeBytes > MAX_SNAPSHOT_BYTES) fail(413, "SNAPSHOT_TOO_LARGE");
  if (
    typeof keyVersion !== "number" ||
    !Number.isSafeInteger(keyVersion) ||
    keyVersion < 1 ||
    typeof sha256 !== "string" ||
    !CHECKSUM.test(sha256)
  )
    fail(400, "INVALID_SNAPSHOT");

  const now = Date.now();
  const id = crypto.randomUUID();
  const account = session.accountId;
  // Reclaim an expired staging slot without deleting the object underneath an active upload.
  await env.DB.batch([
    env.DB.prepare(
      `
      UPDATE backups SET status = 'deleting' WHERE account_id = ? AND status IN ('reserved','uploaded')
        AND expires_at <= ? AND COALESCE(upload_deadline, 0) <= ?
    `
    ).bind(account, now, now),
    env.DB.prepare(
      `
      INSERT INTO backups (id, account_id, device_id, idempotency_key, object_key, size_bytes, sha256,
                           format_version, key_version, status, reserved_at, expires_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?
      WHERE ${activeUpload}
        AND ? = (SELECT MAX(key_version) FROM key_envelopes WHERE account_id = ?)
        AND (SELECT COUNT(*) FROM backups WHERE account_id = ? AND reserved_at > ?) < ?
      ON CONFLICT DO NOTHING
    `
    ).bind(
      id,
      account,
      deviceId,
      idempotency,
      OBJECT_PREFIX + id,
      sizeBytes,
      sha256,
      formatVersion,
      keyVersion,
      now,
      now + RESERVATION_MS,
      session.tokenHash,
      now,
      now,
      keyVersion,
      account,
      account,
      now - RATE_WINDOW_MS,
      RESERVATIONS_PER_WINDOW
    )
  ]);
  const backup = await env.DB.prepare(
    `${selectBackup} WHERE account_id = ? AND idempotency_key = ?`
  )
    .bind(account, idempotency)
    .first<Backup>();
  if (backup) {
    if (
      backup.deviceId !== deviceId ||
      backup.sizeBytes !== sizeBytes ||
      backup.sha256 !== sha256 ||
      backup.keyVersion !== keyVersion ||
      backup.formatVersion !== formatVersion
    ) {
      fail(409, "IDEMPOTENCY_CONFLICT");
    }
    if (
      ["deleting", "deleted"].includes(backup.status) ||
      (backup.status !== "committed" && backup.expiresAt <= now)
    )
      fail(410, "RESERVATION_EXPIRED");
    return json(publicBackup(backup), backup.id === id ? 201 : 200);
  }

  await requireUpload(env, session);
  const state = await env.DB.prepare(
    `
    SELECT (SELECT MAX(key_version) FROM key_envelopes WHERE account_id = ?) AS keyVersion,
           (SELECT COUNT(*) FROM backups WHERE account_id = ? AND reserved_at > ?) AS reserved
  `
  )
    .bind(account, account, now - RATE_WINDOW_MS)
    .first<{ keyVersion: number | null; reserved: number }>();
  if (state?.keyVersion !== keyVersion) fail(409, "KEY_VERSION_CONFLICT");
  if (state.reserved >= RESERVATIONS_PER_WINDOW)
    fail(429, "RESERVATION_RATE_LIMITED");
  fail(409, "BACKUP_IN_PROGRESS");
}

function matchesObject(object: R2Object | null, backup: Backup) {
  return (
    object?.size === backup.sizeBytes &&
    Boolean(
      object.checksums.sha256 &&
        toHex(object.checksums.sha256) === backup.sha256
    )
  );
}

function validateContent(request: Request, backup: Backup) {
  if (!request.body) fail(400, "SNAPSHOT_BODY_REQUIRED");
  if (
    request.headers.get("content-type")?.toLowerCase() !==
      "application/octet-stream" ||
    request.headers.has("content-encoding")
  )
    fail(415, "OCTET_STREAM_REQUIRED");
  const length = request.headers.get("content-length");
  if (length !== null && length !== String(backup.sizeBytes))
    fail(409, "PAYLOAD_MISMATCH");
  return request.body;
}

async function checkReplay(body: ReadableStream<Uint8Array>, backup: Backup) {
  const digest = new crypto.DigestStream("SHA-256");
  // pipeTo can reject before digest is awaited. Observe both outcomes.
  const checksum = digest.digest.then(toHex, () => null);
  let count = 0;
  const limited = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      count += chunk.byteLength;
      if (count > backup.sizeBytes) fail(409, "PAYLOAD_MISMATCH");
      controller.enqueue(chunk);
    }
  });
  try {
    await body
      .pipeThrough(limited)
      .pipeTo(digest, { signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
  } catch {
    fail(409, "PAYLOAD_MISMATCH");
  }
  if (count !== backup.sizeBytes || (await checksum) !== backup.sha256)
    fail(409, "PAYLOAD_MISMATCH");
}

async function storeContent(
  env: Env,
  body: ReadableStream<Uint8Array>,
  backup: Backup
) {
  const bounded = new FixedLengthStream(backup.sizeBytes);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), UPLOAD_TIMEOUT_MS);
  const pipe = body
    .pipeTo(bounded.writable, { signal: abort.signal })
    .catch(() => {
      fail(409, "PAYLOAD_MISMATCH");
    });
  try {
    const [object] = await Promise.all([
      env.BACKUPS.put(backup.objectKey, bounded.readable, {
        onlyIf: new Headers({ "If-None-Match": "*" }),
        sha256: backup.sha256,
        httpMetadata: { contentType: "application/octet-stream" }
      }),
      pipe
    ]);
    if (!object || !matchesObject(object, backup))
      fail(409, "PAYLOAD_MISMATCH");
  } catch (error) {
    if (abort.signal.aborted) fail(408, "UPLOAD_TIMEOUT");
    if (
      error instanceof Error &&
      /checksum|sha256|length|digest/i.test(error.message)
    ) {
      fail(409, "PAYLOAD_MISMATCH");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
}

export async function uploadBackup(
  request: Request,
  env: Env,
  session: Session,
  id: string
) {
  await requireUpload(env, session);
  const backup = await findBackup(env, session, id);
  if (backup.deviceId !== session.deviceId) fail(404, "BACKUP_NOT_FOUND");
  const now = Date.now();
  if (backup.status !== "committed" && backup.expiresAt <= now)
    fail(410, "RESERVATION_EXPIRED");
  const body = validateContent(request, backup);
  if (backup.status !== "reserved") {
    await checkReplay(body, backup);
    await requireUpload(env, session);
    return json(publicBackup(await findBackup(env, session, id)));
  }

  const uploadToken = crypto.randomUUID();
  const lease = await env.DB.prepare(
    `
    UPDATE backups SET upload_token = ?, upload_deadline = ?
    WHERE id = ? AND account_id = ? AND device_id = ? AND status = 'reserved' AND expires_at > ?
      AND COALESCE(upload_deadline, 0) <= ? AND ${activeUpload}
    RETURNING id
  `
  )
    .bind(
      uploadToken,
      now + UPLOAD_LEASE_MS,
      id,
      session.accountId,
      session.deviceId,
      now,
      now,
      session.tokenHash,
      now,
      now
    )
    .first();
  if (!lease) {
    await requireUpload(env, session);
    fail(409, "BACKUP_IN_PROGRESS");
  }

  try {
    const existing = await env.BACKUPS.head(backup.objectKey);
    if (existing) {
      // An interrupted request may have written the object before recording the transition.
      await checkReplay(body, backup);
      if (!matchesObject(existing, backup)) fail(409, "PAYLOAD_MISMATCH");
    } else {
      await storeContent(env, body, backup);
    }
    const finishedAt = Date.now();
    const result = await env.DB.prepare(
      `
      UPDATE backups SET status = 'uploaded', upload_token = NULL, upload_deadline = NULL
      WHERE id = ? AND status = 'reserved' AND upload_token = ? AND expires_at > ?
        AND ${activeUpload} RETURNING id
    `
    )
      .bind(
        id,
        uploadToken,
        finishedAt,
        session.tokenHash,
        finishedAt,
        finishedAt
      )
      .first();
    if (!result) {
      await requireUpload(env, session);
      fail(410, "RESERVATION_EXPIRED");
    }
    return json(publicBackup(await findBackup(env, session, id)));
  } finally {
    await env.DB.prepare(
      `
      UPDATE backups SET upload_token = NULL, upload_deadline = NULL WHERE id = ? AND upload_token = ?
    `
    )
      .bind(id, uploadToken)
      .run();
  }
}

export async function commitBackup(env: Env, session: Session, id: string) {
  await requireUpload(env, session);
  const backup = await findBackup(env, session, id);
  if (backup.deviceId !== session.deviceId) fail(404, "BACKUP_NOT_FOUND");
  if (backup.status === "committed") return json(publicBackup(backup));
  if (backup.expiresAt <= Date.now()) fail(410, "RESERVATION_EXPIRED");
  if (backup.status !== "uploaded") fail(409, "SNAPSHOT_NOT_UPLOADED");
  if (!matchesObject(await env.BACKUPS.head(backup.objectKey), backup))
    fail(409, "PAYLOAD_MISMATCH");

  const now = Date.now();
  const account = session.accountId;
  await env.DB.batch([
    env.DB.prepare(
      `
      UPDATE backups SET status = 'committed', committed_at = ?
      WHERE id = ? AND status = 'uploaded' AND expires_at > ? AND ${activeUpload}
        AND key_version = (SELECT MAX(key_version) FROM key_envelopes WHERE account_id = ?)
    `
    ).bind(now, id, now, session.tokenHash, now, now, account),
    env.DB.prepare(
      `
      UPDATE backups SET status = 'deleting'
      WHERE account_id = ? AND status = 'committed'
        AND EXISTS (SELECT 1 FROM backups WHERE id = ? AND status = 'committed')
        AND id IN (
          SELECT id FROM backups WHERE account_id = ? AND status = 'committed'
          ORDER BY (id = ?) DESC, committed_at DESC, id DESC LIMIT -1 OFFSET ?
        )
    `
    ).bind(account, id, account, id, SNAPSHOT_LIMIT)
  ]);
  const result = await findBackup(env, session, id);
  if (result.status !== "committed") {
    await requireUpload(env, session);
    if (result.expiresAt <= now) fail(410, "RESERVATION_EXPIRED");
    fail(409, "KEY_VERSION_CONFLICT");
  }
  return json(publicBackup(result));
}

export async function listBackups(env: Env, session: Session) {
  await requireDownload(env, session);
  const { results } = await env.DB.prepare(
    `
    ${selectBackup} WHERE account_id = ? AND status = 'committed' ORDER BY committed_at DESC, id DESC
  `
  )
    .bind(session.accountId)
    .all<Backup>();
  return json({ backups: results.map(publicBackup) });
}

export async function downloadBackup(env: Env, session: Session, id: string) {
  await requireDownload(env, session);
  const backup = await findBackup(env, session, id);
  if (backup.status !== "committed") fail(404, "BACKUP_NOT_FOUND");
  const object = await env.BACKUPS.get(backup.objectKey);
  if (!object || !matchesObject(object, backup))
    fail(503, "SNAPSHOT_UNAVAILABLE");
  try {
    await requireDownload(env, session);
    if ((await findBackup(env, session, id)).status !== "committed")
      fail(404, "BACKUP_NOT_FOUND");
  } catch (error) {
    await object.body.cancel().catch(() => undefined);
    throw error;
  }
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(backup.sizeBytes),
      "Content-Disposition": "attachment",
      "X-Ohai-Sha256": backup.sha256
    }
  });
}

export async function deleteBackup(env: Env, session: Session, id: string) {
  const now = Date.now();
  const row = await env.DB.prepare(
    `
    UPDATE backups SET status = CASE WHEN status = 'deleted' THEN 'deleted' ELSE 'deleting' END
    WHERE id = ? AND account_id = ? AND ${activeSession} RETURNING id
  `
  )
    .bind(id, session.accountId, session.tokenHash, now)
    .first();
  if (!row) fail(404, "BACKUP_NOT_FOUND");
  return json({ deletionQueued: true }, 202);
}

export async function cleanBackups(env: Env) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `
      UPDATE entitlements SET purge_started_at = ?
      WHERE purge_started_at IS NULL AND download_until <= ? AND purge_confirmed_at >= download_until
    `
    ).bind(now, now),
    env.DB.prepare(
      `
      UPDATE backups SET status = 'deleting' WHERE status IN ('reserved','uploaded','committed')
        AND (EXISTS (SELECT 1 FROM entitlements e WHERE e.account_id = backups.account_id AND e.purge_started_at IS NOT NULL)
          OR (status IN ('reserved','uploaded') AND expires_at <= ? AND COALESCE(upload_deadline, 0) <= ?))
    `
    ).bind(now, now),
    env.DB.prepare(`
      DELETE FROM key_envelopes WHERE EXISTS (SELECT 1 FROM entitlements e
        WHERE e.account_id = key_envelopes.account_id AND e.purge_started_at IS NOT NULL)
    `),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM oauth_flows WHERE expires_at <= ?").bind(now),
    env.DB.prepare(
      "DELETE FROM native_oauth_handoffs WHERE expires_at <= ?"
    ).bind(now)
  ]);

  const { results } = await env.DB.prepare(
    `
    SELECT id, object_key AS objectKey FROM backups WHERE status = 'deleting'
      AND COALESCE(upload_deadline, 0) <= ? LIMIT 100
  `
  )
    .bind(now)
    .all<{ id: string; objectKey: string }>();
  if (results.length) {
    await env.BACKUPS.delete(results.map((row) => row.objectKey));
    const ids = results.map(({ id }) => id);
    await env.DB.prepare(
      `
      UPDATE backups SET status = 'deleted', upload_deadline = NULL, upload_token = NULL
      WHERE status = 'deleting' AND id IN (${ids.map(() => "?").join(",")})
    `
    )
      .bind(...ids)
      .run();
  }
  await env.DB.prepare(
    `
    DELETE FROM backups WHERE status = 'deleted' AND
      (reserved_at <= ? OR EXISTS (SELECT 1 FROM accounts a WHERE a.id = backups.account_id AND a.deleted_at IS NOT NULL))
  `
  )
    .bind(now - 7 * 24 * 60 * 60 * 1000)
    .run();

  // Catch objects left behind by an interrupted write or an ambiguous storage response.
  // Use a cursor so a bucket with over one page receives a complete sweep.
  const state = await env.DB.prepare(
    "SELECT value FROM service_state WHERE name = 'orphan_cursor'"
  ).first<{ value: string }>();
  const objects = await env.BACKUPS.list({
    prefix: OBJECT_PREFIX,
    limit: 100,
    cursor: state?.value || undefined
  });
  const candidates = objects.objects.filter(
    (object) =>
      object.uploaded.getTime() <= now - UPLOAD_LEASE_MS &&
      uuid.test(object.key.slice(OBJECT_PREFIX.length))
  );
  if (candidates.length) {
    const keys = candidates.map(({ key }) => key);
    const { results } = await env.DB.prepare(
      `
      SELECT object_key AS objectKey FROM backups
      WHERE object_key IN (${keys
        .map(() => "?")
        .join(",")}) AND status != 'deleted'
    `
    )
      .bind(...keys)
      .all<{ objectKey: string }>();
    const tracked = new Set(results.map(({ objectKey }) => objectKey));
    const orphans = keys.filter((key) => !tracked.has(key));
    if (orphans.length) await env.BACKUPS.delete(orphans);
  }
  await env.DB.prepare(
    `
    INSERT INTO service_state (name, value) VALUES ('orphan_cursor', ?)
    ON CONFLICT (name) DO UPDATE SET value = excluded.value
  `
  )
    .bind(objects.truncated ? objects.cursor : "")
    .run();
}
