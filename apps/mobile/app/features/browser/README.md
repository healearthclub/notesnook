# Browser

[BrowserScreen](index.tsx) owns the address field, URL-versus-search routing, and the WebView. Start at `addressFromInput` for address handling. [Main tabs](../../navigation/main-tabs.tsx) owns tab selection and keeps the Browser mounted after first use. The [shared tab bar](../../DesignSystem/UIComponents/BottomTabBar.tsx) renders the controls.

Run from the repository root after dependencies are installed:

```sh
# Fast check for Browser source edits
./node_modules/.bin/eslint apps/mobile/app/features/browser/index.tsx

# After building the simulator app, verify address entry and tab switching.
(cd apps/mobile && npx --no-install detox test -c ios.sim.release e2e/tests/ios-smoke.e2e.ts)
```

The smoke test loads a local HTTP page, switches to Notes, and checks the page is still open when Browser is selected again. It covers that URL path. If you change another address form, verify it explicitly. See the [iOS build guide](../../../IOS-FORK.md#build) for simulator setup. Report a failing test with its first actionable error and full-log path. The Browser URL task is part of the [agent benchmark](../../../../../scripts/agent-benchmark/README.md).
