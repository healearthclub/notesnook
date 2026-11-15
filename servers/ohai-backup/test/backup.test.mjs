import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { seedAccount, startWorker } from "./fixtures.mjs";

let worker;
before(async () => {
  worker = await startWorker();
});
after(async () => {
  await worker?.mf.dispose();
});

const uploadHeaders = { "Content-Type": "application/octet-stream" };

function api(user, method, path, body, headers = {}) {
  if (
    body !== undefined &&
    !(body instanceof Uint8Array) &&
    !(body instanceof ReadableStream)
  ) {
    body = JSON.stringify(body);
    headers = { "Content-Type": "application/json", ...headers };
  }
  return worker.fetch(path, {
    method,
    headers: { Authorization: `Bearer ${user.token}`, ...headers },
    body,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {})
  });
}

async function expectStatus(response, status) {
  const result = await response;
  assert.equal(
    result.status,
    status,
    status === result.status ? undefined : await result.text()
  );
  assert.equal(result.headers.get("cache-control"), "no-store");
  return result;
}

async function expectError(response, status, error) {
  assert.deepEqual(await (await expectStatus(response, status)).json(), {
    error
  });
}

function snapshot(user, bytes) {
  return {
    formatVersion: 1,
    keyVersion: 1,
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    deviceId: user.deviceId
  };
}

function reserve(user, bytes, key = randomUUID(), metadata = {}) {
  return api(
    user,
    "POST",
    "/v1/backups",
    { ...snapshot(user, bytes), ...metadata },
    { "Idempotency-Key": key }
  );
}

async function committed(user, bytes) {
  const { id } = await (await expectStatus(reserve(user, bytes), 201)).json();
  await expectStatus(
    api(user, "PUT", `/v1/backups/${id}/content`, bytes, uploadHeaders),
    200
  );
  const committedResponse = await expectStatus(
    api(user, "POST", `/v1/backups/${id}/commit`),
    200
  );
  return committedResponse.json();
}

test("protects sessions, origin, device opt-in, entitlement and recent key rotation", async () => {
  const user = await seedAccount(worker.db);
  await expectError(worker.fetch("/v1/me"), 401, "SESSION_REQUIRED");

  const cookie = `__Host-ohai-session=${user.token}`;
  const cookieWrite = (origin) =>
    worker.fetch("/v1/device/backup", {
      method: "PUT",
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ enabled: true })
    });
  await expectError(
    cookieWrite("https://elsewhere.test"),
    403,
    "ORIGIN_FORBIDDEN"
  );
  await expectError(
    reserve(user, Buffer.from("ciphertext")),
    403,
    "UPLOAD_UNAVAILABLE"
  );
  await expectStatus(cookieWrite(worker.origin), 200);
  await expectError(
    reserve(user, Buffer.from("ciphertext")),
    409,
    "KEY_VERSION_CONFLICT"
  );

  const envelope = {
    formatVersion: 1,
    keyVersion: 1,
    previousKeyVersion: 0,
    envelope: "S".repeat(128)
  };
  await expectStatus(api(user, "PUT", "/v1/vault/key-envelope", envelope), 201);
  await expectError(
    api(user, "PUT", "/v1/vault/key-envelope", envelope),
    409,
    "KEY_VERSION_CONFLICT"
  );
  const otherDevice = await seedAccount(worker.db, {
    accountId: user.accountId,
    authenticatedAt: Date.now() - 600_001
  });
  await expectError(
    api(otherDevice, "PUT", "/v1/vault/key-envelope", {
      ...envelope,
      keyVersion: 2,
      previousKeyVersion: 1
    }),
    403,
    "RECENT_AUTH_REQUIRED"
  );
  await expectStatus(
    api(user, "PUT", "/v1/vault/key-envelope", {
      ...envelope,
      keyVersion: 2,
      previousKeyVersion: 1,
      envelope: "T".repeat(128)
    }),
    200
  );
  assert.deepEqual(
    await (
      await expectStatus(api(user, "GET", "/v1/vault/key-envelope"), 200)
    ).json(),
    {
      formatVersion: 1,
      keyVersion: 2,
      envelope: "T".repeat(128)
    }
  );
  const keyCount = await worker.db
    .prepare("SELECT COUNT(*) AS count FROM key_envelopes WHERE account_id = ?")
    .bind(user.accountId)
    .first("count");
  assert.equal(keyCount, 1);
  await expectStatus(
    api(user, "POST", `/v1/devices/${otherDevice.deviceId}/revoke`),
    200
  );
  await expectError(api(otherDevice, "GET", "/v1/me"), 401, "SESSION_EXPIRED");

  const unpaid = await seedAccount(worker.db, {
    optedIn: true,
    entitled: false,
    seedKey: true
  });
  await expectError(
    reserve(unpaid, Buffer.from("ciphertext")),
    403,
    "UPLOAD_UNAVAILABLE"
  );
  await expectError(
    api(unpaid, "GET", "/v1/backups"),
    403,
    "DOWNLOAD_UNAVAILABLE"
  );
});

