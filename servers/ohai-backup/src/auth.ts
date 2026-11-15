import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  type Env,
  checkOrigin,
  cookie,
  fail,
  hashToken,
  json,
  randomToken,
  readCookie,
  readJson,
  redirect,
  safeReturnPath,
  serviceOrigin,
  tokenPattern
} from "./http";

const issuer = "https://accounts.google.com";
const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);
const SESSION_AGE = 7 * 24 * 60 * 60;
const FLOW_AGE = 10 * 60;
const HANDOFF_AGE_MS = 2 * 60 * 1000;
export const OHAI_PATH_PREFIX = "/ohai";
export const NATIVE_CALLBACK_PATH = OHAI_PATH_PREFIX + "/auth/native/complete";
const NATIVE_GOOGLE_CALLBACK = OHAI_PATH_PREFIX + "/auth/google/callback";
export const RECENT_AUTH = 10 * 60 * 1000;

export interface Session {
  accountId: string;
  deviceId: string;
  tokenHash: string;
  authenticatedAt: number;
  email: string | null;
  displayName: string | null;
  backupOptIn: number;
  paused: number;
}

function sessionCookie(secure: boolean) {
  return secure ? "__Host-ohai-session" : "ohai-session";
}

function flowCookie(secure: boolean) {
  return secure ? "__Host-ohai-oauth" : "ohai-oauth";
}

export async function authenticate(
  request: Request,
  env: Env
): Promise<Session> {
  const { origin, secure } = serviceOrigin(env);
  if (new URL(request.url).origin !== origin) fail(403, "ORIGIN_FORBIDDEN");
  const bearer = request.headers.get("authorization");
  const raw = bearer
    ? /^Bearer (\S+)$/.exec(bearer)?.[1]
    : readCookie(request, sessionCookie(secure));
  if (!raw || !tokenPattern.test(raw)) fail(401, "SESSION_REQUIRED");
  if (!bearer && !["GET", "HEAD"].includes(request.method))
    checkOrigin(request, env);

  const tokenHash = await hashToken(raw);
  const session = await env.DB.prepare(
    `
    SELECT a.id AS accountId, a.email, a.display_name AS displayName, a.paused,
           d.id AS deviceId, d.backup_opt_in AS backupOptIn,
           s.authenticated_at AS authenticatedAt
    FROM sessions s
    JOIN devices d ON d.id = s.device_id
    JOIN accounts a ON a.id = d.account_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND d.revoked_at IS NULL AND a.deleted_at IS NULL
  `
  )
    .bind(tokenHash, Date.now())
    .first<Omit<Session, "tokenHash">>();
  if (!session) fail(401, "SESSION_EXPIRED");
  return { ...session, tokenHash };
}

// Repeat this guard inside mutations so a concurrent logout or revocation cannot publish data.
export const activeSession = `EXISTS (
  SELECT 1 FROM sessions s JOIN devices d ON d.id = s.device_id
  JOIN accounts a ON a.id = d.account_id
  WHERE s.token_hash = ? AND s.expires_at > ?
    AND d.revoked_at IS NULL AND a.deleted_at IS NULL
)`;

export function requireRecentAuth(session: Session) {
  if (Date.now() - session.authenticatedAt > RECENT_AUTH)
    fail(403, "RECENT_AUTH_REQUIRED");
}

function googleConfig(env: Env) {
  const { origin, secure } = serviceOrigin(env);
  const id = env.GOOGLE_CLIENT_ID;
  const secret = env.GOOGLE_CLIENT_SECRET;
  const allow =
    env.GOOGLE_ALLOWED_EMAILS?.split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean) || [];
  if (
    !id?.endsWith(".apps.googleusercontent.com") ||
    !secret ||
    (!allow.length && env.GOOGLE_PUBLIC_SIGNUP !== "true")
  )
    fail(503, "GOOGLE_AUTH_NOT_CONFIGURED");
  return {
    id,
    secret,
    allow,
    origin,
    secure,
    callback: origin + "/auth/google/callback"
  };
}

export function nativeGoogleStatus(request: Request, env: Env) {
  const { origin, secure } = googleConfig(env);
  if (!secure || !env.IOS_APP_ID || new URL(request.url).origin !== origin) {
    fail(503, "NATIVE_SIGN_IN_NOT_CONFIGURED");
  }
  return json({ ready: true });
}

