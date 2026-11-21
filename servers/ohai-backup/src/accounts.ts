import { activeSession, requireRecentAuth, type Session } from "./auth";
import { type Env, fail, json, readJson } from "./http";

export const FORMAT_VERSION = 1;
export const SNAPSHOT_LIMIT = 2;
export const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;

export interface Entitlement {
  provider: string;
  uploadUntil: number;
  downloadUntil: number;
  purgeStartedAt: number | null;
}

export function entitlement(env: Env, accountId: string) {
  return env.DB.prepare(
    `
    SELECT provider, upload_until AS uploadUntil, download_until AS downloadUntil,
           purge_started_at AS purgeStartedAt FROM entitlements WHERE account_id = ?
  `
  )
    .bind(accountId)
    .first<Entitlement>();
}

export async function requireDownload(env: Env, session: Session) {
  const now = Date.now();
  const permitted = await env.DB.prepare(
    `
    SELECT 1 FROM entitlements WHERE account_id = ? AND download_until > ? AND purge_started_at IS NULL
      AND ${activeSession}
  `
  )
    .bind(session.accountId, now, session.tokenHash, now)
    .first();
  if (!permitted) {
    fail(403, "DOWNLOAD_UNAVAILABLE");
  }
}

// This statement-level check closes the race between checking the plan and committing a write.
export const activeUpload = `EXISTS (
  SELECT 1 FROM sessions s
  JOIN devices d ON d.id = s.device_id
  JOIN accounts a ON a.id = d.account_id
  JOIN entitlements e ON e.account_id = a.id
  WHERE s.token_hash = ? AND s.expires_at > ? AND d.revoked_at IS NULL
    AND d.backup_opt_in = 1 AND a.deleted_at IS NULL AND a.paused = 0
    AND e.upload_until > ? AND e.purge_started_at IS NULL
)`;

export async function requireUpload(env: Env, session: Session) {
  const now = Date.now();
  if (
    !(await env.DB.prepare(`SELECT 1 WHERE ${activeUpload}`)
      .bind(session.tokenHash, now, now)
      .first())
  ) {
    fail(403, "UPLOAD_UNAVAILABLE");
  }
}

export function me(session: Session) {
  return json({
    accountId: session.accountId,
    deviceId: session.deviceId,
    email: session.email,
    displayName: session.displayName,
    backupOptIn: Boolean(session.backupOptIn),
    paused: Boolean(session.paused)
  });
}

export async function getEntitlement(env: Env, session: Session) {
  const [access, usage] = await Promise.all([
    entitlement(env, session.accountId),
    env.DB.prepare(
      `
      SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM backups
      WHERE account_id = ? AND status = 'committed'
    `
    )
      .bind(session.accountId)
      .first<{ bytes: number }>()
  ]);
  const now = Date.now();
  return json({
    provider: access?.provider ?? null,
    uploadAllowed: Boolean(
      access &&
        access.uploadUntil > now &&
        access.purgeStartedAt === null &&
        session.backupOptIn &&
        !session.paused
    ),
    downloadAllowed: Boolean(
      access && access.downloadUntil > now && access.purgeStartedAt === null
    ),
    uploadUntil: access?.uploadUntil ?? null,
    downloadUntil: access?.downloadUntil ?? null,
    storageBytes: usage?.bytes ?? 0,
    snapshotLimit: SNAPSHOT_LIMIT,
    maxSnapshotBytes: MAX_SNAPSHOT_BYTES,
    backupOptIn: Boolean(session.backupOptIn),
    paused: Boolean(session.paused)
  });
}

export async function setDeviceBackup(
  request: Request,
  env: Env,
  session: Session
) {
  const { enabled } = await readJson(request);
  if (typeof enabled !== "boolean") fail(400, "INVALID_OPT_IN");
  const row = await env.DB.prepare(
    `
    UPDATE devices SET backup_opt_in = ? WHERE id = ? AND ${activeSession} RETURNING backup_opt_in
  `
  )
    .bind(Number(enabled), session.deviceId, session.tokenHash, Date.now())
    .first();
  if (!row) fail(401, "SESSION_EXPIRED");
  return json({ backupOptIn: enabled });
}

export async function pauseVault(request: Request, env: Env, session: Session) {
  const { paused } = await readJson(request);
  if (typeof paused !== "boolean") fail(400, "INVALID_PAUSE");
  const row = await env.DB.prepare(
    `
    UPDATE accounts SET paused = ? WHERE id = ? AND ${activeSession} RETURNING paused
  `
  )
    .bind(Number(paused), session.accountId, session.tokenHash, Date.now())
    .first();
  if (!row) fail(401, "SESSION_EXPIRED");
  return json({ paused });
}

interface KeyEnvelope {
  formatVersion: number;
  keyVersion: number;
  envelope: string;
}

export async function getKeyEnvelope(env: Env, session: Session) {
  await requireDownload(env, session);
  const result = await env.DB.prepare(
    `
    SELECT format_version AS formatVersion, key_version AS keyVersion, envelope
    FROM key_envelopes WHERE account_id = ? ORDER BY key_version DESC LIMIT 1
  `
  )
    .bind(session.accountId)
    .first<KeyEnvelope>();
  if (!result) fail(404, "KEY_ENVELOPE_MISSING");
  return json(result);
}

