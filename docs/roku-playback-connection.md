# iPhone → Roku playback connection: local implementation

**Updated:** November 18, 2026. **State:** private single-account backend pilot deployed; matching Roku 0.3.9 and iPhone test builds installed. Receiver registration, transfer and phone-lock acceptance remain pending.

Pilot evidence and rollback: `heal-earth-club/docs/releases/2026-11-18-roku-private-pilot.md` in the sibling workspace. Standard checked-in configuration remains disabled; the isolated live release enables only the existing TV-linked account. The initial implementation details below describe the default gated source/packages.

## What changed

0hi's existing Play on device sheet can list the account's authenticated Roku receivers, obtain TV approval, prepare an eligible item, pause its local source, commit playback, and control the acknowledged receiver session. Closing the sheet keeps TV playback running. Disconnect controller releases phone control without stopping the TV. Stop on TV and Play on this iPhone are explicit actions; an unreachable TV requires a separate confirmation before local playback can begin.

The Roku app reuses MediaLibrary's Audio/Video nodes, media resolver, artwork isolation, library navigation and remote. A separate HTTPS Task handles connection requests so browsing/pagination cannot block control. Account → Allow phone control is per foreground app session. Incoming OS deep links remain separate. No mobile ECP, LAN scanning or Bluetooth discovery was added.

Backend session ownership, TV epochs, native-controller identity, TV approval, controller fences, revision CAS and idempotent command/result records are stored in D1. Native and TV credentials stay on their own devices and never enter a receiver command body. TV sessions retain their existing authenticated media/Range endpoints and server permission checks.

## Runtime flags and packages

Defaults remain disabled:

- Backend `PLAYBACK_CONNECT_ENABLED="false"` and `PLAYBACK_CONNECT_ACCOUNTS=""`.
- Roku manifest `connect_preview=0`, `connect_silent_prepare=0`.
- iOS discovers availability from the authenticated backend. No hardcoded sample TV or fake selected route is introduced.

For a reviewed private pilot, enable the backend flag and explicitly allow the canonical account IDs in `PLAYBACK_CONNECT_ACCOUNTS` (comma separated, not email addresses). An empty list denies new connections. `*` is an explicit broader-rollout choice, not the default. Disabling the flag blocks new attachments/uploads while established sessions retain a stop/return path and can finish their existing queue.

From `Roku-Client`:

```sh
npm run check
npm run build:connect-preview
npm run build:connect-preview -- --test-silent-prepare
```

Artifacts:

- `dist/heal-earth-club-roku.zip`: standard build, connection disabled.
- `dist/heal-earth-club-roku-connect-preview.zip`: discovery preview; silent-transfer capability disabled.
- `dist/heal-earth-club-roku-connect-hardware-test.zip`: private on-device test package, silent-preparation capability enabled for testing. This does not assert it has been validated.

The build helper creates independent ZIPs without editing the checked-in manifest. Do not submit the hardware-test ZIP as a production package. Version is 0.3.9; the existing signing identity and TV account/session model remain intact.

## Backend rollout prerequisites

Apply `drizzle/0011_playback_connect.sql` using the repository's normal migration/release workflow on the intended environment. It creates only the new receiver/session/command/queue/rate-limit tables and indexes. It does not modify existing identity or media rows. Deploy the reviewed backend, then opt in the pilot account and install matching development clients. No remote migration, deployment or device installation was performed by this implementation task.

There are existing unrelated working-tree changes in these repositories. Review the intended release content instead of deploying the whole working tree blindly. Use normal isolated staging and release validation. The Roku client still uses its established Workers-domain API alias; preserve its configured `ROKU_API_ORIGINS` authorization.

## Added API contract

Actual native URLs start with `https://healearth.club/ohai/auth/native/playback/`; the existing native session wrapper appends this prefix and keeps the bearer in Keychain/session code. They accept no browser cookies or Origin-bearing calls. Roku uses `/api/roku/connect/` on its established authorized service origin with its independent TV bearer.

In addition to the supplied spec's receiver/session/command/detach and register/sync/close endpoints, the implementation includes:

- `POST /ohai/auth/native/playback/queues`: immutable 100-entry page uploads with queue ID, total, offset and unique entry IDs.
- `GET /ohai/auth/native/playback/sessions/:id/queue/:offset`: scoped queue-page restoration.
- `GET /api/roku/connect/queue?sessionId=:id&offset=:offset`: authenticated TV paging as its autonomous queue advances.
- `GET /ohai/auth/native/playback/sessions/:id/commands/:commandId`: authoritative applied/failed/expired/superseded outcome. This prevents a lost or superseded pause acknowledgement from incorrectly resuming local audio.

Maximum queue size is 10,000 entries. Each command/page request remains bounded to 32 KiB and each page to 100 entries. Repeated songs retain different queue-entry IDs. Complete, immutable page sets are checked before attachment. Each actual item resolves again through the receiver's permission-checked media API. Duplicate uploads or commands with different content under the same ID fail with conflict.

D1 receiver updates and dependent ledger/session writes run in a single conditional batch transaction guarded by a unique mutation marker. Failed CAS cannot leave an orphan accepted command/session. Authoritative state reads use a transactional session/receiver pair; terminal result reads occur before the paired state read. Another TV action or controller can supersede an acknowledged pause before a return handoff; that is reported rather than starting a second output.

