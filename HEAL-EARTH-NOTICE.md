# Heal Earth Notes fork

This repository retains Notesnook's GPL-3.0-or-later license and upstream copyright notices. Upstream: https://github.com/streetwriters/notesnook, baseline `cc151fd1f9ac83f9dca60b1e603188b6eb869f28`.

Heal Earth modifications (2026-11-03): an optional `HEAL_EMBED=true` web build, authenticated Heal Earth context bootstrap, per-account local browser storage, SQLite worker database partitioning, embedded URL routing, local-only feature availability, source attribution, theme bridge, and disabled hosted onboarding, service worker, web-clipper relay, account/sync and commercial UI. This fork does not grant a subscription to Notesnook's hosted services.

The application uses the actual upstream editor, database, notebooks, tags, favorites, archive, trash, search, history, import/export and app-lock UI. It is not a replacement reimplementation. Local database encryption is inherited; multi-device encrypted sync has not been integrated or audited. Browser account partitions do not protect against other software or scripts with access to the same browser origin. Export backups and protect your device.

## Build the embedded web client

Use the upstream Node version in `.nvmrc`/package.json when running native tests. The web build was verified with Node 26; desktop SQLite native tests require the upstream supported Node version. Mobile LFS files are not used by this web build.

1. `npm ci --ignore-scripts --legacy-peer-deps --no-audit --no-fund`
2. `node scripts/bootstrap.mjs --scope web` (web runtime needs esbuild and SWC; native SQLite development dependencies are not used by the browser client).
3. `HEAL_EMBED=true npm run build:web`

The common package lock was repaired with `npm install --ignore-scripts --legacy-peer-deps` because upstream's lock omitted platform optional packages. Preserve the resulting lockfile. The upstream bootstrap patch-package step also reports stale development-only patches; these must be reviewed separately before native test/development workflows.

Serve `apps/web/build` under `/notes-engine/`. The host must implement an authenticated, no-store GET `/api/private-notes/context` returning an opaque account partition matching `heal-notes-[a-f0-9]{64}-`. The client fails closed before opening storage if this is missing. Do not accept a user ID from a query parameter. The embedded bundle blocks connections outside its own origin via CSP. It does not register a service worker over the host app.

Modifications are in `apps/web/src/heal-entry.ts`, `heal-globals.d.ts`, `bootstrap.tsx`, `index.ts`, `index.html`, `app.tsx`, `common/db.ts`, `navigation/index.ts`, `utils/{feature-check,logger}.ts`, `stores/theme-store.ts`, `components/{navigation-menu,status-bar,note}/index.tsx`, `dialogs/settings/index.tsx`, `components/editor/index.tsx` (mobile properties panel), `hooks/{use-is-user-premium,use-routes}.ts`, `apps/web/vite.config.ts`, and `packages/common/src/utils/is-feature-available.ts`.
