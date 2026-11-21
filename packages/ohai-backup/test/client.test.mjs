import assert from "node:assert/strict";
import { test } from "node:test";
import { generateVaultKey } from "../dist/index.js";
import { BackupApiError, BackupClient, prepareBackup } from "../dist/client.js";

test("resumes an uploaded snapshot when the commit response is lost", async () => {
  const context = {
    accountId: "00112233-4455-4677-8899-aabbccddeeff",
    keyVersion: 1,
    payloadVersion: 1
  };
  const deviceId = "0fedcba9-8765-4321-8112-abcdefabcdef";
  const vaultKey = generateVaultKey();
  const archive = Uint8Array.of(80, 75, 3, 4);
  const backup = prepareBackup(
    context,
    deviceId,
    "example-retry",
    vaultKey,
    archive
  );
  const record = {
    ...backup.metadata,
    id: "snapshot-id",
    status: "reserved",
    reservedAt: 1,
    committedAt: null
  };
  let writes = 0;
  let commitAttempts = 0;
  let damaged = false;
  const fetcher = async (url, init) => {
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    assert.equal(init.headers.get("authorization"), "Bearer test-token");
    switch (`${init.method ?? "GET"} ${new URL(url).pathname}`) {
      case "POST /v1/backups":
        assert.equal(init.headers.get("idempotency-key"), "example-retry");
        assert.deepEqual(JSON.parse(init.body), backup.metadata);
        return Response.json(record);
      case "PUT /v1/backups/snapshot-id/content":
        assert.deepEqual(init.body, backup.ciphertext);
        writes++;
        record.status = "uploaded";
        return Response.json(record);
      case "POST /v1/backups/snapshot-id/commit":
        commitAttempts++;
        if (commitAttempts === 1) throw new Error("Connection lost");
        record.status = "committed";
        record.committedAt = 2;
        return Response.json(record);
      case "GET /v1/backups/snapshot-id/content": {
        const content = backup.ciphertext.slice();
        if (damaged) content[content.length - 1] ^= 1;
        return new Response(content, {
          headers: {
            "content-length": String(record.sizeBytes),
            "x-ohai-sha256": record.sha256
          }
        });
      }
      default:
        return Response.json({ error: "INVALID_ROUTE" }, { status: 404 });
    }
  };

  const client = new BackupClient(
    "https://notes.example.com",
    async () => "test-token",
    fetcher
  );
  await assert.rejects(client.upload(backup), /Connection lost/);
  const result = await client.upload(backup);
  assert.equal(result.status, "committed");
  assert.equal(writes, 1);
  assert.deepEqual(
    await client.downloadAndDecrypt(result, context, vaultKey),
    archive
  );

  damaged = true;
  await assert.rejects(
    client.downloadAndDecrypt(result, context, vaultKey),
    /checksum/
  );
});

test("surfaces stable authorization errors and uses web session cookies", async () => {
  const client = new BackupClient(
    "https://notes.example.com",
    undefined,
    async (_url, init) => {
      assert.equal(init.credentials, "same-origin");
      assert.equal(init.headers.has("authorization"), false);
      return Response.json({ error: "SESSION_EXPIRED" }, { status: 401 });
    }
  );
  await assert.rejects(
    client.account(),
    (error) =>
      error instanceof BackupApiError &&
      error.status === 401 &&
      error.code === "SESSION_EXPIRED"
  );
});
