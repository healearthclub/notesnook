# iOS Login

[GoogleScreen](google-screen.tsx) owns login and sign-up UI, labels, and the offline action. The existing [Auth route](../../components/auth/index.tsx) selects this screen on iOS.

| Change | File |
| --- | --- |
| Label, button, or error copy | [`google-screen.tsx`](google-screen.tsx) |
| Native handoff exchange and Keychain session | [`google-session.ts`](google-session.ts) |
| iOS system authentication browser | [`AppDelegate.mm`](../../../ios/Notesnook/AppDelegate.mm) |
| Google callback and account session | Heal Earth Club backend, `lib/google-auth.ts` and `app/ohai/auth/[...path]/route.ts` |

Run the smallest check for the layer you changed. These commands start at the repository root after dependencies are installed.

```sh
# Login screen or session code
./node_modules/.bin/eslint apps/mobile/app/features/login/google-screen.tsx apps/mobile/app/features/login/google-session.ts

# From the sibling Heal Earth Club checkout. Uses mock Google credentials.
(cd ../heal-earth-club && node --experimental-strip-types --test tests/google-auth.test.ts)

# After building the simulator app, verify the Google button and offline flow.
(cd apps/mobile && npx --no-install detox test -c ios.sim.release e2e/tests/ios-smoke.e2e.ts)
```

For simulator setup, see the [iOS build guide](../../../IOS-FORK.md#build). The smoke test checks the Google button and offline use. The backend test covers the shared Google identity, one-use handoff, session lookup, and revocation. When a check fails, keep the command, first actionable error, and full-log path in the report. The login-label task is part of the [agent benchmark](../../../../../scripts/agent-benchmark/README.md).


The iOS system browser starts at `https://healearth.club/ohai/auth/google/start` and reuses the site's registered Google callback at `/auth/google/callback`. Heal Earth Club validates Google identity and issues a short-lived handoff tied to the app's PKCE verifier. The app exchanges the handoff for a bearer session and stores it in Keychain. The web and iOS sessions have independent credentials and share the same Heal Earth Club user ID. The app checks its session with `GET /ohai/auth/native/session` and revokes it with `POST /ohai/auth/sign-out`.

Before testing on a signed phone, apply `0008_ohai_native_auth.sql` to the Heal Earth Club D1 database and deploy the backend routes and Apple association file. Check that `/ohai/auth/native/status` responds with `{"ready":true}` and that `/.well-known/apple-app-site-association` returns JSON directly. Notes use their existing local storage.
