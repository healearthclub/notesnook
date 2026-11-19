# Free iOS app icons

Settings → Customization → Change App Icon opens the shared bottom-sheet UI. Black, Cream and Purple gradient are available without an account or paid plan. The original icon remains the default and can be restored.

The existing 0hi mascot is preserved. Code-rendered backgrounds are composed with it by `apps/mobile/scripts/generate-ios-app-icons.swift`. From `apps/mobile`, run `swift scripts/generate-ios-app-icons.swift` to regenerate the three universal, opaque 1024-pixel iOS icon masters and bundled picker previews. The original AppIcon catalog is unchanged.

Both iOS build configurations declare `OhaiIconBlack`, `OhaiIconCream` and `OhaiIconPurple` as alternate icons and include all app-icon assets. Xcode generates their Info.plist declarations. No icon configuration is edited at runtime.

`OhaiAppIcon` uses UIApplication's public `supportsAlternateIcons`, `alternateIconName` and `setAlternateIconName` APIs on the main queue, including the normal iOS confirmation. It validates allowed choices, serializes changes, and reports native failures. The picker reads the selected icon from iOS on opening and foregrounding; it does not persist a second selection in app settings. A selection checkmark changes only after reading native state. Pending requests and stale status reads are guarded, and failures retain the previous selection and show an error.

The signed-out Profile Settings gear now respects the top safe area, making this entry point reachable without signing in. Android does not show this iOS setting.

## Verification

- Mobile TypeScript checking and `git diff --check` pass.
- Four Node tests cover native status decoding, free choices and original restoration, missing modules/native failures, and opaque 1024-pixel asset masters.
- The Release simulator app builds; all three icons appear in its generated Info.plist and compiled asset catalog.
- The signed-out picker UI test passes: Settings is reachable, all three free choices are enabled, and the sheet opens/closes. Separate native-switch attempts exercise the failure state described below.
- Full OS-level switching/persistence is **not verified**: both the existing simulator and an isolated fresh iOS 26.3.1 simulator reject the operation. Device logs identify `NSPOSIXErrorDomain:5`, `LSGetCSUIAUpcallManager_block_invoke`, and `couldn't load upcall bundle principal class` in Apple's `CoreServicesUIUpcallEmbedded.m`. The test correctly fails rather than pretending a successful switch. No private API or simulator-specific bypass is used. Verify Black → Cream → Purple, app relaunch, and restoring the original on a physical iPhone before considering the native-switch acceptance check complete.

Reference: [Apple's alternate app icon configuration](https://developer.apple.com/documentation/xcode/configuring-your-app-to-use-alternate-app-icons) and [UIApplication icon switching](https://developer.apple.com/documentation/uikit/uiapplication/setalternateiconname(_:completionhandler:)).
