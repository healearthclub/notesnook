import {
  authenticate,
  beginGoogle,
  exchangeNativeGoogle,
  finishGoogle,
  NATIVE_CALLBACK_PATH,
  OHAI_PATH_PREFIX,
  nativeGoogleStatus,
  signOut
} from "./auth";
import {
  deleteAccount,
  getEntitlement,
  getKeyEnvelope,
  me,
  pauseVault,
  putKeyEnvelope,
  revokeDevice,
  setDeviceBackup
} from "./accounts";
import {
  cleanBackups,
  commitBackup,
  deleteBackup,
  downloadBackup,
  listBackups,
  reserveBackup,
  uploadBackup
} from "./backups";
import { type Env, fail, HttpError, json, uuid } from "./http";

async function route(request: Request, env: Env): Promise<Response> {
  const fullPath = new URL(request.url).pathname;
  const ohaiRoute = fullPath.startsWith(OHAI_PATH_PREFIX + "/");
  const pathname = ohaiRoute
    ? fullPath.slice(OHAI_PATH_PREFIX.length)
    : fullPath;
  const method = request.method;
  if (pathname === "/health" && method === "GET") return json({ ok: true });
  if (
    pathname === "/.well-known/apple-app-site-association" &&
    method === "GET"
  ) {
    if (
      !env.IOS_APP_ID ||
      !/^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/.test(env.IOS_APP_ID)
    ) {
      fail(404, "NOT_FOUND");
    }
    return json({
      webcredentials: { apps: [env.IOS_APP_ID] },
      applinks: {
        details: [
          {
            appIDs: [env.IOS_APP_ID],
            components: [{ "/": NATIVE_CALLBACK_PATH }]
          }
        ]
      }
    });
  }
  if (ohaiRoute && pathname === "/auth/native/status" && method === "GET")
    return nativeGoogleStatus(request, env);
  if (fullPath === NATIVE_CALLBACK_PATH && method === "GET")
    return new Response("Return to ohai to finish signing in.");
  if (ohaiRoute && pathname === "/auth/native/exchange" && method === "POST")
    return exchangeNativeGoogle(request, env);

  if (pathname === "/auth/google/start" && method === "GET")
    return beginGoogle(request, env);
  if (pathname === "/auth/google/callback" && method === "GET")
    return finishGoogle(request, env);
  if (!pathname.startsWith("/v1/") && pathname !== "/auth/sign-out")
    fail(404, "NOT_FOUND");

  const session = await authenticate(request, env);
  switch (`${method} ${pathname}`) {
    case "POST /auth/sign-out":
      return signOut(env, session);
    case "GET /v1/me":
      return me(session);
    case "GET /v1/entitlement":
      return getEntitlement(env, session);
    case "PUT /v1/device/backup":
      return setDeviceBackup(request, env, session);
    case "PUT /v1/vault/pause":
      return pauseVault(request, env, session);
    case "GET /v1/vault/key-envelope":
      return getKeyEnvelope(env, session);
    case "PUT /v1/vault/key-envelope":
      return putKeyEnvelope(request, env, session);
    case "GET /v1/backups":
      return listBackups(env, session);
    case "POST /v1/backups":
      return reserveBackup(request, env, session);
    case "POST /v1/account/deletion":
      return deleteAccount(env, session);
  }

  const [_, v1, resource, id, action, extra] = pathname.split("/");
  if (v1 === "v1" && id && uuid.test(id) && extra === undefined) {
    if (resource === "devices" && action === "revoke" && method === "POST")
      return revokeDevice(env, session, id);
    if (resource === "backups") {
      if (action === "content" && method === "PUT")
        return uploadBackup(request, env, session, id);
      if (action === "content" && method === "GET")
        return downloadBackup(env, session, id);
      if (action === "commit" && method === "POST")
        return commitBackup(env, session, id);
      if (action === undefined && method === "DELETE")
        return deleteBackup(env, session, id);
    }
  }
  fail(404, "NOT_FOUND");
}

export default {
  async fetch(request, env) {
    let response: Response;
    try {
      response = await route(request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        response = json({ error: error.code }, error.status);
      } else {
        console.error("ohai_backup_request_failed");
        response = json({ error: "SERVICE_UNAVAILABLE" }, 503);
      }
    }
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    );
    return response;
  },
  async scheduled(_controller, env) {
    try {
      await cleanBackups(env);
    } catch {
      console.error("ohai_backup_cleanup_failed");
      throw new Error("ohai_backup_cleanup_failed");
    }
  }
} satisfies ExportedHandler<Env>;
