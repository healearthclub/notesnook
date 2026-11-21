# Example implementation brief

This example uses a test snapshot with two proposed changes. It demonstrates the handoff format and is not an approved change request.

## Evidence and scope

- Prototype baseline `ohai-ios-notes-2026-11-13`, [Search preview](index.html?view=search).
- App baseline `e1000c6` plus the local iOS working tree checked on November 13, 2026. The [search screen capture](../../../output/notesnook-ios/ui-review/notes-search.png) confirms the visible heading. The app source confirms the shared tab bar renders icons and provides accessible names.
- Scope covers the iOS Notes recent list and the shared tab bar. Sample notes and simulated keyboard behavior are prototype fixtures.

| Surface | Current app | Proposed |
| --- | --- | --- |
| Empty Notes search with recent notes | Shows “Last opened” when recent notes exist. [RecentNotesList](../../apps/mobile/app/features/notes/recent-notes-list.tsx#L55) | Show “Recently opened” under the same condition. |
| Bottom tab bar | Renders an icon per tab, with an accessibility label and selected state on the tab control. [BottomTabBar](../../apps/mobile/app/DesignSystem/UIComponents/BottomTabBar.tsx#L64) | Show Notes, Browser, and Profile below their icons. Reuse the existing labels and selected state. |

## Implementation notes

- Change the heading in `RecentNotesList`. Keep the same loading, filtering, and note-opening logic.
- Render the existing tab item label beneath its icon in `BottomTabBar`. Use theme colors and keep the tab control as the single accessibility target. Check the added label fits inside the current tab dimensions and safe area.
- Preserve search results and clearing behavior. The current app already replaces the recent list when the query is populated. [Search screen](../../apps/mobile/app/screens/search/index.tsx)

## Acceptance checks

- Open Notes search after opening a note. Confirm the heading reads “Recently opened”. Type a matching query, clear it, and confirm the heading returns.
- Switch between Notes, Browser, and Profile on an iPhone simulator. Confirm visible labels and one accessible target per tab with correct selected state.
- Run `./node_modules/.bin/detox test -c ios.sim.release e2e/tests/ios-smoke.e2e.ts` from `apps/mobile` after building that configuration. The existing smoke test covers note persistence and retaining the browser page across tab switches. Use the manual checks above for the labels.
- Refresh `notes.png`, `notes-search.png`, `browser.png`, and `profile.png` in the UI review.

The prototype export and comparison were exercised. These native acceptance checks are planned for the example changes.