## Media, routing and persistence

Supported native transfers are account MP3 music and compatible account MP4/HLS video. Native videos are mapped only from a trusted `https://healearth.club/pin/:id` page with a live browser video adapter. Arbitrary browser URLs, YouTube, DRM, unsynced local files, Books and Scripture audio have no receiver mapping. Native formats that work on iPhone but are not supported by Roku fail before local pause.

Local Bluetooth/AirPlay routing remains authoritative through AVAudioSession. A remote session does not rewrite that state. Device labels/checkmarks apply to the matching media surface, so an unrelated browser video does not falsely report Roku output. Returning to iPhone preserves its current system route.

The local native music bridge can prepare paused, report position/readiness, seek and relinquish its Now Playing session after TV acknowledgement. A trusted video adapter correlates requests to a particular page/nonce, pauses or resumes that page, and clears its Media Session metadata on transfer when supported. Actual iOS lock-screen/WebKit behavior remains a physical-device test, not a promise derived from source.

The account-scoped local cache stores connection identity, last snapshot and whether local output had been suspended, without raw credentials or private stream URLs. Cold restart/offline recovery never silently starts local playback. TV playback continues independently when the phone locks/backgrounds/exits; polling stops in the background. Account changes clear client state, ignore late responses and attempt a scoped prior-controller detach. Already-issued commands remain bounded by server expiry; revoking the native session also prevents queued command delivery on the receiver's next sync. TV sign-out/revocation independently stops its own authorized playback path.

Opening Scripture pauses only local native music, so it does not accidentally pause a song already playing on TV. Its integration template/journal were updated with that regression fix.

## Validation completed

- Backend focused protocol tests: 12 passed using isolated Workers/real D1 bindings; covers CAS races, approval/commit, queue paging/duplicates, account and epoch isolation, revocation/detach, expiry and TV-remote supersession.
- Full backend regression suite: 180 passed. Shared story evidence and remaining hardware gates are recorded in `heal-earth-club/docs/vault/operations/roku-connect-verification.md`.
- iOS model, component, account/session and existing music regression suites: 44 passed, including ambiguous commit, confirmed return, cancel-before-pause, video-origin correlation, explicit duplicate-playback acknowledgement and unchanged locked-phone playlist tests.
- Backend/mobile TypeScript checks passed.
- iOS Release simulator build succeeded with the new native bridge and bundled interface.
- Roku BrightScript checks and all three package builds succeeded; manifests distinguish disabled, discovery-only and hardware-test modes.
- Worker configuration types regenerated using the pinned Wrangler version; compatibility date and existing bindings preserved.

## Remaining acceptance and release gates

Run the supplied specification on an actual iPhone and Roku before enabling normal transfers: silent prebuffer/paused commit on both Audio and Video; seek accuracy; real MP3/MP4/HLS decoding; queue continuation past entry 100; TV consent and remote focus; cancel during preparation; interrupted commit/return; concurrent phone/TV commands; account revocation; phone lock/relaunch; Roku exit/reboot/low memory; Bluetooth route changes; VoiceOver, large text and small screens. Measure active-device polling cost and latency before expanding the allowlist.

No hardware or production acceptance is inferred from a compiler, mocked native components, or D1 protocol fixtures. Existing development TV-key authentication is not claimed to satisfy Roku Store's on-device authentication rules. Published release requires that separate review/remediation. The approved HTTPS transport does not grant a wake/launch capability or a mobile ECP exception.

## Sources

The user-supplied specification is retained in `notesnook/docs/specs/ios-roku-playback-connection.md`. Its repository baseline was the local checkout of `https://github.com/healearthclub/Roku-Client`; implementation uses that actual receiver code, not a generic casting SDK.

- Roku ECP restrictions: https://developer.roku.com/dev/docs/external-control-api
- Roku HTTPS networking: https://developer.roku.com/dev/docs/rourltransfer
- Roku Audio/Video prebuffer: https://developer.roku.com/dev/docs/audio and https://developer.roku.com/dev/docs/video
- Roku on-device authentication: https://developer.roku.com/dev/docs/on-device-authentication
- D1 batch transactions: https://developers.cloudflare.com/d1/worker-api/d1-database/

No new third-party discovery API, paid casting service or media-hosting service is used.

## November 19: inactive receiver rows

The iPhone picker also filters out offline or phone-control-disabled rows before rendering and before determining duplicate friendly-name labels. This protects the UI from historical service responses. Two distinct online TVs with the same friendly name remain individually selectable; current-session controls remain available independently of discovery rows. With no discoverable TV, the sheet explains how to open the receiver and enable phone control. Regression coverage includes stale/disabled-only results, same-name live TVs, selection and dismissal without stopping remote audio.

## November 19: ended-TV-session local recovery

A receiver restart invalidates the old session epoch. The iPhone now treats a first-party 410 response as a definitive end, clears persisted remote routing and invalidates pending controls for that epoch. The selected track remains paused; audio never starts automatically. Transient network errors retain the existing uncertainty handling. Local audio released during a Roku handoff is tracked explicitly, so the user's next local play/retry starts a fresh native player/request rather than trying to resume a released AVPlayer. Tests cover terminal remote-session cleanup without auto-resume and fresh local startup for the same track.