export async function putKeyEnvelope(
  request: Request,
  env: Env,
  session: Session
) {
  requireRecentAuth(session);
  const { formatVersion, keyVersion, previousKeyVersion, envelope } =
    await readJson(request);
  if (formatVersion !== FORMAT_VERSION) fail(400, "UNSUPPORTED_FORMAT");
  if (
    typeof previousKeyVersion !== "number" ||
    !Number.isSafeInteger(previousKeyVersion) ||
    previousKeyVersion < 0 ||
    previousKeyVersion >= 0x7fffffff ||
    keyVersion !== previousKeyVersion + 1 ||
    typeof envelope !== "string" ||
    !/^[A-Za-z0-9_-]{32,4096}$/.test(envelope)
  )
    fail(400, "INVALID_KEY_ENVELOPE");

  const now = Date.now();
  const access = await entitlement(env, session.accountId);
  if (!access || access.uploadUntil <= now || access.purgeStartedAt !== null)
    fail(403, "UPLOAD_UNAVAILABLE");

  const [written] = await env.DB.batch<KeyEnvelope>([
    env.DB.prepare(
      `
      INSERT INTO key_envelopes (account_id, key_version, format_version, envelope)
      SELECT ?, ?, ?, ?
      WHERE ${activeSession}
        AND EXISTS (SELECT 1 FROM entitlements WHERE account_id = ? AND upload_until > ? AND purge_started_at IS NULL)
        AND ? = COALESCE((SELECT MAX(key_version) FROM key_envelopes WHERE account_id = ?), 0)
      RETURNING format_version AS formatVersion, key_version AS keyVersion, envelope
    `
    ).bind(
      session.accountId,
      keyVersion,
      formatVersion,
      envelope,
      session.tokenHash,
      now,
      session.accountId,
      now,
      previousKeyVersion,
      session.accountId
    ),
    // Retire the old wrapper as soon as the new wrapper exists. Raw backup keys never enter D1.
    env.DB.prepare(
      `
      DELETE FROM key_envelopes WHERE account_id = ? AND key_version < ?
        AND EXISTS (SELECT 1 FROM key_envelopes WHERE account_id = ? AND key_version = ?)
    `
    ).bind(session.accountId, keyVersion, session.accountId, keyVersion)
  ]);
  if (!written.results[0]) fail(409, "KEY_VERSION_CONFLICT");
  return json(written.results[0], previousKeyVersion ? 200 : 201);
}

export async function revokeDevice(
  env: Env,
  session: Session,
  deviceId: string
) {
  requireRecentAuth(session);
  const now = Date.now();
  const row = await env.DB.prepare(
    `
    UPDATE devices SET revoked_at = COALESCE(revoked_at, ?), backup_opt_in = 0
    WHERE id = ? AND account_id = ? AND ${activeSession} RETURNING id
  `
  )
    .bind(now, deviceId, session.accountId, session.tokenHash, now)
    .first();
  if (!row) fail(404, "DEVICE_NOT_FOUND");
  // Auth already rejects the revoked device. Clean up its old tokens as well.
  await env.DB.prepare("DELETE FROM sessions WHERE device_id = ?")
    .bind(deviceId)
    .run();
  return json({ revoked: true });
}

export async function deleteAccount(env: Env, session: Session) {
  requireRecentAuth(session);
  const now = Date.now();
  const id = session.accountId;
  const deleted =
    "EXISTS (SELECT 1 FROM accounts WHERE id = ? AND deleted_at IS NOT NULL)";
  const [result] = await env.DB.batch([
    env.DB.prepare(
      `
      UPDATE accounts SET deleted_at = ?, paused = 1, email = NULL, display_name = NULL
      WHERE id = ? AND ${activeSession} RETURNING id
    `
    ).bind(now, id, session.tokenHash, now),
    env.DB.prepare(
      `DELETE FROM identities WHERE account_id = ? AND ${deleted}`
    ).bind(id, id),
    env.DB.prepare(
      `DELETE FROM key_envelopes WHERE account_id = ? AND ${deleted}`
    ).bind(id, id),
    env.DB.prepare(
      `UPDATE devices SET revoked_at = COALESCE(revoked_at, ?), backup_opt_in = 0
      WHERE account_id = ? AND ${deleted}`
    ).bind(now, id, id),
    env.DB.prepare(
      `DELETE FROM sessions WHERE device_id IN (SELECT id FROM devices WHERE account_id = ?)
      AND ${deleted}`
    ).bind(id, id),
    env.DB.prepare(
      `UPDATE backups SET status = 'deleting' WHERE account_id = ?
      AND status != 'deleted' AND ${deleted}`
    ).bind(id, id)
  ]);
  if (!result.results.length) fail(401, "SESSION_EXPIRED");
  return json({ deletionQueued: true }, 202);
}
