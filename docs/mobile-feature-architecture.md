# Ohai mobile feature architecture

**Status:** Proposed implementation spec for `apps/mobile` in the Notesnook fork.

## Goal

Organize the mobile app around four tabs in this order: **Notes**, **Browser**, **Inbox**, and **Explore**. Each tab is a feature with its own folder, UI, state, and tests. **Login** follows the same structure as a feature reached through the root navigation stack.

Use one Git repository and one React Native app. Each feature should be independently understandable and testable through a small public interface. Changes that span a feature and the app shell can ship in one commit and one app release.

## Current code

- `app/navigation/main-tabs.tsx` currently hosts Notes and Browser. `app/navigation/fluid-panels-view.tsx` wraps the Notes panels in `MainTabs`.
- Notes UI spans `app/screens/notes/`, `app/screens/editor/`, and the supporting note and notebook screens. The Browser entry point is `app/screens/browser/index.tsx`.
- The root stack registers `Auth` from `app/components/auth/`. Inbox key management and failed-item history live under `app/screens/settings/`. The current tab bar has no Inbox or Explore entries.

## Target layout

Paths are relative to `apps/mobile/`.

```text
app/
  app.tsx
  navigation/                # Root stack, tab bar, and cross-feature routing
  features/
    notes/
      index.ts               # Public entry point
      screens/
      components/
      __tests__/
    browser/
      index.ts
      ...
    inbox/
      index.ts
      ...
    explore/
      index.ts
      ...
    login/
      index.ts
      ...
  components/ui/             # Shared UI primitives
  services/                  # Shared app and platform integrations
e2e/tests/                   # Flows that exercise the integrated app
```

Each feature keeps its screens, components, hooks, state, adapters, and tests together as needed. Add subfolders when the feature has code for them. For example, a browser address bar belongs to Browser and a generic button belongs in the existing shared UI.

| Feature | Entry point | Owns |
| --- | --- | --- |
| Notes | `NotesTab` | Notes lists and editor, note and notebook navigation, editor drafts, and mobile adapters for existing note operations. Notes is the default tab for a normal launch into the main app. |
| Browser | `BrowserTab` | Address bar, WebView, browser navigation, and page state. It mounts on first use and retains its page and navigation state when switching tabs. |
| Inbox | `InboxTab` | Inbox entry screen and Inbox-specific presentation and actions. Reuse the existing Inbox history, setup, and key management where applicable. Existing Settings routes should reach the same feature screens through public exports. |
| Explore | `ExploreTab` | Explore entry screen and future discovery UI. The first release of this structure can use a simple empty state until content and its source are defined. |
| Login | `LoginScreen` | Sign-in, sign-up, two-factor authentication, password recovery, session-expired UI, and the existing offline entry flow. Reuse existing auth services and preserve the `Auth` route. |

## Feature boundaries

- Each `features/<name>/index.ts` exposes its screen, navigator, and any types or entry points needed by callers. Feature code may import its own internal files. Callers outside the feature use its public entry point.
- The app shell imports and mounts the feature entry points. It owns tab order, selection, keyboard and safe-area handling, root routes, and deep-link dispatch. Features own their internal navigation and tell the shell about tab-bar visibility needs through a small typed interface, such as Notes fullscreen mode.
- A feature requests cross-feature navigation through a typed callback or route owned by the shell. For example, opening a note from Inbox passes a note ID to the shell, which activates Notes and invokes its public note-opening entry point. Shared UI and services stay independent of feature implementations.
- Keep feature-specific state local. Continue using the existing Notesnook core, storage, sync, session, theme, and native integrations through their current interfaces. Move feature-specific adapters with their feature when practical. A folder move requires no storage schema, backend, or native app identity changes.
- Preserve mounted Notes state during tab switches, including open editor drafts. Keep Browser mounted after first use. Hide inactive tabs from touch and accessibility focus, and suspend foreground-only work when appropriate. Scope account-dependent state to the active account and clear it on sign-out through the existing lifecycle.
- Enforce public entry points and the direction of imports in the mobile lint or CI check. During migration, keep compatibility exports at legacy paths only for existing callers and remove them once those callers migrate.

## Migration sequence

1. Move `MainTabs` composition to the app shell and register Notes and Browser as public feature entries. Extract the Notes panels from the tab wrapper before moving their implementation. Preserve existing tab test IDs and verify note opening, fullscreen editing, keyboard insets, and Browser state before adding tabs.
2. Move the current Browser screen and Notes-owned UI into their feature folders in small steps. Route deep links, quick actions, and existing navigation to the Notes feature while preserving route names and persisted data.
3. Move the auth flow behind the Login entry point. Preserve the root `Auth` route, onboarding handoff, offline entry, and existing session behavior.
4. Add Inbox and Explore in the requested order. Connect Inbox to existing flows and expose clear empty or unavailable states where applicable. Use an empty state for Explore until a product spec defines its content.
5. Remove temporary compatibility exports and enable the feature boundary checks for all five modules.

## Acceptance criteria

- The main tab bar shows Notes, Browser, Inbox, and Explore in order. Login remains accessible through the existing auth routes.
- Each feature has its own folder and public entry point. Lint or CI rejects imports into another feature's internals and imports from shared code into feature implementations.
- Users can create a local note, reopen it after app restart, switch tabs with a draft open, and return to the draft. Existing note deep links and shortcuts activate Notes and open the intended destination.
- Browser keeps its current page and back/forward state while users switch tabs. Keyboard and safe-area behavior still works in Browser and the fullscreen Notes editor. Inactive tabs are skipped by VoiceOver.
- Inbox opens with the appropriate state and existing Inbox settings remain reachable. Explore opens to its empty state. Sign-in, two-factor authentication, password recovery, and offline entry still follow their existing paths.
- Run the mobile typecheck and lint, extend the existing Detox tab smoke test at `apps/mobile/e2e/tests/local-main-tabs.e2e.ts`, and verify the integrated flow on iOS. Run the Android build and tab smoke check because both platforms share this navigation code.
