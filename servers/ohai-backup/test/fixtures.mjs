import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const migrations = ["0001_backup.sql", "0002_native_google.sql"].map(
  (name) => new URL(`../migrations/${name}`, import.meta.url)
);
const fixtureOrigin = "https://backup.test";

export async function startWorker(options = {}) {
  const { outputFiles } = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("..", import.meta.url)),
      contents: `
        import worker from ${JSON.stringify(entry)};
        export default {
          ...worker,
          async fetch(request, env, ctx) {
            const url = new URL(request.url);
            if (request.method === "POST" && url.pathname === "/_test/cleanup") {
              await worker.scheduled({}, env, ctx);
              return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
            }
            return worker.fetch(request, env, ctx);
          }
        };
      `
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022"
  });
  const origin = options.origin || fixtureOrigin;
  const mf = new Miniflare({
    compatibilityDate: "2026-05-15",
    modules: [
      { type: "ESModule", path: "worker.mjs", contents: outputFiles[0].text }
    ],
    d1Databases: ["DB"],
    r2Buckets: ["BACKUPS"],
    bindings: { APP_ORIGIN: origin, ...options.bindings },
    fetchMock: options.fetchMock
  });

  try {
    const db = await mf.getD1Database("DB");
    const bucket = await mf.getR2Bucket("BACKUPS");
    const sql = await Promise.all(
      migrations.map((file) => readFile(file, "utf8"))
    );
    const statements = sql
      .join("\n")
      .split(";")
      .map((sql) => sql.trim())
      .filter(Boolean);
    await db.batch(statements.map((sql) => db.prepare(sql)));
    return {
      mf,
      db,
      bucket,
      origin,
      fetch: (path, init) =>
        mf.dispatchFetch(new URL(path, origin), { redirect: "manual", ...init })
    };
  } catch (error) {
    await mf.dispose();
    throw error;
  }
}

export async function seedAccount(db, options = {}) {
  const {
    accountId = randomUUID(),
    now = Date.now(),
    entitled = true,
    optedIn = false,
    seedKey = false,
    authenticatedAt = now
  } = options;
  const deviceId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("base64url");
  const statements = [
    db
      .prepare("INSERT OR IGNORE INTO accounts (id, created_at) VALUES (?, ?)")
      .bind(accountId, now),
    db
      .prepare(
        "INSERT INTO devices (id, account_id, created_at, backup_opt_in) VALUES (?, ?, ?, ?)"
      )
      .bind(deviceId, accountId, now, Number(optedIn)),
    db
      .prepare(
        "INSERT INTO sessions (token_hash, device_id, authenticated_at, expires_at) VALUES (?, ?, ?, ?)"
      )
      .bind(tokenHash, deviceId, authenticatedAt, now + 60 * 60 * 1000)
  ];
  if (entitled)
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO entitlements (account_id, provider, upload_until, download_until) VALUES (?, 'test', ?, ?)"
        )
        .bind(accountId, now + 60 * 60 * 1000, now + 24 * 60 * 60 * 1000)
    );
  if (seedKey)
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO key_envelopes (account_id, key_version, format_version, envelope) VALUES (?, 1, 1, ?)"
        )
        .bind(accountId, "Y".repeat(128))
    );
  await db.batch(statements);
  return { accountId, deviceId, token };
}
