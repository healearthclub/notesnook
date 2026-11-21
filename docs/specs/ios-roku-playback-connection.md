# 0hi iPhone → Heal Earth Club Roku playback connection

**Date:** November 18, 2026  
**Status:** Draft engineering specification; no implementation or release authorization implied  
**Clients:** 0hi iOS, Heal Earth Club backend, existing Heal Earth Club Roku app  
**Interpretation:** “Bluetooth app” means the existing 0hi iPhone app and its Play on device feature. Bluetooth remains the iPhone audio-output path. This specification connects the two apps through authenticated HTTPS, with the Roku playing its own authorized media.

## 1. Product outcome

As a signed-in user listening or watching in 0hi, I can open **Play on device**, choose my account-linked Roku, and continue the same eligible item on the TV. My iPhone becomes a controller. Playback continues when I lock or background my phone while the Roku app remains open.

The same sheet also offers the existing iPhone/Bluetooth/AirPlay routing controls. Bluetooth sends iPhone audio to the selected system output; Roku transfer starts a separate receiver-owned player. Every available inline, expanded and mini-player surface reflects one acknowledged playback destination.

V1 requires the user to open the Roku app manually. There is no promised wake, app launch, screen mirroring, phone-file streaming, Bluetooth link to the Roku app, or playback after exiting the Roku app.

## 2. Verified code baseline

Reviewed working-tree source, including uncommitted changes; source presence is not hardware acceptance.

| Repository / source | Existing capability to reuse | Required addition |
| --- | --- | --- |
| `Roku-Client/manifest`, `package.json` | Version 0.3.8; SceneGraph 1.3; incoming launch inputs enabled | Advertise application protocol/capability version through the new backend connection |
| `Roku-Client/source/main.brs` | Runs AuthScene and forwards launch/roInput events and memory notifications | Retain OS deep-link behavior; do not use it as the phone transport |
| `Roku-Client/components/AuthScene.brs` | Restored TV session, sign-in/out, opens MediaLibrary, session-expiry handling | Start/stop receiver connection with the authenticated foreground app lifecycle |
| `Roku-Client/components/MediaTask.brs` and `.xml` | TLS-verified, bearer-authenticated GET task; bounded timeout; session clearing on 401 | Separate bidirectional connection Task; current task cannot POST commands/status or run alongside a blocked library request |
| `Roku-Client/components/MediaLibrary.brs` | `playMedia`, `stopPlayback`, `toggleAudio`, `startQueue`, `advanceQueue`, source resolution, separate HTTP agents | Prepare-paused mode, remote command adapter, acknowledgements, playback snapshots, video-position observation and handoff fencing |
| `Roku-Client/components/MediaLibrary.xml` | Native Audio/Video nodes, audio position updates, TV mini player and Now Playing | Connection status and phone-control consent UI; wire both players into the adapter |
| `notesnook/apps/mobile/app/features/playback/play-on-device.tsx` | Shared half-height expandable sheet and native output picker; Roku currently informational Coming soon | Real receiver rows, connection states and transfer actions; retain the shared sheet |
| `notesnook/apps/mobile/app/features/playback/audio-output.ts` | Shared actual AVAudioSession output state | Keep local output separate from remote playback destination |
| `notesnook/apps/mobile/app/features/login/google-session.ts` | Keychain-backed native session and fixed-origin authenticated music/books requests | Reuse credential handling for a bounded native playback API wrapper |
| `heal-earth-club/lib/roku-auth.ts` | TV bearer sessions, shared canonical account identity, revocation and web-only management | Reuse TV authentication; add independent native-controller authorization |
| `heal-earth-club/lib/roku-media.ts` | Permission-filtered library/playlists, MP3/MP4/HLS resolution, private Range streams and artwork | Reuse resolver/policy for every remote item and queue advance |

Roku HEAD reviewed: `fac595c1cfbb4c37a428e26a9cfa10103cd6683d`. iOS HEAD: `920320601b011ba889e2b55524471505206884c4`. Backend HEAD: `8e4112e8b1f981f6f0d607e72be9f1a700a5b0d1`. Working-tree fingerprints appear in the [companion source snapshot](ios-roku-playback-connection-sources.json).

The current web `/auth/roku/manage` list identifies unexpired TV sessions. It contains no foreground heartbeat and must not be treated as online discovery. The current iOS device-sheet media descriptor has only title, artist and kind; that is insufficient for a transfer. A valid canonical content ID and playback-session identity must be added.

## 3. Transport decision and platform limits