test("isolates accounts, validates ciphertext and makes matching retries safe", async () => {
  const user = await seedAccount(worker.db, { optedIn: true, seedKey: true });
  const other = await seedAccount(worker.db, { optedIn: true, seedKey: true });
  const sameAccount = await seedAccount(worker.db, {
    accountId: user.accountId,
    optedIn: true
  });
  const bytes = Buffer.from("ciphertext bytes");
  const key = randomUUID();
  const { id } = await (
    await expectStatus(reserve(user, bytes, key), 201)
  ).json();
  assert.equal(
    (await (await expectStatus(reserve(user, bytes, key), 200)).json()).id,
    id
  );
  await expectError(
    reserve(user, Buffer.from("different data"), key),
    409,
    "IDEMPOTENCY_CONFLICT"
  );
  await expectError(
    reserve(user, bytes, randomUUID(), { sizeBytes: 50 * 1024 * 1024 + 1 }),
    413,
    "SNAPSHOT_TOO_LARGE"
  );
  const content = `/v1/backups/${id}/content`;
  await expectError(api(other, "GET", content), 404, "BACKUP_NOT_FOUND");
  await expectError(
    api(other, "DELETE", `/v1/backups/${id}`),
    404,
    "BACKUP_NOT_FOUND"
  );
  await expectError(
    api(other, "PUT", content, bytes, uploadHeaders),
    404,
    "BACKUP_NOT_FOUND"
  );
  await expectError(
    api(sameAccount, "PUT", content, bytes, uploadHeaders),
    404,
    "BACKUP_NOT_FOUND"
  );
  await expectError(
    api(user, "POST", `/v1/backups/${id}/commit`),
    409,
    "SNAPSHOT_NOT_UPLOADED"
  );
  const wrong = Buffer.alloc(bytes.byteLength, 0xff);
  await expectError(
    api(user, "PUT", content, wrong, uploadHeaders),
    409,
    "PAYLOAD_MISMATCH"
  );
  assert.equal(await worker.bucket.head(`snapshot/${id}`), null);
  await expectError(
    api(user, "PUT", content, Buffer.concat([bytes, bytes]), uploadHeaders),
    409,
    "PAYLOAD_MISMATCH"
  );
  await expectStatus(api(user, "PUT", content, bytes, uploadHeaders), 200);
  await expectError(
    api(user, "PUT", content, wrong, uploadHeaders),
    409,
    "PAYLOAD_MISMATCH"
  );
  await expectStatus(api(user, "PUT", content, bytes, uploadHeaders), 200);
  await expectError(api(user, "GET", content), 404, "BACKUP_NOT_FOUND");
  await expectStatus(api(user, "POST", `/v1/backups/${id}/commit`), 200);
  await expectStatus(api(user, "POST", `/v1/backups/${id}/commit`), 200);
  const response = await expectStatus(api(sameAccount, "GET", content), 200);
  assert.equal(
    response.headers.get("x-ohai-sha256"),
    snapshot(user, bytes).sha256
  );
  assert.equal(
    response.headers.get("content-length"),
    String(bytes.byteLength)
  );
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.deepEqual(
    (await (await expectStatus(api(other, "GET", "/v1/backups"), 200)).json())
      .backups,
    []
  );
});

