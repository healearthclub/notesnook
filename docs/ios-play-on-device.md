# Play on device — iPhone output routing and Roku UI handoff

November 17, 2026 historical scope. Scope updated by the user: ship iOS/Bluetooth routing; Roku is a UI specification until the receiver can be published. No TV discovery, transfer requests, simulated connections, backend changes, or credentials sent to TVs in this change.

## AirPlay connection update — November 18, 2026

The user's Spotify/AirPlay recording establishes the preferred local-output flow. For local music/video, Play on device now exposes the public native AVRoutePickerView directly: one tap opens Apple's real AirPlay/Bluetooth receiver list, including compatible Roku TVs. Video entry points prioritize video-capable routes. The selected output continues to come from AVAudioSession route-change events. Music configures the playback session with longFormAudio route sharing. Audio decoding and authenticated asset loading remain on the phone; the selected AirPlay audio route carries the sound. Opening the picker does not start/pause media or change the route itself.

An AirPlay-capable Roku TV does not require our Roku channel, account broker deployment, or new TV sign-in for this system flow. It must be discoverable to iOS; Apple owns discovery, pairing, device availability and the actual selection UI. We do not synthesize a Spotify-style named-device list or scan the LAN. The screenshot's prior Coming soon placeholder has been removed. A broker-backed receiver, when enabled or already connected, retains the shared sheet and explicit handoff/return controls; it is a separate transport with separate release gates.

Validation for this iteration: 46 mobile Node tests passed, including native-picker rendering, live destination naming, music/video priority, preservation of explicit controls for an active receiver session, and omission of the disabled placeholder. The simulator routing test source now checks native picker presence and media identity across inline/expanded/minimized surfaces; that updated end-to-end test has not been rerun in this iteration. Actual AirPlay TV discovery, connection, audio and reconnect behavior require physical testing. Earlier sheet-specific descriptions/evidence below are historical and are superseded for local AirPlay entry points.

Apple references: https://developer.apple.com/documentation/avkit/avroutepickerview and https://developer.apple.com/documentation/avfoundation/supporting-airplay-in-your-app

## Local receiver implementation — November 18, 2026
The user has now authorized the functional connection spec. See [Roku playback connection](roku-playback-connection.md) for the local, opt-in iOS/backend/Roku implementation and test/release gates. Production retains the Coming soon row until the new service and compatible receiver are explicitly enabled. The November 17 UI-only details below remain the disabled-feature baseline.

## Implemented iPhone experience

Use the same audio-output state and device sheet from the music library controls, music mini player, browser video view (inline and expanded), YouTube mini player, and minimized browser video card. Do not create an expanded music player when none exists.

The control is labeled **Play on device**. Compact players use the cast-audio icon with a complete accessibility label. Current output names remain visible in the library and mini players. All entry points use the same live `AVAudioSession.currentRoute` snapshot. Opening the sheet never starts, restarts, pauses, seeks, or changes the current media.

The sheet reuses the camera library's BottomSheet: half-screen initially, expandable, scrollable at large text sizes, dismissible by the close button, backdrop, accessibility escape, or downward drag. Show the item's current title/artist, **Current output**, the named selected output(s) with green checkmarks, then the real iOS Bluetooth/AirPlay picker. An unset system route is **System output**, not a fictitious connected device. Changes from Control Center and app foregrounding refresh all labels. A stale initial query cannot overwrite a newer route event.

Bluetooth is audio-only: the video stays on iPhone, with its position and playback state unchanged by opening the picker. Selecting an actual route is handled by Apple's AVRoutePickerView, including paired device names, current-selection checkmarks, and returning to iPhone. Do not enumerate or scan Bluetooth hardware, forge a paired-device list, use private picker APIs, or force an AVAudioSession speaker override. Pairing new hardware remains in iOS Settings. Existing playback-session ownership and background audio behavior remain authoritative.

## Roku: current UI only

Below the iOS routing controls show a television icon, **Roku TV**, **Music and video from your library**, and **Coming soon**. It is informational, not a selectable destination. It never gets a selected checkmark, never pauses local media, and never invents a named nearby TV. There is no pairing dialog in this release.

## Roku: proposed published experience

When enabled later, replace the coming-soon row with real named receivers authenticated to the same account. Disambiguate online/account-linked receivers from physically nearby devices; account discovery must not be labeled as proximity discovery. The picker should show a receiver only when its availability is verified. A published channel alone does not imply that the receiver is online or supports wake/launch.

| State | Picker treatment | Local playback |
| --- | --- | --- |
| Available | TV name, 0hi app, supported-media label | Continues |
| Connecting | Chosen TV name and progress; prevent duplicate transfer | Continues until receiver confirms playback |
| Connected | Green checkmark, TV name on every player | Pause only after acknowledgement for the same item/session |
| Failed / timed out | Inline error, retry and keep on iPhone actions | Continues or preserves prior user pause |
| Offline / sign-in required | Explain state; no selected checkmark | Unchanged |
| Unsupported item | Explain that this item can only play locally; Bluetooth remains available | Unchanged |

