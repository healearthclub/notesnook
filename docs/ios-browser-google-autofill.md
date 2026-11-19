# iOS Browser: Google sign-in with Password AutoFill and passkeys

**Status:** Proposed · **Scope:** 0hi Browser on iPhone · **Reference:** Screen recording supplied November 17, 2026

## User story

When I choose **Continue with Google** on a website in 0hi Browser, I want my iPhone to offer the Google passkey or password I already saved in 1Password or Apple Passwords. I can unlock my credential provider and finish signing in without copying a password or switching to the password manager first.

The recording starts at X’s sign-in page. After the browser opens Google’s sign-in page for X, iOS offers **Use Passkey** for a Google credential saved in 1Password. Tapping it leads to an iPhone passcode prompt. The clip ends during that prompt, before sign-in completion. This is a passkey flow. The implementation must also support the Google username and password flow through the iOS AutoFill surface.

## User flow

1. In 0hi Browser, select **Continue with Google** on X or open a Google account sign-in page.
2. 0hi intercepts the Google sign-in request and offers **Open browser** or **Cancel**. Suggested copy for X: “Open X in your browser, then choose Continue with Google again. You’ll stay signed in to X in that browser.” For direct Google entry, open Google instead of X and omit the retry instruction.
3. The system browser opens the site’s approved sign-in entry point. For X, the user selects **Continue with Google** there so the site can create its own OAuth request and opener. For direct Google sign-in, the user continues on the Google sign-in page.
4. If Google and iOS find an eligible passkey, iOS offers its own passkey prompt. For a saved password, tapping the Google username or password field offers AutoFill suggestions or opens the system Passwords picker. The user can confirm with Face ID or the unlock method iOS and the provider require. Provider labels and choice come from iOS.
5. Without a matching credential, the user can sign in manually or use Google’s other sign-in methods. Dismissing the credential prompt leaves Google’s form usable. If the user cancels the 0hi handoff, stay on the current tab. Returning to 0hi restores the same tab and page.

**Release boundary:** Support X and direct Google entry first. Website sign-in completes in the system browser, with the session owned by that browser. Returning to 0hi does not sign its separate embedded web view into the website. If keeping the browser chrome and website signed in inside 0hi becomes a requirement, validate a system-provided in-app browser surface for the entire relying-site flow as a separate step. Verify popups, provider prompts, and session behavior on device before committing to that experience.

## Implementation

- **Use the existing browser handoff.** In [browser-page.tsx](../apps/mobile/app/features/browser/browser-page.tsx), X’s Google popup already triggers a prompt that opens the canonical X login page via `Linking.openURL`. Extend the same decision to top-frame Google sign-in redirects and direct navigation. Handle popups through `onOpenWindow`, redirects through `onShouldStartLoadWithRequest`, and address-bar or restored initial URLs before assigning them as the WebView source. Route all paths through one destination classifier and one confirmation handler. Verify that a handled Google auth URL never loads in `WKWebView`.
- **Use validated destinations.** Parse URLs and match exact HTTPS origins and recognized sign-in paths. Use a supported-site adapter for each relying site, beginning with `https://x.com` and its existing `twitter.com` source alias, both launching `https://x.com/i/flow/login`. Resolve the source from the last committed top-level page, not the pending Google URL. Direct Google account entry launches a fixed Google sign-in entry point, such as `https://accounts.google.com/`. For unsupported relying sites, explain the limitation and offer to open the validated, last committed HTTPS page in the system browser after user confirmation. Never replay an intercepted popup, POST, OAuth callback, or its `redirect_uri`, `state`, or token parameters. Preserve the existing browser block list, reject lookalike origins, and ignore iframe or background-tab requests for presenting the handoff.
- **Keep the interaction recoverable.** Allow one confirmation at a time for the selected tab. Clear it on cancel, navigation away, tab closure, and launch failure. If opening the browser fails, show “Couldn’t open your browser” with a retry option and leave the originating tab available. Provide an **Open in Browser** escape hatch for the current validated HTTPS page so users can restart flows that launch in an iframe or use an unrecognized route.
- **Let iOS handle credentials.** Don’t enumerate installed providers, query vaults, inject JavaScript into Google forms, add Google associated domains, or pass passwords, passkeys, or website cookies through React Native. If users need setup help, direct them to **Settings → General → AutoFill & Passwords** on supported iOS versions. Keep manual sign-in available if AutoFill is disabled or the default browser does not offer the provider flow. If collecting telemetry, record a coarse handoff outcome only, with no full URLs, queries, account identifiers, or provider information.
- **Keep Profile sign-in separate.** 0hi’s own Google login in [AppDelegate.mm](../apps/mobile/ios/Notesnook/AppDelegate.mm) already uses `ASWebAuthenticationSession` with a Heal Earth callback. Preserve that path and its callback validation. The app owns that callback. It does not own X’s callback or the website session, and should not pass third-party website sign-in through the Profile bridge.

## Acceptance criteria

| Scenario | Expected result |
| --- | --- |
| X → Continue with Google, with a Google passkey in 1Password | The handoff opens X in the system browser. Starting Google sign-in there can surface the iOS passkey prompt. After device or provider unlock, Google returns to X in that browser. |
| Apple Passwords contains a Google passkey or password | With Apple Passwords enabled for AutoFill, the eligible passkey or password can be selected on Google’s page. Run the same password check with 1Password enabled. |
| Both providers are enabled, or no match exists | iOS offers eligible credentials through its standard UI. 0hi does not choose a provider or block manual sign-in. |
| Popup, top-frame redirect, typed URL, or restored sign-in URL | At most one handoff prompt appears for the active tab. Google auth does not load in the embedded WebView. Restored tabs prompt only when active and do not launch the system browser automatically. |
| User cancels, opens 0hi again, or launch fails | The originating tab and page remain available. There is no phantom Google tab, blocked overlay, or false signed-in state. |
| Lookalike domain, blocked destination, or background request | No handoff or credential UI is triggered by 0hi. Ordinary navigation continues to follow the existing browser safety rules. |
| 0hi Profile → Continue with Google | The existing app sign-in and Heal Earth callback still succeed. Website sign-in does not change the 0hi account. |

Test URL classification and handoff deduplication with fixtures. Confirm real credential prompts and successful X sign-in on a physical iPhone with each provider enabled separately, then with both enabled. Test Safari and an alternate default browser, noting any browser-specific limits. Use test accounts and keep credentials out of logs and test artifacts.

## References

- [Apple: Password AutoFill and third-party web services](https://developer.apple.com/documentation/security/password-autofill)
- [Apple: SFSafariViewController](https://developer.apple.com/documentation/safariservices/sfsafariviewcontroller)
- [Google: OAuth and embedded user-agent restrictions](https://developers.google.com/identity/protocols/oauth2/native-app#disallowed_useragent)
- [Google: Sign in with a passkey](https://support.google.com/accounts/answer/13548313)
- [1Password: Set up AutoFill on iPhone](https://support.1password.com/ios-autofill/)
- [Apple: Fill saved passwords on iPhone](https://support.apple.com/en-gb/guide/iphone/iphf9219d8c9/ios)