test("serializes reservation, preserves generations on failed commit and cleans up staged objects", async () => {
  const user = await seedAccount(worker.db, { optedIn: true, seedKey: true });
  const second = await seedAccount(worker.db, {
    accountId: user.accountId,
    optedIn: true
  });
  const bytes = Buffer.from("first generation");
  const first = await committed(user, bytes);
  const another = await committed(second, Buffer.from("second generation"));
  const pendingBytes = Buffer.from("third generation");
  const simultaneous = await Promise.all([
    reserve(user, pendingBytes),
    reserve(second, pendingBytes)
  ]);
  assert.deepEqual(simultaneous.map(({ status }) => status).sort(), [201, 409]);
  const { id, deviceId } = await simultaneous
    .find(({ status }) => status === 201)
    .json();
  const writer = deviceId === user.deviceId ? user : second;
  const content = `/v1/backups/${id}/content`;
  const broken = new ReadableStream({
    start(controller) {
      controller.enqueue(pendingBytes.subarray(0, 2));
      controller.close();
    }
  });
  await expectError(
    api(writer, "PUT", content, broken, uploadHeaders),
    409,
    "PAYLOAD_MISMATCH"
  );
  assert.equal(await worker.bucket.head(`snapshot/${id}`), null);
  await expectStatus(
    api(writer, "PUT", content, pendingBytes, uploadHeaders),
    200
  );
  await expectStatus(
    api(user, "PUT", "/v1/vault/pause", { paused: true }),
    200
  );
  await expectError(
    api(writer, "POST", `/v1/backups/${id}/commit`),
    403,
    "UPLOAD_UNAVAILABLE"
  );
  assert.deepEqual(
    (
      await (await expectStatus(api(user, "GET", "/v1/backups"), 200)).json()
    ).backups
      .map((b) => b.id)
      .sort(),
    [first.id, another.id].sort()
  );
  await expectStatus(
    api(user, "PUT", "/v1/vault/pause", { paused: false }),
    200
  );
  await expectStatus(api(writer, "POST", `/v1/backups/${id}/commit`), 200);
  assert.deepEqual(
    (
      await (await expectStatus(api(user, "GET", "/v1/backups"), 200)).json()
    ).backups
      .map((b) => b.id)
      .sort(),
    [another.id, id].sort()
  );
  assert.ok(await worker.bucket.head(`snapshot/${first.id}`));
  await expectStatus(worker.fetch("/_test/cleanup", { method: "POST" }), 204);
  assert.equal(await worker.bucket.head(`snapshot/${first.id}`), null);

  await worker.db
    .prepare(
      "UPDATE entitlements SET upload_until = ?, download_until = ? WHERE account_id = ?"
    )
    .bind(Date.now() - 1000, Date.now() + 3600_000, user.accountId)
    .run();
  await expectError(reserve(user, bytes), 403, "UPLOAD_UNAVAILABLE");
  await expectStatus(api(user, "GET", content), 200);

  await worker.db
    .prepare("UPDATE entitlements SET download_until = ? WHERE account_id = ?")
    .bind(Date.now() - 1, user.accountId)
    .run();
  await expectError(api(user, "GET", content), 403, "DOWNLOAD_UNAVAILABLE");
  await expectStatus(worker.fetch("/_test/cleanup", { method: "POST" }), 204);
  assert.ok(await worker.bucket.head(`snapshot/${id}`));
  await worker.db
    .prepare(
      "UPDATE entitlements SET purge_confirmed_at = ? WHERE account_id = ?"
    )
    .bind(Date.now(), user.accountId)
    .run();
  await expectStatus(worker.fetch("/_test/cleanup", { method: "POST" }), 204);
  assert.equal(await worker.bucket.head(`snapshot/${id}`), null);
});

test("deletion immediately revokes all devices and queues removal of committed and pending blobs", async () => {
  const user = await seedAccount(worker.db, { optedIn: true, seedKey: true });
  const second = await seedAccount(worker.db, {
    accountId: user.accountId,
    optedIn: true
  });
  const bytes = Buffer.from("private ciphertext");
  const first = await committed(user, bytes);
  const pending = await (
    await expectStatus(reserve(second, bytes), 201)
  ).json();
  await expectStatus(
    api(
      second,
      "PUT",
      `/v1/backups/${pending.id}/content`,
      bytes,
      uploadHeaders
    ),
    200
  );
  await expectStatus(api(user, "POST", "/v1/account/deletion"), 202);
  await expectError(api(user, "GET", "/v1/backups"), 401, "SESSION_EXPIRED");
  await expectError(
    api(second, "POST", `/v1/backups/${pending.id}/commit`),
    401,
    "SESSION_EXPIRED"
  );
  await expectStatus(worker.fetch("/_test/cleanup", { method: "POST" }), 204);
  assert.equal(await worker.bucket.head(`snapshot/${first.id}`), null);
  assert.equal(await worker.bucket.head(`snapshot/${pending.id}`), null);
  assert.equal(
    await worker.db
      .prepare("SELECT count(*) AS c FROM backups WHERE account_id = ?")
      .bind(user.accountId)
      .first("c"),
    0
  );
});
