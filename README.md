<p align="center">
<img style="align:center;" src="./resources/icon.png" alt="Notesnook Logo" width="100" />
</p>

<h1 align="center">Notesnook</h1>
<h3 align="center">An end-to-end encrypted note taking alternative to Evernote.</h3>
<p align="center">
<a href="https://notesnook.com/">Website</a> | <a href="https://notesnook.com/about">About us</a> | <a href="https://notesnook.com/roadmap">Roadmap</a> | <a href="https://notesnook.com/downloads">Downloads</a> | <a href="https://twitter.com/@notesnook">Twitter</a> | <a href="https://discord.gg/5davZnhw3V">Discord</a>
</p>

## Overview

Notesnook is a free (as in speech) & open-source note-taking app focused on user privacy & ease of use. To ensure zero knowledge principles, Notesnook encrypts everything on your device using `XChaCha20-Poly1305` & `Argon2`.

Notesnook is our **proof** that privacy does _not_ (always) have to come at the cost of convenience. We aim to provide users peace of mind & 100% confidence that their notes are safe and secure. The decision to go fully open source is one of the most crucial steps towards that.

This repository contains all the code required to build & use the Notesnook web, desktop & mobile clients. If you are looking for a full feature list or screenshots, please check the [website](https://notesnook.com/).

## Developer guide

### Start with the feature

Use this map to find the owning feature and its smallest check. Read the feature README and entry point first. Follow imports into shared code when the change crosses that boundary.

| Working on | Start here |
| --- | --- |
| iOS login or sign-up | [Login feature](apps/mobile/app/features/login/README.md) |
| In-app Browser or address handling | [Browser feature](apps/mobile/app/features/browser/README.md) |
| Cloud Backup metadata, encryption, or storage | [Backup client](packages/ohai-backup/README.md#contributor-map) and [backup Worker](servers/ohai-backup/README.md#contributor-map) |
| Mobile navigation and shared controls | [Main tabs](apps/mobile/app/navigation/main-tabs.tsx) and [BottomTabBar](apps/mobile/app/DesignSystem/UIComponents/BottomTabBar.tsx) |
| Notes UI, editor, or storage | [Mobile Notes entry point](apps/mobile/app/features/notes/index.ts), [editor](packages/editor), and [shared Core](packages/core) |
| Web or desktop app | [Web client](apps/web) and [desktop shell](apps/desktop) |

Try UI changes in the [clickable iOS prototype](docs/ui-prototype/index.html). Export a design snapshot and use `$ui-implementation-brief` to compare it with the current app and prepare a Markdown handoff. The [example brief](docs/ui-prototype/example-implementation-brief.md) shows the expected output.

When the iOS UI changes, rebuild the simulator app and refresh the affected screenshots in the local UI review at `../output/notesnook-ios/ui-review/index.html`. Use the [iOS smoke flow](apps/mobile/e2e/tests/ios-smoke.e2e.ts) with offline sample data. Keep the same screenshot filenames and refresh the embedded copies when sharing the review in Codex.

Run the smallest check first. If a check fails, report the command, failing test or `file:line`, the first actionable error, and the path to the full log. Include expected and actual values when they explain the failure. Keep full logs out of agent context unless the short excerpt is insufficient.

For a before-and-after benchmark, use the same tasks: edit a login label, change Browser URL handling, and add backup metadata. Record model input and cached tokens, distinct files read, tool-output bytes read, reruns, and elapsed time. Keep the model, prompts, and starting implementation comparable. This is a measurement baseline. Savings require observed results. See the [agent benchmark workflow](scripts/agent-benchmark/README.md).

### Technologies & languages

Notesnook is built using the following technologies:

1. JavaScript/Typescript — this repo is in a hybrid state. A lot of the newer code is being written in Typescript & the old code is slowly being ported over.
2. React — the whole front-end across all platforms is built using React.
3. React Native — For mobile apps we are using React Native
4. Electron — For desktop app
5. NPM — listed here because we **don't** use Yarn or PNPM or XYZ across any of our projects.

> **Note: Each project in the monorepo contains its own architecture details which you can refer to.**

### Monorepo structure

| Name                       | Path                                               | Description                                                          |
| -------------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| `@notesnook/web`           | [/apps/web](/apps/web)                             | Web client                                                           |
| `@notesnook/desktop`       | [/apps/desktop](/apps/desktop)                     | Desktop client                                                       |
| `@notesnook/mobile`        | [/apps/mobile](/apps/mobile)                       | Android/iOS clients                                                  |
| `@notesnook/web-clipper`   | [/extensions/web-clipper](/extensions/web-clipper) | Web clipper                                                          |
| `@notesnook/core`          | [/packages/core](/packages/core)                   | Shared core between all platforms                                    |
| `@notesnook/crypto`        | [/packages/crypto](/packages/crypto)               | Cryptography library wrapper around libsodium                        |
| `@notesnook/clipper`       | [/packages/clipper](/packages/clipper)             | Web clipper core handling everything related to actual page clipping |
| `@notesnook/editor`        | [/packages/editor](/packages/editor)               | Notesnook editor + all extensions                                    |
| `@notesnook/editor-mobile` | [/packages/editor-mobile](/packages/editor-mobile) | A very thin wrapper around `@notesnook/editor` for mobile clients    |
| `@notesnook/logger`        | [/packages/logger](/packages/logger)               | Simple & pluggable logger                                            |
| `@notesnook/sodium`        | [/packages/sodium](/packages/sodium)               | Wrapper around libsodium to support Node.js & Browser                |
| `@notesnook/streamable-fs` | [/packages/streamable-fs](/packages/streamable-fs) | Streaming interface around an IndexedDB based file system            |
| `@notesnook/theme`         | [/packages/theme](/packages/theme)                 | The core theme used in web & desktop clients                         |

### Contributing guidelines

If you are interested in contributing to Notesnook, I highly recommend checking out the [contributing guidelines](/CONTRIBUTING.md). You'll find all the relevant information such as [style guideline](/CONTRIBUTING.md#style-guidelines), [how to make a PR](/CONTRIBUTING.md#opening--submitting-a-pull-request), [how to commit](/CONTRIBUTING.md#commit-guidelines) etc., there.

### Support & help

You can reach out to us via:

1. [Email](mailto:support@streetwriters.co)
2. [Discord](https://discord.gg/5davZnhw3V)
3. [Twitter](https://twitter.com/notesnook)
4. [Create an issue](https://github.com/streetwriters/notesnook/issues/new)

We take all queries, issues and bug reports that you might have. Feel free to ask.

## Additional Resources

- [Migrating & Importing your data from other apps — Importer](https://notesnook.com/help/importing-notes)
- [Privacy policy](https://notesnook.com/privacy) & [Terms of service](https://notesnook.com/terms)
- [Verify Notesnook encryption claims yourself — Vericrypt](https://vericrypt.notesnook.com/)
- [Why Notesnook requires an email address?](https://blog.notesnook.com/why-notesnook-requires-an-email-address/)