Receiver acknowledgement must include command/session ID, content ID, actual playback state and position. Ignore late acknowledgements for an item the user has already changed or dismissed. Changing destinations, disconnecting, seeking, play/pause and returning to iPhone must target the acknowledged session, not whichever media happens to be open. Returning to iPhone requires a receiver-confirmed position and a successful stop/pause handoff; network failures must not silently start duplicate playback.

The receiver fetches its own authorized media and owns playback so locking or backgrounding the iPhone does not stop the TV. Native account tokens and private iPhone stream URLs must never be handed to a TV. Reuse Roku-Client's authenticated library resolver, with server-side ownership and content permission checks for every request. Expiring receiver sessions and account changes invalidate discovery and control access.

Initially eligible media: library MP3 music and compatible MP4/HLS video resolved by the receiver. Arbitrary websites, browser cookies, DRM-protected streams and YouTube pages are not generic castable URLs. Keep these local unless a separately supported provider integration is implemented.

Do not implement the TV transport with third-party mobile ECP commands. Roku's current official ECP documentation prohibits commands from third-party mobile platforms. The existing client's incoming deep-link support remains useful for Roku OS entry points; it is not an approved mobile-control transport. Select and validate an authenticated receiver transport before implementing TV transfer; publishing is a release gate, not proof that this transport is available.

## Acceptance checks

- Playing music: open from the library and mini player; both show the same title and system destination.
- Browser video: open inline, expand it and minimize it; every available control opens the shared picker without reloading the webpage.
- Choose a paired Bluetooth speaker: route label/checkmark updates everywhere, sound uses the speaker, video remains on iPhone.
- Change route in Control Center, disconnect hardware, lock/unlock and reopen the app: refresh the route without restarting or implicitly resuming paused media.
- Compact two-card rows, small iPhones, landscape, dark/light appearance, VoiceOver and large text: no clipped controls; sheet content scrolls and can expand.
- Roku coming-soon state: cannot connect, cannot steal a route checkmark, cannot interrupt media.
- Future Roku: verify eligible media, ack/timeout/race handling, account isolation, independent locked-phone playback and authenticated return-to-phone behavior on physical hardware before shipping.

## Evidence and constraints

Reference: supplied Spotify recording. Current APIs checked November 17, 2026:

- [Apple AVRoutePickerView](https://developer.apple.com/documentation/avkit/avroutepickerview) and [responding to audio route changes](https://developer.apple.com/documentation/avfaudio/responding-to-audio-route-changes).
- [Roku ECP documentation](https://developer.roku.com/dev/docs/external-control-api), including the third-party-platform restriction.
- Existing receiver: sibling `Roku-Client`, authenticated MP3/MP4/HLS library and incoming content-ID deep links. No receiver changes in this release.

Verification: mobile TypeScript and the 23 Node playback/session/output tests pass; six native simulator tests pass; the Release simulator app builds and the app-level routing smoke test passes for inline, expanded and minimized video. The UI test uses a bundled synthetic media fixture and confirms the device sheet preserves the same playing media element.

Bluetooth connection/routing and actual speaker disconnection require physical iPhone and speaker validation; a simulator cannot verify the hardware path.

## AirPlay spinner follow-up — November 18, 2026

User reports TV appears but remains on a loading spinner while the standalone Scripture app connects successfully. A connected-device trace captured successful TV route setup followed by repeated mediaplaybackd FigPlayer_AP PlaybackStalled events and zero-rate reports. Some discovery probes also timed out; those alone do not establish the selected TV failed to connect. This is evidence of a media-playback stall, not proof of an HTTP authentication failure. Scripture's public MP3 sources differ from the account-cookie-protected music sources in 0hi.

The music-only AVPlayer now disables external video/remote-asset mode before attaching each item. This retains private asset loading, queue completion and decoding on iPhone while AVAudioSession routes audio to the chosen AirPlay output. Video playback paths are unchanged. The app declares LongFormAudio as its initial route-sharing policy. Explicit resume also reactivates/configures the music session, matching Scripture's reacquisition behavior after another audio owner deactivates it. No playback starts on app foreground or picker presentation.

Validation: 46 mobile regression tests passed. Device playback confirmation remains required; these tests do not emulate AirPlay or authenticate a TV's HTTP requests. Native build/install and physical results are recorded separately as available. Raw device captures stay temporary and are not exported into this documentation.

Diagnostics assessment: existing Settings → Debugging → Debug logs should be extended with allowlisted native playback/route events, an attempt ID, redaction before persistence, bounded retention, a user-triggered detailed recording window and share-sheet export. This assessment did not implement a general all-log collector. An ordinary app cannot collect every iOS system daemon's logs.
