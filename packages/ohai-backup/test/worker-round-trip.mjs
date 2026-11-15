import assert from "node:assert/strict";
import { test } from "node:test";
import {
  seedAccount,
  startWorker
} from "../../../servers/ohai-backup/test/fixtures.mjs";
import {
  generateRecoveryKey,
  generateVaultKey,
  unwrapVaultKey,
  wrapVaultKey
} from "../dist/index.js";
import { BackupApiError, BackupClient, prepareBackup } from "../dist/client.js";

test("round-trips an encrypted snapshot through the local Worker and private R2", async (t) => {
  const { mf, db, bucket, origin, fetch } = await startWorker();
  t.after(() => mf.dispose());
  const owner = await seedAccount(db);
  const restoreDevice = await seedAccount(db, { accountId: owner.accountId });
  const other = await seedAccount(db);
  const client = new BackupClient(origin, async () => owner.token, fetch);
  const restoreClient = new BackupClient(
    origin,
    async () => restoreDevice.token,
    fetch
  );
  const foreignClient = new BackupClient(
    origin,
    async () => other.token,
    fetch
  );

  const account = await client.account();
  assert.equal(account.accountId, owner.accountId);
  assert.equal(account.deviceId, owner.deviceId);
  const context = {
    accountId: owner.accountId,
    keyVersion: 1,
    payloadVersion: 1
  };
  const recoveryKey = generateRecoveryKey();
  const vaultKey = generateVaultKey();
  const keyEnvelope = wrapVaultKey(owner.accountId, 1, recoveryKey, vaultKey);
  await client.updateKeyEnvelope(keyEnvelope, 0);
  assert.equal((await client.entitlement()).uploadAllowed, false);
  await client.setBackupEnabled(true);
  assert.equal((await client.entitlement()).uploadAllowed, true);

  const archive = new TextEncoder().encode(
    "Synthetic private note title and content."
  );
  const prepared = prepareBackup(
    context,
    owner.deviceId,
    crypto.randomUUID(),
    vaultKey,
    archive
  );
  const result = await client.upload(prepared);
  assert.equal((await client.upload(prepared)).id, result.id);
  assert.deepEqual(
    (await client.listBackups()).map(({ id }) => id),
    [result.id]
  );
  assert.deepEqual(await foreignClient.listBackups(), []);
  await assert.rejects(
    foreignClient.downloadAndDecrypt(
      result,
      { ...context, accountId: other.accountId },
      vaultKey
    ),
    (error) => error instanceof BackupApiError && error.status === 404
  );

  const storedObjects = await bucket.list();
  assert.equal(storedObjects.objects.length, 1);
  const stored = await bucket.get(storedObjects.objects[0].key);
  assert.ok(stored);
  const storedBytes = new Uint8Array(await stored.arrayBuffer());
  assert.deepEqual(storedBytes, prepared.ciphertext);
  assert.equal(Buffer.from(storedBytes).includes(Buffer.from(archive)), false);

  const savedEnvelope = await restoreClient.keyEnvelope();
  const restoredKey = unwrapVaultKey(
    owner.accountId,
    recoveryKey,
    savedEnvelope
  );
  assert.deepEqual(
    await restoreClient.downloadAndDecrypt(result, context, restoredKey),
    archive
  );
  await restoreClient.signOut();
  await assert.rejects(
    restoreClient.account(),
    (error) => error instanceof BackupApiError && error.status === 401
  );
});
