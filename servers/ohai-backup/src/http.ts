export interface Env {
  DB: D1Database;
  BACKUPS: R2Bucket;
  APP_ORIGIN: string;
  IOS_APP_ID?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_ALLOWED_EMAILS?: string;
  GOOGLE_PUBLIC_SIGNUP?: string;
}

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

export function fail(status: number, code: string): never {
  throw new HttpError(status, code);
}

export function json(value: unknown, status = 200) {
  return Response.json(value, { status });
}

export async function readJson(
  request: Request
): Promise<Record<string, unknown>> {
  if (
    !request.headers.get("content-type")?.match(/^application\/json(?:\s*;|$)/i)
  ) {
    fail(415, "JSON_REQUIRED");
  }
  const body = request.body?.getReader();
  if (!body) fail(400, "INVALID_BODY");
  const limit = 16_384;
  const bytes = new Uint8Array(limit);
  let size = 0;
  try {
    while (true) {
      const chunk = await body.read();
      if (chunk.done) break;
      if (size + chunk.value.byteLength > limit) {
        await body.cancel();
        fail(413, "REQUEST_TOO_LARGE");
      }
      bytes.set(chunk.value, size);
      size += chunk.value.byteLength;
    }
    const result: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
        bytes.subarray(0, size)
      )
    );
    if (!result || typeof result !== "object" || Array.isArray(result))
      fail(400, "INVALID_BODY");
    return result as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    fail(400, "INVALID_BODY");
  } finally {
    body.releaseLock();
  }
}

export const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const tokenPattern = /^[a-zA-Z0-9_-]{43}$/;

export function toBase64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function randomToken() {
  return toBase64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(value: string) {
  return toBase64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    )
  );
}

export function toHex(value: ArrayBuffer) {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function readCookie(request: Request, name: string) {
  const prefix = `${name}=`;
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix))
    ?.slice(prefix.length);
}

export function cookie(
  name: string,
  value: string,
  maxAge: number,
  secure: boolean
) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${
    secure ? "; Secure" : ""
  }`;
}

export function serviceOrigin(env: Env) {
  let origin: URL;
  try {
    origin = new URL(env.APP_ORIGIN);
  } catch {
    fail(503, "ORIGIN_NOT_CONFIGURED");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "https:" && !(local && origin.protocol === "http:"))
  ) {
    fail(503, "ORIGIN_NOT_CONFIGURED");
  }
  return { origin: origin.origin, secure: origin.protocol === "https:" };
}

export function checkOrigin(request: Request, env: Env) {
  const { origin } = serviceOrigin(env);
  if (
    new URL(request.url).origin !== origin ||
    request.headers.get("origin") !== origin
  ) {
    fail(403, "ORIGIN_FORBIDDEN");
  }
}

export function safeReturnPath(value: string | null, origin: string) {
  if (
    !value?.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f\u007f]/.test(value)
  )
    return "/";
  const result = new URL(value, origin);
  if (result.origin !== origin) return "/";
  return result.pathname + result.search + result.hash;
}

export function redirect(location: string, cookies: string[]) {
  const headers = new Headers({ Location: location });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 303, headers });
}