export async function beginGoogle(request: Request, env: Env) {
  const config = googleConfig(env);
  const url = new URL(request.url);
  if (url.origin !== config.origin) fail(403, "ORIGIN_FORBIDDEN");
  const nativeRoute = url.pathname === OHAI_PATH_PREFIX + "/auth/google/start";
  const nativeChallenge = url.searchParams.get("native_challenge");
  if (
    nativeRoute !== (nativeChallenge !== null) ||
    (nativeChallenge !== null &&
      (!config.secure ||
        !env.IOS_APP_ID ||
        !tokenPattern.test(nativeChallenge)))
  ) {
    fail(400, "INVALID_NATIVE_SIGN_IN");
  }
  const state = randomToken();
  const browser = randomToken();
  const verifier = randomToken();
  const nonce = randomToken();

  await env.DB.prepare(
    `
    INSERT INTO oauth_flows (state_hash, browser_hash, verifier, nonce, return_path, expires_at, native_challenge)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  )
    .bind(
      await hashToken(state),
      await hashToken(browser),
      verifier,
      nonce,
      safeReturnPath(url.searchParams.get("returnTo"), config.origin),
      Date.now() + FLOW_AGE * 1000,
      nativeChallenge
    )
    .run();

  const target = new URL(issuer + "/o/oauth2/v2/auth");
  target.search = new URLSearchParams({
    client_id: config.id,
    redirect_uri: nativeRoute
      ? config.origin + NATIVE_GOOGLE_CALLBACK
      : config.callback,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: await hashToken(verifier),
    code_challenge_method: "S256",
    prompt: "select_account"
  }).toString();
  return redirect(target.href, [
    cookie(flowCookie(config.secure), browser, FLOW_AGE, config.secure)
  ]);
}

async function googleProfile(idToken: string, clientId: string, nonce: string) {
  const { payload } = await jwtVerify(idToken, googleKeys, {
    algorithms: ["RS256"],
    issuer: [issuer, "accounts.google.com"],
    audience: clientId,
    requiredClaims: ["sub", "email", "email_verified", "nonce", "iat", "exp"],
    maxTokenAge: "10 minutes",
    clockTolerance: 30
  });
  if (
    payload.nonce !== nonce ||
    (payload.azp !== undefined && payload.azp !== clientId) ||
    (Array.isArray(payload.aud) &&
      payload.aud.length > 1 &&
      payload.azp !== clientId) ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    payload.sub.length > 255 ||
    typeof payload.email !== "string" ||
    payload.email.length > 320 ||
    payload.email_verified !== true
  ) {
    fail(401, "INVALID_PROVIDER_IDENTITY");
  }
  return {
    subject: payload.sub,
    email: payload.email.toLowerCase(),
    displayName:
      typeof payload.name === "string" ? payload.name.slice(0, 128) : null
  };
}

export async function finishGoogle(request: Request, env: Env) {
  const config = googleConfig(env);
  const url = new URL(request.url);
  if (url.origin !== config.origin) fail(403, "ORIGIN_FORBIDDEN");
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const browser = readCookie(request, flowCookie(config.secure));
  if (
    !state ||
    !tokenPattern.test(state) ||
    !browser ||
    !tokenPattern.test(browser)
  )
    fail(401, "INVALID_OAUTH_STATE");

  const flow = await env.DB.prepare(
    `
    DELETE FROM oauth_flows WHERE state_hash = ? AND browser_hash = ? AND expires_at > ?
    RETURNING verifier, nonce, return_path, native_challenge
  `
  )
    .bind(await hashToken(state), await hashToken(browser), Date.now())
    .first<{
      verifier: string;
      nonce: string;
      return_path: string;
      native_challenge: string | null;
    }>();
  const nativeRoute = url.pathname === NATIVE_GOOGLE_CALLBACK;
  if (!flow || nativeRoute !== Boolean(flow.native_challenge)) {
    fail(401, "INVALID_OAUTH_CALLBACK");
  }
  if (
    flow.native_challenge &&
    url.searchParams.get("error") === "access_denied"
  ) {
    return nativeRedirect(config, "error", "cancelled");
  }
  if (!code || code.length > 2048) fail(401, "INVALID_OAUTH_CALLBACK");

  let profile;
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: config.id,
        client_secret: config.secret,
        redirect_uri: nativeRoute
          ? config.origin + NATIVE_GOOGLE_CALLBACK
          : config.callback,
        code_verifier: flow.verifier
      }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) fail(401, "GOOGLE_CODE_EXCHANGE_FAILED");
    const data: { id_token?: unknown } = await response.json();
    if (typeof data.id_token !== "string")
      fail(401, "INVALID_PROVIDER_IDENTITY");
    profile = await googleProfile(data.id_token, config.id, flow.nonce);
  } catch {
    if (flow.native_challenge) return nativeRedirect(config, "error", "failed");
    fail(401, "GOOGLE_AUTHENTICATION_FAILED");
  }
  if (
    env.GOOGLE_PUBLIC_SIGNUP !== "true" &&
    !config.allow.includes(profile.email)
  ) {
    if (flow.native_challenge)
      return nativeRedirect(config, "error", "not_allowed");
    fail(403, "SIGN_IN_NOT_ALLOWED");
  }

  if (flow.native_challenge) {
    const handoff = randomToken();
    await env.DB.prepare(
      `
      INSERT INTO native_oauth_handoffs (code_hash, challenge, subject, email, display_name, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    )
      .bind(
        await hashToken(handoff),
        flow.native_challenge,
        profile.subject,
        profile.email,
        profile.displayName,
        Date.now() + HANDOFF_AGE_MS
      )
      .run();
    return nativeRedirect(config, "code", handoff);
  }

  const previous = readCookie(request, sessionCookie(config.secure));
  const session = await createGoogleSession(env, profile, previous);
  return redirect(new URL(flow.return_path, config.origin).href, [
    cookie(
      sessionCookie(config.secure),
      session.token,
      SESSION_AGE,
      config.secure
    ),
    cookie(flowCookie(config.secure), "", 0, config.secure)
  ]);
}

