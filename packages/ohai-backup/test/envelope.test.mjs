import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  decryptSnapshot,
  encryptSnapshot,
  generateRecoveryKey,
  generateVaultKey,
  snapshotUploadMetadata,
  unwrapVaultKey,
  wrapVaultKey
} from "../dist/index.js";

const vector = JSON.parse(
  await readFile(new URL("./vector-v1.json", import.meta.url), "utf8")
);
const bytes = (hex) => Uint8Array.from(Buffer.from(hex, "hex"));

test("reads an independently generated libsodium and Node HKDF vector", () => {
  const { context, recoveryKey, keyEnvelope } = vector;
  const vaultKey = unwrapVaultKey(context.accountId, recoveryKey, keyEnvelope);
  assert.deepEqual(vaultKey, bytes(vector.vaultKey));
  const snapshot = bytes(vector.snapshot);
  assert.deepEqual(
    decryptSnapshot(context, vaultKey, snapshot),
    bytes(vector.archive)
  );
  assert.deepEqual(snapshotUploadMetadata(context, "test-device", snapshot), {
    formatVersion: 1,
    keyVersion: context.keyVersion,
    sizeBytes: snapshot.length,
    sha256: vector.sha256,
    deviceId: "test-device"
  });
});

test("rewraps the vault key while preserving existing snapshots", () => {
  const context = vector.context;
  const vaultKey = generateVaultKey();
  const oldRecoveryKey = generateRecoveryKey();
  const oldEnvelope = wrapVaultKey(
    context.accountId,
    context.keyVersion,
    oldRecoveryKey,
    vaultKey
  );
  assert.deepEqual(
    unwrapVaultKey(context.accountId, oldRecoveryKey, oldEnvelope),
    vaultKey
  );

  const archive = bytes(vector.archive);
  const snapshot = encryptSnapshot(context, vaultKey, archive);
  assert.notDeepEqual(encryptSnapshot(context, vaultKey, archive), snapshot);
  const newRecoveryKey = generateRecoveryKey();
  const newEnvelope = wrapVaultKey(
    context.accountId,
    context.keyVersion + 1,
    newRecoveryKey,
    vaultKey
  );
  const restoredKey = unwrapVaultKey(
    context.accountId,
    newRecoveryKey,
    newEnvelope
  );
  assert.deepEqual(decryptSnapshot(context, restoredKey, snapshot), archive);
  assert.throws(() =>
    unwrapVaultKey(context.accountId, oldRecoveryKey, newEnvelope)
  );
});

test("rejects wrong accounts, changed metadata, and damaged ciphertext", () => {
  const context = vector.context;
  const snapshot = bytes(vector.snapshot);
  const vaultKey = bytes(vector.vaultKey);
  const otherAccount = "ffeeddcc-bbaa-4988-8766-554433221100";
  assert.throws(() =>
    unwrapVaultKey(otherAccount, vector.recoveryKey, vector.keyEnvelope)
  );
  assert.throws(() =>
    decryptSnapshot({ ...context, accountId: otherAccount }, vaultKey, snapshot)
  );
  assert.throws(() =>
    decryptSnapshot({ ...context, payloadVersion: 2 }, vaultKey, snapshot)
  );
  assert.throws(() =>
    decryptSnapshot(
      context,
      vaultKey,
      snapshot.subarray(0, snapshot.length - 1)
    )
  );
  snapshot[snapshot.length - 1] ^= 1;
  assert.throws(() => decryptSnapshot(context, vaultKey, snapshot));
});
