# Browser

[BrowserScreen](index.tsx) owns the swipeable page view, tab selection, locally restored URLs, and YouTube playback ownership. [Browser home](browser-home.tsx) lists open tabs and renders the compact resume card. A downward swipe on the tab row or a tap on the chevron minimizes the current page. [BrowserPage](browser-page.tsx) owns each tab’s address field, URL-versus-search routing, and WebView. Start at `addressFromInput` for address handling. Visited tabs retain their live pages and back history while the app runs. After an app restart, tabs reopen from their last URLs. [Main tabs](../../navigation/main-tabs.tsx) owns tab selection and keeps the Browser mounted after first use. The [shared tab bar](../../DesignSystem/UIComponents/BottomTabBar.tsx) renders the controls.

The iOS Browser blocks listed unsafe destinations before navigation and suppresses page-owned JavaScript alerts, confirmations, and prompts at the WebView delegate. The close button on each row of the home tab list removes that tab and its live WebView. Keep the scoped react-native-webview patch applied when rebuilding iOS.

Run from the repository root after dependencies are installed:

```sh
# Fast check for Browser source edits
./node_modules/.bin/eslint apps/mobile/app/features/browser/index.tsx

# After building the simulator app, verify address entry and tab switching.
(cd apps/mobile && npx --no-install detox test -c ios.sim.release e2e/tests/ios-smoke.e2e.ts)
```

The smoke test loads a local HTTP page, switches to Notes, and checks the page is still open when Browser is selected again. It also checks opening and minimizing pages, swiping between tabs, live page state, restoration after restarting the app, and closing a page that repeatedly requests JavaScript dialogs. If you change another address form, verify it explicitly. See the [iOS build guide](../../../IOS-FORK.md#build) for simulator setup. Report a failing test with its first actionable error and full-log path. The Browser URL task is part of the [agent benchmark](../../../../../scripts/agent-benchmark/README.md).
