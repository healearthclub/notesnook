# iOS account books and reader

The implementation contract and rollout checklist are in [Account books sync and iOS reading](../../heal-earth-club/docs/specs/account-books-sync.md).

Home → Books loads the authenticated account library through the existing native Google session. Select an edition for details, then Read book for the native text reader. External titles open their approved HTTPS source without app credentials. Browser-local PDF imports appear after the member explicitly selects Sync library on Heal Earth Club; original binaries remain local.

Key files:
- `apps/mobile/app/features/notes/books-home.tsx` — shelf, details and safe-area reader.
- `apps/mobile/app/features/notes/books-model.ts` — contract validation and account-scoped progress keys.
- `apps/mobile/app/features/notes/books-library.ts` — account/public-edition data loading.
- `apps/mobile/app/features/login/google-session.ts` — credential boundary and stale-session guards.

Validation from the repository root:

```sh
node --test apps/mobile/scripts/tests/books.test.cjs
node_modules/.bin/tsc -p apps/mobile/tsconfig.json --noEmit
```

Reading position is saved per account/book at section granularity on the device; bookmarks are also local. Content is not persistently downloaded for offline access. Component tests use isolated fixtures and do not establish a successful live personal-library migration or physical-device layout. A server deployment and a new app build are required before testing the complete real-account flow.
