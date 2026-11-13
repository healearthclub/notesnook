# iOS Login

[GoogleScreen](google-screen.tsx) owns login and sign-up UI, labels, and the offline action. The existing [Auth route](../../components/auth/index.tsx) selects this screen on iOS.

| Change | File |
| --- | --- |
| Label, button, or error copy | [`google-screen.tsx`](google-screen.tsx) |
| Native handoff exchange and Keychain session | [`google-session.ts`](google-session.ts) |
| iOS system authentication browser | [`AppDelegate.mm`](../../../ios/Notesnook/AppDelegate.mm) |
| Google callback and Worker session | [Cloud Backup Worker](../../../../../servers/ohai-backup/README.md#contributor-map) |

Run the smallest check for the layer you changed. These commands start at the repository root after dependencies are installed.

```sh
# Login screen or session code
./node_modules/.bin/eslint apps/mobile/app/features/login/google-screen.tsx apps/mobile/app/features/login/google-session.ts

# Worker OAuth callback or handoff. Uses mock Google credentials.
(cd servers/ohai-backup && node --test test/google.test.mjs)

# After building the simulator app, verify the Google button and offline flow.
(cd apps/mobile && npx --no-install detox test -c ios.sim.release e2e/tests/ios-smoke.e2e.ts)
```

For simulator setup, see the [iOS build guide](../../../IOS-FORK.md#build). The smoke test checks the Google button and offline use. The Worker test covers the mock callback and exchange. When a check fails, keep the command, first actionable error, and full-log path in the report. The login-label task is part of the [agent benchmark](../../../../../scripts/agent-benchmark/README.md).
