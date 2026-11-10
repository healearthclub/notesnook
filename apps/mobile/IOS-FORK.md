# ohai iOS fork

The app identity is **ohai**, `org.healearth.ohai`, with widget `org.healearth.ohai.notewidget`, share extension `org.healearth.ohai.share`, and app group `group.org.healearth.ohai`. This is a new app installation; it does not migrate another app's notes or keychain.

The internal React Native module and Xcode scheme remain `Notesnook`. Upstream copyright and GPL notices remain in place. This checkout also contains the web/shared changes described in `HEAL-EARTH-NOTICE.md`.

## Build

Use Node 22.20.0, Git LFS, full Xcode with an iOS runtime, Ruby/Bundler, and the committed locks. The verified Mac uses Xcode 26.3 and Ruby 4.0.9. The simulator's libsodium build also needs `brew install autoconf automake libtool`. Install dependencies using the monorepo bootstrap, then prepare iOS:

```bash
git lfs pull
npm ci --ignore-scripts --legacy-peer-deps
npm run bootstrap -- --scope=mobile
npm --prefix packages/editor run postinstall
npm --prefix apps/mobile run postinstall
cd apps/mobile
bundle install
cd ../..
npm run prepare:ios
npm run build:ios
```

The simulator Detox build uses local ad hoc signing to retain App Groups/keychain entitlements and builds only the selected simulator architecture. It needs no distribution identity. Disabling signing entirely prevents MMKV from opening the app-group container. Run `npm run test:ios` with AppleSimulatorUtils installed; after a fresh bootstrap or Xcode change, also run `cd apps/mobile && npx detox build-framework-cache`. The default build/test device is an iPhone 17 Pro Max. This is a Release simulator application, not an App Store IPA. The dedicated smoke test is `cd apps/mobile && npx detox test -c ios.sim.release e2e/tests/ios-smoke.e2e.ts`; it creates a note and checks its contents after restarting.

Native framework caches are optional: the Podfile falls back to source when the asset hash differs. The observed build uses prebuilt React Native core/dependencies and source builds for the other native modules. Keep the generated Podfile.lock with those sources.

## Signing and deployment

The selected Apple team is `BA229RB5M8`. Distribution credentials are not installed. The active/production/staging xcconfigs contain the fork's IDs, version 1.0.0/build 1, and blank profile settings and the selected team ID. The widget Release configuration includes its App Groups entitlement. Upstream Associated Domains entitlements have been removed.

An automatic device archive was attempted with this team. Xcode identifies it as a personal development team and refuses to create a profile because In-App Purchase is unsupported. No signed device archive, IPA, or TestFlight upload was produced. TestFlight requires [Apple Developer Program membership](https://developer.apple.com/help/account/membership/programs-overview). Enroll this team or select an enrolled team before continuing distribution setup.

Register all three bundle IDs and their shared app group with your Apple Developer team. Install an Apple Distribution certificate/private key and one App Store Connect profile per target. Create the main app's record in App Store Connect. Set `APPLE_TEAM_ID`, `MAIN_PROFILE`, `WIDGET_PROFILE`, and `SHARE_PROFILE` in your terminal, then run from the repository root:

```bash
bash apps/mobile/scripts/ios-release.sh archive
bash apps/mobile/scripts/ios-release.sh export
```

The release helper passes the three profile settings separately, preserving distinct target bundle IDs. Output defaults to `apps/mobile/ios/build/releases`; override `RELEASE_DIR` to retain multiple releases. Update the active xcconfig's version/build number for subsequent uploads.

Upload the IPA through Transporter or Xcode Organizer, wait for processing, complete the encryption questions accurately, assign it to a TestFlight group, and verify installation on a real device. Public App Store distribution additionally requires app metadata and review. Archive/export/upload have not been completed merely by configuring this fork.

## Release work still required

- Finish the in-app, support, and store branding. The native app icon and launch screen reuse the existing Heal Earth artwork from the workspace's Ohi iOS app; some in-app upstream visual branding remains.
- Decide on and configure the backend and integrations. The fork currently retains upstream account/sync/purchase behavior; the embedded web client's local-only integration is not applied to mobile.
- Test on a physical device, including notes, encryption/app lock, backups, attachments, widget, and share extension. Review custom URL schemes for side-by-side installation with upstream.
- Publish the corresponding modified source and build instructions with a distributed release, retaining the upstream license and notices.

## Dependency patch repairs

The stale ProseMirror 1.42.2 patch was rebased onto the installed 1.42.9, retaining the Android Enter workaround and upstream's newer duplicate-dispatch/composition guard. Regression tests cover fallback delivery, avoiding duplicate handling, and cancellation on destroy.

The old vector-icons patch only saved/subsetted glyph maps. It was removed because `scripts/optimize-fonts.mjs` already saves the original glyph map and generates the subset and font; rerunning postinstall otherwise failed after optimization. Both editor and mobile postinstall now fail explicitly when a patch fails.

The sodium dependency's bundled library lacks ARM64 simulator support. `scripts/build-sodium-ios.sh` builds that slice from official libsodium 1.0.17 FINAL commit `c943d18f387e442cf800e32c50c9bd60ae606e68`, verifies the source archive SHA-256, and creates an XCFramework alongside the unchanged original device and Intel simulator slices. It caches the generated framework under `node_modules`; `npm run prepare:ios` builds it before CocoaPods integration. The library's ISC notice is retained in `THIRD_PARTY_NOTICES/libsodium.txt`. This preserves the existing device crypto version; reviewing/upgrading the legacy library is separate release maintenance.

## Verification

- Release ARM64 simulator build: passed; all three native targets use version 1.0.0/build 1 and the fork's IDs.
- Editor suite: 139 tests passed, including three Android Enter regression cases for the rebased patch.
- iOS smoke test: passed on iPhone 17 Pro Max / iOS 26.3. It completes offline onboarding, creates a note with a title and body, checks the saved preview, terminates/relaunches the app, and reopens the stored content. It does not create a hosted account.
- Changed runtime files and the new editor test: ESLint reported no errors; existing warnings remain.
- Script syntax, native property lists, shared app-group settings, bundle resources, and local app code signatures were checked.
- Physical-device, widget/share interaction, backup restore, hosted sync, purchases, and TestFlight installation remain unverified.

Empty new-note title events are ignored until the draft has content, and failed saves now clear their timeout in `finally`, preventing a false delayed warning after a subsequent successful save.