function nativeRedirect(
  config: { origin: string; secure: boolean },
  field: "code" | "error",
  value: string
) {
  const target = new URL(NATIVE_CALLBACK_PATH, config.origin);
  target.searchParams.set(field, value);
  return redirect(target.href, [
    cookie(flowCookie(config.secure), "", 0, config.secure)
  ]);
}

export async function exchangeNativeGoogle(request: Request, env: Env) {
  const { origin, secure } = serviceOrigin(env);
  if (!secure || !env.IOS_APP_ID || new URL(request.url).origin !== origin) {
    fail(403, "ORIGIN_FORBIDDEN");
  }
  const { code, verifier } = await readJson(request);
  if (
    typeof code !== "string" ||
    !tokenPattern.test(code) ||
    typeof verifier !== "string" ||
    !tokenPattern.test(verifier)
  ) {
    fail(400, "INVALID_NATIVE_HANDOFF");
  }
  const profile = await env.DB.prepare(
    `
    DELETE FROM native_oauth_handoffs
    WHERE code_hash = ? AND challenge = ? AND expires_at > ?
    RETURNING subject, email, display_name AS displayName
  `
  )
    .bind(await hashToken(code), await hashToken(verifier), Date.now())
    .first<Awaited<ReturnType<typeof googleProfile>>>();
  if (!profile) fail(401, "INVALID_NATIVE_HANDOFF");
  return json(await createGoogleSession(env, profile));
}

async function createGoogleSession(
  env: Env,
  profile: Awaited<ReturnType<typeof googleProfile>>,
  previous?: string
) {
  const now = Date.now();
  const id = crypto.randomUUID();
  const raw = randomToken();
  const tokenHash = await hashToken(raw);
  const previousHash =
    previous && tokenPattern.test(previous) ? await hashToken(previous) : "";
  const newDevice = crypto.randomUUID();
  const account =
    "(SELECT account_id FROM identities WHERE issuer = ? AND subject = ?)";
  // Allocate a UUID only when the verified issuer and subject are new. Email never links accounts.
  await env.DB.batch([
    env.DB.prepare(
      `
      INSERT INTO accounts (id, email, display_name, created_at)
      SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM identities WHERE issuer = ? AND subject = ?)
    `
    ).bind(
      id,
      profile.email,
      profile.displayName,
      now,
      issuer,
      profile.subject
    ),
    env.DB.prepare(
      `
      INSERT INTO identities (issuer, subject, account_id)
      SELECT ?, ?, id FROM accounts WHERE id = ?
    `
    ).bind(issuer, profile.subject, id),
    env.DB.prepare(
      `
      UPDATE accounts SET email = ?, display_name = ? WHERE id = ${account} AND deleted_at IS NULL
    `
    ).bind(profile.email, profile.displayName, issuer, profile.subject),
    env.DB.prepare(
      `
      INSERT INTO devices (id, account_id, created_at)
      SELECT ?, a.id, ? FROM accounts a WHERE a.id = ${account} AND a.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM sessions s JOIN devices d ON d.id = s.device_id
          WHERE s.token_hash = ? AND s.expires_at > ? AND d.account_id = a.id AND d.revoked_at IS NULL)
    `
    ).bind(newDevice, now, issuer, profile.subject, previousHash, now),
    env.DB.prepare(
      `
      INSERT INTO sessions (token_hash, device_id, authenticated_at, expires_at)
      SELECT ?, d.id, ?, ? FROM devices d JOIN accounts a ON a.id = d.account_id
      WHERE a.id = ${account} AND a.deleted_at IS NULL AND d.revoked_at IS NULL AND d.id = COALESCE(
        (SELECT s.device_id FROM sessions s JOIN devices p ON p.id = s.device_id
          WHERE s.token_hash = ? AND s.expires_at > ? AND p.account_id = a.id AND p.revoked_at IS NULL), ?)
    `
    ).bind(
      tokenHash,
      now,
      now + SESSION_AGE * 1000,
      issuer,
      profile.subject,
      previousHash,
      now,
      newDevice
    ),
    env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(
      previousHash
    )
  ]);
  if (
    !(await env.DB.prepare("SELECT 1 FROM sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .first())
  ) {
    fail(403, "ACCOUNT_UNAVAILABLE");
  }

  return {
    token: raw,
    expiresAt: now + SESSION_AGE * 1000,
    email: profile.email
  };
}

export async function signOut(env: Env, session: Session) {
  const { secure } = serviceOrigin(env);
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
    .bind(session.tokenHash)
    .run();
  const response = json({ signedOut: true });
  response.headers.append(
    "Set-Cookie",
    cookie(sessionCookie(secure), "", 0, secure)
  );
  return response;
}
