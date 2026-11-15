# ohai Cloud Backup Worker

This service is the backend for the local Cloud Backup pilot. D1 holds account, device, session, entitlement, key envelope, and snapshot metadata. R2 holds only encrypted snapshot bytes. The Worker treats the [client envelope](../../packages/ohai-backup/) as opaque data. Clients must encrypt a portable Notesnook archive before uploading.

## Contributor map

- [`src/index.ts`](src/index.ts) routes requests. [`src/backups.ts`](src/backups.ts) handles snapshot metadata, upload, download, and deletion. [`src/accounts.ts`](src/accounts.ts) owns the entitlement response. Schema changes belong in [`migrations/`](migrations/).
- For a backup metadata edit, start with [`test/backup.test.mjs`](test/backup.test.mjs). From the repository root, run `(cd servers/ohai-backup && node --test test/backup.test.mjs)` with dependencies installed. For client/server protocol changes, also run the [client integration check](../../packages/ohai-backup/README.md#contributor-map).
- [`src/auth.ts`](src/auth.ts) owns Google sign-in and session handling. The [mobile Login map](../../apps/mobile/app/features/login/README.md) lists its focused mock OAuth test.

Report the command, first failing test and error, and full-log path. See the [backup-metadata benchmark task](../../scripts/agent-benchmark/README.md).

## Run locally

Use Node 22.23 or later in the 22.x line, 24.22 or later in the 24.x line, or 26.12 or later in the 26.x line for the pinned Cloudflare CLI.

```sh
npm ci
npm run typecheck
npm test
npx cf build --mode development
npx cf d1 migrations apply a11163cd-494d-41fc-85c0-0a7b8f8d9930 \
  --local --mode development --persist-to .cloudflare/state
npx cf dev --mode development
curl -f http://localhost:8787/health
```

The migration ID above belongs only to the local simulator. Miniflare integration tests apply the same migration to isolated bindings and seed synthetic accounts and entitlements directly in the test database. The Google test signs fixture ID tokens and mocks Google's token and key endpoints. There is no test account, administrative grant route, or test credential in the Worker.

## API

Web sign-in starts at `GET /auth/google/start?returnTo=/settings` and returns to `GET /auth/google/callback`. The callback exchanges the authorization code with PKCE, consumes one-time state bound to a host-only browser cookie, and checks the ID token signature, issuer, audience, expiry, and nonce. The app session uses a host-only, Secure, HttpOnly cookie on HTTPS. Cookie-authenticated writes require the exact app origin. Sign-out uses `POST /auth/sign-out`.

The iOS app uses the same Google identity mapping through a separate OAuth entry point. The system authentication browser opens `/ohai/auth/google/start` with an app-generated PKCE challenge. Google returns to `/ohai/auth/google/callback`. After verifying Google’s response, the Worker returns a two-minute, single-use code at `/ohai/auth/native/complete`. Only the app holding the verifier can exchange that code at `POST /ohai/auth/native/exchange`. The exchange returns a revocable ohai session stored in iOS Keychain. Sign in again after the session expires. Refresh rotation and Sign in with Apple remain open.

| Operation                     | Request                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account and device            | `GET /v1/me` returns the internal account and device UUIDs, optional display data, and opt-in state.                                                                                                                                                                                                                                                                                                          |
| Plan and usage                | `GET /v1/entitlement` returns upload and download access, Unix milliseconds for cutoff times, and committed ciphertext bytes.                                                                                                                                                                                                                                                                                 |
| Opt in or pause               | `PUT /v1/device/backup` with `{"enabled":true}`, or `PUT /v1/vault/pause` with `{"paused":true}` for the whole account.                                                                                                                                                                                                                                                                                       |
| Read or replace a wrapped key | `GET /v1/vault/key-envelope` or `PUT /v1/vault/key-envelope` with `formatVersion: 1`, `keyVersion`, `previousKeyVersion`, and an opaque base64url `envelope`. Start at key version 1 with previous version 0. Replacement requires a recent provider sign-in and an upload-eligible subscription. Rewrapping replaces the previous wrapper, so use the existing vault key to keep earlier snapshots readable. |
| Reserve                       | `POST /v1/backups` with an `Idempotency-Key` header and `formatVersion: 1`, `keyVersion`, `deviceId`, `sizeBytes`, and lowercase hex `sha256`. Persist the idempotency key with the ciphertext until committed.                                                                                                                                                                                               |
| Upload                        | `PUT /v1/backups/{id}/content` with raw ciphertext and `Content-Type: application/octet-stream`. A retry must send identical bytes.                                                                                                                                                                                                                                                                           |
| Commit                        | `POST /v1/backups/{id}/commit` verifies size and SHA-256 in R2 and rechecks access before publication.                                                                                                                                                                                                                                                                                                        |
| List and download             | `GET /v1/backups` returns committed metadata. `GET /v1/backups/{id}/content` streams ciphertext and sets `Content-Length` and `X-Ohai-Sha256`.                                                                                                                                                                                                                                                                |
| Delete                        | `DELETE /v1/backups/{id}` hides the snapshot and queues object deletion. `POST /v1/account/deletion` requires recent authentication, blocks every session immediately, clears the wrapped key, and queues removal of pending and committed objects.                                                                                                                                                           |
| Revoke a device               | `POST /v1/devices/{id}/revoke` requires recent authentication.                                                                                                                                                                                                                                                                                                                                                |

Private responses send `Cache-Control: no-store`. Errors use `{"error":"CODE"}`.

The pilot allows two committed generations and one staging reservation per account, with a 50 MiB ciphertext cap per snapshot. Uploads use a bounded stream and a single-writer lease. D1 marks an older generation for deletion only after a replacement has committed. The scheduled cleanup retries deletes and reconciles orphaned R2 objects. Expiry blocks download at its cutoff. Expiry-driven purge additionally waits for a billing reconciliation to confirm the provider state at or after the cutoff. User-requested deletion follows its own path.

## Staging and production setup

The Cloudflare config defines separate Worker and private bucket names for development, staging, and production. Each remote mode requires its own `OHAI_D1_ID_<MODE>` and HTTPS `OHAI_APP_ORIGIN_<MODE>`, where `<MODE>` is `STAGING` or `PRODUCTION`. Leave R2 public access disabled. Use a dedicated Google OAuth client per environment. Set `OHAI_GOOGLE_CLIENT_ID_<MODE>`, an explicit `OHAI_GOOGLE_ALLOWED_EMAILS_<MODE>` allowlist for the pilot, and a Worker secret named `GOOGLE_CLIENT_SECRET`. The callback is `<app-origin>/auth/google/callback`. Confirm the Google project, audience, consent branding, and redirect allowlist in Google before a live sign-in test.

The Worker currently serves the API only. Once the branded `apps/web` build is ready, configure a Workers Static Assets binding for its output directory, enable the SPA fallback for client routes, and run the Worker first for `/auth/*`, `/v1/*`, and `/health`. This lets the web client use same-origin API requests and its host-only session cookie. Apply the web app's reviewed CSP on its HTML and keep private responses out of service-worker caches. [Workers Static Assets routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)

Before enabling a live pilot, implement provider-verified Stripe and StoreKit entitlement ingestion and reconciliation. The service currently reads entitlement state from D1, and its integration tests seed that state directly. Live native handoff verification, Sign in with Apple, account linking, UI integration, real Notesnook cross-device restore, and paid release validation also remain open. The local tests use synthetic ciphertext and do not establish archive compatibility or production behavior.

## iOS sign-in on healearth.club

The iOS build uses `https://healearth.club/ohai`. Route only `healearth.club/ohai/*` to the ohai Worker. Serve `https://healearth.club/.well-known/apple-app-site-association` as public JSON from that Worker or merge the ohai entry into the site's association file if one is shared. The app declares both `applinks:healearth.club` and `webcredentials:healearth.club`, so the association file includes the exact signed app identifier in both services.

Set `OHAI_APP_ORIGIN_PRODUCTION=https://healearth.club` and `OHAI_IOS_APP_ID_PRODUCTION=BA229RB5M8.org.healearth.ohai` for this app. Apply the D1 migrations including `0002_native_google.sql` and register the exact redirect URI `https://healearth.club/ohai/auth/google/callback` in the Google OAuth web client. Set its client ID and allowlist in the Worker configuration and store the secret as a Worker secret. Verify that `/ohai/auth/native/status` returns `{"ready":true}`, that the association file is served without redirects, and then verify the full flow from a signed iPhone build. The existing HealEarth site's Google callback remains `/auth/google/callback`.

The native Google handoff uses Apple's HTTPS callback API, available on iOS 17.4 and newer. The iOS app still offers local use without signing in. [Apple authentication session callback](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession/init(url:callback:completionhandler:)-6nut7) · [Google branding guidelines](https://developers.google.com/identity/branding-guidelines)
