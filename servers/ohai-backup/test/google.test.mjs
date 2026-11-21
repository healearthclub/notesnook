import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { MockAgent } from "undici";
import { startWorker } from "./fixtures.mjs";

const clientId = "ohai-staging.apps.googleusercontent.com";
const email = "developer@example.test";

test("Google flow consumes browser-bound state and validates signed identity instead of linking email", async () => {
  const keys = await generateKeyPair("RS256", { extractable: true });
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: "fixture",
    alg: "RS256",
    use: "sig"
  };
  const mock = new MockAgent();
  mock.disableNetConnect();
  mock
    .get("https://www.googleapis.com")
    .intercept({ path: "/oauth2/v3/certs" })
    .reply(200, { keys: [jwk] })
    .persist();
  const worker = await startWorker({
    fetchMock: mock,
    bindings: {
      GOOGLE_CLIENT_ID: clientId,
      GOOGLE_CLIENT_SECRET: "local-test-fixture",
      GOOGLE_ALLOWED_EMAILS: email,
      IOS_APP_ID: "BA229RB5M8.org.healearth.ohai"
    }
  });

  async function start(returnTo = "/settings", nativeChallenge) {
    const prefix = nativeChallenge ? "/ohai" : "";
    const reply = await worker.fetch(
      prefix +
        "/auth/google/start?returnTo=" +
        encodeURIComponent(returnTo) +
        (nativeChallenge ? "&native_challenge=" + nativeChallenge : "")
    );
    assert.equal(reply.status, 303);
    const authorize = new URL(reply.headers.get("location"));
    const query = authorize.searchParams;
    assert.equal(authorize.origin, "https://accounts.google.com");
    assert.equal(query.get("scope"), "openid email profile");
    assert.equal(
      query.get("redirect_uri"),
      worker.origin + prefix + "/auth/google/callback"
    );
    assert.equal(query.get("code_challenge_method"), "S256");
    const state = query.get("state");
    const stateHash = createHash("sha256").update(state).digest("base64url");
    const flow = await worker.db
      .prepare("SELECT verifier FROM oauth_flows WHERE state_hash = ?")
      .bind(stateHash)
      .first();
    assert.equal(
      query.get("code_challenge"),
      createHash("sha256").update(flow.verifier).digest("base64url")
    );
    const flowCookie = reply.headers.get("set-cookie");
    assert.match(
      flowCookie,
      /^__Host-ohai-oauth=[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/
    );
    return {
      nonce: query.get("nonce"),
      callback:
        prefix + "/auth/google/callback?code=provider-test-code&state=" + state,
      cookie: flowCookie.split(";")[0]
    };
  }

  async function complete(flow, subject, overrides = {}) {
    const token = await new SignJWT({
      email,
      email_verified: true,
      nonce: flow.nonce,
      name: "Test account",
      ...overrides
    })
      .setProtectedHeader({ alg: "RS256", kid: "fixture" })
      .setSubject(subject)
      .setIssuer("https://accounts.google.com")
      .setAudience(overrides.aud || clientId)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(keys.privateKey);
    mock
      .get("https://oauth2.googleapis.com")
      .intercept({ path: "/token", method: "POST" })
      .reply(200, { id_token: token });
    return worker.fetch(flow.callback, { headers: { Cookie: flow.cookie } });
  }

  try {
    const flow = await start("//example.com/external");
    assert.equal(
      (
        await worker.fetch(flow.callback, {
          headers: { Cookie: "__Host-ohai-oauth=" + "X".repeat(43) }
        })
      ).status,
      401
    );
    const first = await complete(flow, "google-subject-1");
    assert.equal(first.status, 303);
    assert.equal(first.headers.get("location"), worker.origin + "/");
    const session = first.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("__Host-ohai-session="));
    assert.match(session, /; HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/);
    const cookie = session.split(";")[0];
    const profile = await (
      await worker.fetch("/v1/me", { headers: { Cookie: cookie } })
    ).json();
    assert.equal(profile.email, email);
    assert.equal(profile.backupOptIn, false);
    assert.equal(
      (await worker.fetch(flow.callback, { headers: { Cookie: flow.cookie } }))
        .status,
      401
    );

    for (const claims of [{ aud: "wrong-client" }, { nonce: "wrong-nonce" }]) {
      const invalid = await complete(await start(), "google-subject-1", claims);
      assert.equal(invalid.status, 401);
    }
    const ready = await worker.fetch("/ohai/auth/native/status");
    assert.equal(ready.status, 200);
    const association = await (
      await worker.fetch("/.well-known/apple-app-site-association")
    ).json();
    assert.deepEqual(association.webcredentials.apps, [
      "BA229RB5M8.org.healearth.ohai"
    ]);

    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const nativeFlow = await start("/settings", challenge);
    const handoffReply = await complete(nativeFlow, "google-subject-1");
    assert.equal(handoffReply.status, 303);
    const handoff = new URL(handoffReply.headers.get("location"));
    assert.equal(handoff.origin, worker.origin);
    assert.equal(handoff.pathname, "/ohai/auth/native/complete");
    assert.equal(
      handoffReply.headers
        .getSetCookie()
        .some((value) => value.startsWith("__Host-ohai-session=")),
      false
    );

    const nativeCode = handoff.searchParams.get("code");
    const exchange = (value) =>
      worker.fetch("/ohai/auth/native/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: nativeCode, verifier: value })
      });
    assert.equal(
      (await exchange(randomBytes(32).toString("base64url"))).status,
      401
    );
    const exchanged = await exchange(verifier);
    assert.equal(exchanged.status, 200);
    const { token, email: nativeEmail } = await exchanged.json();
    assert.equal(nativeEmail, email);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal((await exchange(verifier)).status, 401);
    const nativeProfile = await (
      await worker.fetch("/v1/me", {
        headers: { Authorization: "Bearer " + token }
      })
    ).json();
    assert.equal(nativeProfile.accountId, profile.accountId);
    assert.notEqual(nativeProfile.deviceId, profile.deviceId);

    const second = await complete(await start(), "google-subject-2");
    assert.equal(second.status, 303);
    const secondCookie = second.headers
      .getSetCookie()
      .find((value) => value.startsWith("__Host-ohai-session="))
      .split(";")[0];
    const secondProfile = await (
      await worker.fetch("/v1/me", { headers: { Cookie: secondCookie } })
    ).json();
    assert.equal(secondProfile.email, profile.email);
    assert.notEqual(secondProfile.accountId, profile.accountId);

    assert.equal(
      (
        await worker.fetch("/auth/sign-out", {
          method: "POST",
          headers: { Cookie: cookie, Origin: worker.origin }
        })
      ).status,
      200
    );
    assert.equal(
      (await worker.fetch("/v1/me", { headers: { Cookie: cookie } })).status,
      401
    );
  } finally {
    await worker.mf.dispose();
    await mock.close();
  }
});