Use an application-level HTTPS command/state channel through the existing Heal Earth Club service. Both apps connect outward. No LAN scanner, IP-address entry, CoreBluetooth scan, multicast entitlement or new local-network permission is needed for this design. Devices may be on different networks, so label the list **Your Roku devices**, not Nearby devices.

Do not implement production mobile ECP calls. Roku currently states that third-party platforms, including mobile applications, may not send ECP commands. Incoming Roku OS deep links remain useful and supported separately. Publication alone does not grant a mobile-control exception. [Roku ECP documentation](https://developer.roku.com/dev/docs/external-control-api)

Start with authenticated short polling compatible with the receiver's existing BrightScript networking. Roku's current documentation adds SSE in OS 16.0; the repository documents a lower firmware floor, so SSE is an optional later optimization rather than a V1 dependency. [roUrlTransfer](https://developer.roku.com/dev/docs/rourltransfer)

**Discovery research:** Checked the public-apis catalogue for Roku; no named Roku entry was found. A generic media API would not provide this app's private account authorization or receiver command delivery. Reuse first-party authentication, media policy and HTTPS rather than introducing a paid discovery/casting service. [Catalogue reviewed](https://raw.githubusercontent.com/public-apis/public-apis/master/README.md)

The custom service's behavior and Roku certification suitability still require review and physical-device validation. This spec is not a certification determination.

## 4. User flow and UI states

1. Open the Roku app and sign in using its existing development flow. The phone and TV must resolve to the same canonical account, not merely display matching email text.
2. In Roku Account, enable **Allow phone control** for this foreground app session. First controller attachment displays the phone's user-visible name and Allow/Decline on TV. A controller name is a label, not proof of identity.
3. On iPhone, play an eligible item and tap Play on device.
4. The existing half-sheet shows item artwork/title, current playback destination, iPhone output controls, and Your Roku devices. It expands and scrolls using the existing component.
5. Select an online, compatible TV. Show **Waiting for TV approval**, then **Connecting to Living Room Roku**. Keep local playback unchanged during authorization and preparation.
6. Complete the acknowledged handoff below. Only then show a green selected checkmark and **Playing on Living Room Roku** across player surfaces.
7. Play/pause, seek, previous/next, queue and repeat controls now target that remote session. The TV remote continues to work and its changes update the phone.
8. **Play on this iPhone** performs an acknowledged return handoff. **Stop on TV** stops the receiver. Closing the sheet or detaching the controller does not stop TV playback.

| Receiver/session state | UI and action |
| --- | --- |
| No linked devices | Open the Roku app and sign in; retain local routing |
| Linked but offline | Muted device row, Open the app on your TV; no false connection |
| Control disabled / declined | Explain TV approval requirement; no playback changes |
| Old receiver protocol | Update the Roku app; do not attempt unsupported commands |
| Media incompatible / inaccessible | Explain item-specific restriction; local playback remains available |
| Preparing | Progress and Cancel; no destination checkmark |
| Active | Selected TV and live receiver state |
| State stale / outcome uncertain | Connection interrupted; refresh/reconcile; do not auto-resume locally |
| Different account / revoked session | Remove control access and clear private state |

TV audio volume stays under the Roku remote/TV's own controls in V1. Do not relabel the iPhone volume slider as TV volume. iOS Bluetooth route changes while TV playback is active affect only the stored local route and never reclaim playback implicitly.

## 5. Shared session model

Introduce a playback coordinator above the existing local player and device sheet. Reuse existing players; do not place a second independent player inside each surface.

```ts
type PlaybackDestination =
  | { kind: 'local' }
  | { kind: 'roku'; receiverId: string; receiverEpoch: string; sessionId: string };

type RemoteCommand = {
  commandId: string;             // idempotency key
  sessionId: string;
  receiverEpoch: string;         // changes on every receiver-app start
  expectedRevision: number;      // compare-and-set against authoritative session
  action: 'prepare' | 'commit' | 'setPaused' | 'seek' |
          'setQueue' | 'advance' | 'setRepeat' | 'stop' | 'cancel';
  payload: Record<string, unknown>;
  expiresAt: string;             // server-issued, bounded
};
```

A receiver snapshot includes protocol version, receiver/session/epoch IDs, state revision, last applied command ID, content ID, item generation, queue revision/index, repeat mode, playback phase, seekability, actual position/duration, server receipt time and an allowlisted error code. The server supplies account ownership; clients cannot nominate it.

Use explicit desired-state commands such as `setPaused: true`, not toggle. Reject stale revisions with 409 and return the latest snapshot. A repeated command ID with identical content returns the recorded result; different content under that ID returns 409. Validate all IDs, finite position bounds and payload sizes.

A backend-allocated controller fence grants one mutating controller per receiver session. Explicit takeover must be confirmed on TV and increments the fence. Commands from the old controller stop applying. The controller lease may expire after 60 seconds without renewal; expiry releases control but never stops independent TV playback. Returning foreground requires reconciliation before reclaiming it.

Receiver remote-control actions also increment the authoritative revision. Route them through the same serialized adapter as phone commands. Advance uses expected queue/index/item generation so a retry or simultaneous end-of-track event cannot skip twice.

## 6. Handoff protocol

### iPhone → TV

1. Create an authorized transfer intent with receiver ID, stable content ID, media kind, current position, desired pause state and optional queue snapshot. Never include an iPhone stream URL or credential.
2. TV resolves the item using its own authenticated `/api/roku/play/:id` path, validates support, prepares it paused and reports ready with actual position/capabilities. Preparation must not replace an already playing TV item without the user's confirmed replacement decision.
3. Phone verifies that its account, item generation and transfer intent still match. Capture final local position and pause the local player, preserving queue and route.
4. Send commit with that position, fence and desired state. TV seeks/clamps to supported bounds, begins or stays paused as requested, and acknowledges actual state.
5. Mark Roku active only from that matching acknowledgement. Ignore late ready/playing responses for canceled or superseded generations.

Ready means buffered/seekable enough for this content, not merely that the HTTP command was received. Prove silent preparation on physical Roku Audio/Video nodes before enabling that capability; if a source/player cannot prepare without audible playback or replacing the active item, reject that transfer capability instead of inventing a ready acknowledgement. A paused local item stays paused after transfer. Live/nonseekable media does not promise position preservation and is excluded from V1 handoff unless separately accepted.

Before commit, a failure leaves local playback unchanged. After commit, a lost response creates an **unknown outcome**: keep local playback paused, retry/query the same intent and reconcile. Do not treat a timeout as proof that the TV never started. Preparation intents expire after 30 seconds and cannot start playing later without a current valid commit.

This refines the older `docs/ios-play-on-device.md` suggestion to pause only after a playing acknowledgement. V1 prefers a short handoff gap over knowingly starting two outputs. It cannot guarantee gapless or exactly simultaneous cross-device switching on an unreliable network.

### TV → iPhone

Prepare the local source without playing. Ask the TV to pause and acknowledge final position for the matching generation, then seek and resume locally according to the desired state. Clear the remote destination only when reconciliation succeeds. If the TV cannot be reached, offer an explicit **Play here anyway — the TV may still be playing** choice; never make that decision automatically.

Moving between two TVs follows the same pause-confirm/resume discipline. No multiroom synchronized playback in V1.

## 7. Queue, media and lifecycle rules

- Eligible V1: account music with a canonical Pin ID resolved as MP3; compatible account MP4/HLS video. The receiver's existing resolver and per-item access checks remain authoritative.
- Exclude arbitrary browser pages, YouTube embeds, DRM streams, unsynced local files, Books/PDFs and Scripture audio until an explicit receiver content mapping exists. Availability of a URL on the phone is not transfer eligibility.
- Board playlists reference an authorized board and an immutable ordered item-ID snapshot/revision. Ad hoc queues use bounded item IDs, never bearer URLs. Limit inline queue payloads to 100 items; page larger snapshots with a server cursor. Preserve duplicate track occurrences with queue-entry IDs.
- Reuse the Roku queue/pagination implementation. Add repeat `off`, `all`, `one` and shared queue metadata; do not assume the current `advanceQueue` already implements looping. Define manual Next under repeat-one to move to the next item; repeat-one applies to natural completion.
- Revalidate permissions/source availability at transfer, every queue advance and every protected stream request. Report a failed item without entering an infinite retry/skip loop. At most one bounded transient retry, then show actionable failure.
- On iPhone background/lock/termination, stop controller polling; TV audio, queue and polling remain receiver-owned. Reopening the phone queries current TV state rather than replaying the last local item.
- While remote playback is active, clear/deactivate the phone's local Now Playing ownership to avoid stale Bluetooth/lock-screen controls. V1 remote control lives in-app; a dedicated remote iOS lock-screen experience requires separate validated platform behavior.
- On Roku Back, retain current music browsing behavior. Exiting the Roku app, sign-out, session expiry or memory recovery ends that receiver epoch and publishes a terminal state when possible. Abrupt exit becomes offline through lease expiry. Do not promise TV playback after the app closes.

## 8. Proposed backend contract

All endpoints below are **new**. Names are proposed, not claims of existing routes.

| Endpoint | Auth / purpose |
| --- | --- |
| `GET /auth/native/playback/receivers` | Existing iOS native bearer; own linked receivers, capability and fresh availability only |
| `POST /auth/native/playback/sessions` | Native bearer; request attachment/transfer, idempotency key, receiver consent and content validation |
| `GET /auth/native/playback/sessions/:id` | Native bearer; own session snapshot, no-store |
| `POST /auth/native/playback/sessions/:id/commands` | Native bearer; fenced desired-state command, CAS revision |
| `POST /auth/native/playback/sessions/:id/detach` | Release controller association without stopping TV |
| `POST /api/roku/connect/register` | Existing Roku bearer; server-assigned receiver epoch, supported capabilities, foreground/consent state |
| `POST /api/roku/connect/sync` | Roku bearer; bounded state/ack report and pending command response for its own receiver epoch |
| `POST /api/roku/connect/close` | Roku bearer; best-effort explicit epoch closure |

Do not call cookie-only `/auth/roku/manage` with a native bearer or weaken its Origin/recent-auth checks. Reuse the native authentication verifier behind current iOS session/music/books endpoints for controller requests. Roku session bearer values stay on the TV. Both authenticate independently to the same account.

Persist receiver epochs/leases, playback sessions, controller fences, queue snapshots and command/result ledger through a new backend module and migration. Extend the existing D1 patterns with atomic conditional writes and unique command keys; a read-then-write sequence is insufficient. Serialize accepted mutations and receiver updates transactionally. Store no raw credentials in these tables.

Polling proposal: receiver sync every 2 seconds while a controller is attached, every 10 seconds while idle; a 30-second receiver lease defines online availability. Phone polls every 2 seconds only while foreground and observing/controlling a session. Piggyback heartbeat/position on sync; back off with jitter on failures and stop on 401. New reads must observe acknowledged revisions rather than stale replicas. Position interpolation is display-only and bounded; seeking always uses actual receiver state.

Bound requests to 32 KiB, at most 10 pending commands per sync, 100 inline queue entries and 20 linked TVs per account consistent with existing TV-session limits. Apply per-account/device rate limits above normal polling rates and return Retry-After on 429. Command lifetime defaults to 15 seconds; validate against server time. Never execute an expired command after reconnect.

Retain deduplication/results for 24 hours, then purge terminal session/command data; delete abandoned queue snapshots within the same window. Minimal operational logs use opaque correlation IDs, timings and error codes, without tokens, playback URLs, titles or full request bodies. Capacity testing must measure per-active-TV polling cost before broad rollout; “existing backend” does not imply free unlimited usage.

## 9. Security and privacy acceptance

- Authorize account, receiver, epoch, session and controller fence on every request. Reject cross-account IDs without disclosing receiver/media metadata.
- No Google token, web cookie, native token, TV sign-in key or private phone URL travels between devices. Protected TV media headers remain restricted to the existing trusted stream origin; external providers receive no app bearer.
- Validate capability/version server-side; a friendly device name is not authentication. Duplicate names display distinct non-secret labels.
- Revoking a TV or changing either account invalidates related control sessions and pending commands. On a revoked TV's next sync/stream request, stop playback and clear private state. Buffered media cannot be remotely recalled instantly.
- No credential logging, arbitrary URL execution, unauthenticated LAN control, silent pairing or automatic TV replacement.

## 10. Implementation work packages

1. **Backend:** new `lib/playback-connect.ts`, migration, native/Roku route adapters, transactional ledger, ownership/capability checks and contract tests. Preserve current auth/media endpoints.
2. **Roku:** new `PlaybackConnectionTask.brs/.xml`; integrate AuthScene lifecycle, MediaLibrary command adapter and TV confirmation/status UI. Generalize preparation separately from current `playMedia`, which immediately stops the prior item and starts the new one. Add video position reporting and idempotent queue advancement. Preserve deep links, remote focus, authenticated HTTP-agent isolation and memory recovery.
3. **iOS:** new playback connection API/store/coordinator within `features/playback`; extend the media descriptor with stable IDs, generation, queue and position. Replace Coming soon only behind the receiver feature flag. Wire every existing surface to acknowledged remote state; keep `audio-output.ts` authoritative for local routes only.
4. **Verification:** backend integration tests, iOS model/component tests, BrightScript compilation and physical TV/phone acceptance. Update shared feature/story delivery records per client only when the relevant work is actually implemented/tested.

## 11. Acceptance criteria

- **AC-01 Discovery:** Two signed-in same-account TVs appear only when fresh and compatible; unrelated/expired/disabled receivers cannot be selected. Unexpired login alone does not prove online.
- **AC-02 Transfer:** A playing or paused eligible item transfers with the correct actual state/position; only the matching acknowledged TV gets a selected checkmark. Target seek accuracy is within 2 seconds for seekable MP3/MP4 fixtures; HLS respects segment boundaries and reports clamping.
- **AC-03 Independence:** Lock/background/terminate the phone after transfer; TV playback and queue continue while its app stays open. Reopen restores remote state without starting local playback.
- **AC-04 Unified controls:** Mini/inline/expanded surfaces, phone controls and TV remote converge on one authoritative revision; previous/next and completion races never double-advance.
- **AC-05 Recovery:** Drop the network before ready, after local pause, after TV commit and after acknowledgement. No timed-out/expired command starts unexpectedly; uncertain outcomes never auto-resume another output.
- **AC-06 Return:** Return to iPhone uses receiver-confirmed pause/position. Unreachable TV requires explicit duplicate-playback acknowledgement.
- **AC-07 Boundaries:** Browser/DRM/local-only items explain incompatibility; MP3 and compatible MP4/HLS fixtures resolve through TV permissions. Revoked and cross-account media fail without leaking URLs/tokens.
- **AC-08 Bluetooth:** Existing Bluetooth routing still works for local audio; video stays on phone. A route change does not silently end a remote session.
- **AC-09 Consent/concurrency:** Declining TV consent, replacing TV media, account changes and a second phone's takeover all leave predictable state; stale fences cannot control the session.
- **AC-10 Accessibility/layout:** Sheet starts halfway, expands, covers app navigation, scrolls at large text sizes and supports VoiceOver/dismissal. TV confirmation remains usable by the physical remote.
- **AC-11 Lifecycle:** TV Back, exit, low-memory recovery, reboot and session expiry clear availability correctly; no stale receiver epoch accepts queued commands.
- **AC-12 Delivery:** Sideloaded hardware test precedes release. A successful package build or published channel does not count as cross-device acceptance.

Proposed performance targets: online-list refresh within 3 seconds with healthy active polling; play/pause acknowledgement p95 within 3 seconds; preparation timeout after 15 seconds with an explicit cancel/retry path. These are test targets, not measured guarantees.

## 12. Rollout and publication gates

Phase 1: internal sideloaded receiver + developer iOS build, feature-flagged, manually opened TV app. Phase 2: controlled hardware pilot after auth, race, failure and cost checks. Phase 3: published receiver only after Roku authentication/certification review and store requirements are satisfied. Existing development TV-key login must not be labeled production-compliant; Roku's current on-device authentication rules need a separate remediation plan. [Roku on-device authentication](https://developer.roku.com/dev/docs/on-device-authentication)

Until implementation passes these gates, production retains the existing Coming soon Roku row. A remote feature flag disables new connections without revoking Bluetooth access; established sessions expose a deliberate Stop/return path and are drained rather than silently duplicated.

Open release decisions: actual supported physical Roku models/firmware; accepted production on-device account flow; server polling capacity; seek behavior across real media samples; whether a later system-picker extension or wake/launch integration has an approved platform path. None prevents writing the first-party foreground-connection implementation, but unresolved release-critical items prevent shipping claims.

## 13. Related documents and official references

- Existing scope: [iOS Play on device](../ios-play-on-device.md). This draft proposes a future functional receiver connection, replacing UI-only behavior only when implemented and enabled.
- Roku code and deployment notes: sibling `Roku-Client/README.md`, `source/main.brs`, `components/MediaLibrary.brs`, `components/MediaTask.brs`, `components/AuthScene.brs`.
- [Roku ECP restrictions and OS deep links](https://developer.roku.com/dev/docs/external-control-api)
- [Roku incoming roInput behavior](https://developer.roku.com/dev/docs/roinput)
- [Roku HTTPS networking / versioned SSE support](https://developer.roku.com/dev/docs/rourltransfer)
- [Apple AVRoutePickerView](https://developer.apple.com/documentation/avkit/avroutepickerview)
- [Roku on-device authentication](https://developer.roku.com/dev/docs/on-device-authentication)

Official platform references checked November 18, 2026. Runtime performance, device behavior and certification have not been established by this specification.
