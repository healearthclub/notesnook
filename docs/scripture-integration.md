# Reuse Scripture in 0hi and Heal Earth Club

The source app is `App2.0/bible-ios`. Its original Swift files, corpus and personal app sandbox are preserved. The integration uses the existing reader rather than rebuilding a second native reader.

## Run the integration

From `../../App2.0/bible-ios` (relative to this repository):

```sh
python3 Tools/integrate_apps.py --dry-run
python3 Tools/integrate_apps.py
python3 Tools/integrate_apps.py --check
```

Default targets are sibling `Ohai/notesnook` and `Ohai/heal-earth-club`. Use `--target ios` or `--target web`, or supply `--ios /path/to/notesnook --web /path/to/heal-earth-club`. Python 3 and macOS `plutil` are required for the iOS project patch. No third-party Python dependencies are required. Source archives must already exist in `Tools/Sources`.

The script validates every verse against the pinned publisher archives before making changes. It embeds the Swift source and public SQLite database in 0hi, adds an entry under Home → Books, and exports identical chapter data plus a React reader into the web app under Books → Bible (`/bible`). The web reader is public; account-specific study records stay local. It preserves the web client directive and existing app routes. Every rerun is idempotent. A changed host structure fails with a named adapter error rather than replacing an entire host file.

`vendor/scripture/installation.json` records generated file hashes and source provenance. Edit source files or `Integration` templates, then rerun. If a generated destination has independent edits the installer stops; preserve those edits before intentionally using `--force`. The force flag applies to generated integration files, not unrelated host code. The process plans both targets before writing, uses atomic file replacement, and is safe to rerun after an interrupted copy. It is not a transaction across repositories and does not automatically remove obsolete generated files.

The script does not deploy the website, sign/install an iPhone build, migrate original Scripture personal notes, or change the host app's minimum iOS version.

## Included behavior

- WEB and BSB: 66 books and 1,189 chapters per edition, exact source text, headings, footnotes and verse alignment including cross-chapter differences.
- Passage aliases, phrase/text search, chapter navigation and translation comparison.
- Local bookmarks, highlights, notes and reading location scoped separately for each account or guest.
- On-demand publisher chapter audio: all 1,189 BSB chapters and the original 309-entry WEB catalogue.
- Native system sharing and web share/copy; adjustable type and paper appearance.

0hi embeds the native reader behind an iOS 17 availability check. Older iOS versions receive an explanatory error. Native text/search work offline from the bundled database; audio needs a network. Web chapters/search are static assets loaded on demand and require a connection unless already cached by the browser; there is no promised web offline download.

Native study is in Application Support/OhaiScripture with SHA-256 account keys and separate preference suites. Web study is in account-keyed localStorage; this is namespace isolation, not encryption or a separate access boundary for someone using the same browser profile. An account switch closes the native reader and remounts the web reader. Original standalone Scripture study stays in its original sandbox. No private study database is exported into public web assets. Study is not cloud synced or published by this feature.

0hi pauses its music player before opening Scripture, preserving the queue. Scripture owns a separate Now Playing session so it does not replace browser metadata through the global default center. Closing Scripture ends its audio; it does not automatically resume prior music. Web chapter audio reuses the existing single music provider.

## Sources

Publisher source dates and archive hashes remain in `Resources/Sources.json` and exported `public/scripture/Sources.json`. WEB/BSB text is dedicated to the public domain by its publishers; retain edition names with unchanged text. Publisher terms reviewed November 18, 2026:

- [WEB](https://ebible.org/engwebp/copyright.htm)
- [BSB text](https://berean.bible/terms.htm)
- [BSB audio dedication](https://bereanbible.com/audio/)
- [WEB recording catalogue](https://ebible.org/engwebu/mp3/)

No new Bible API credentials, paid provider, identity endpoint or database migration is introduced. Existing local pinned data meets this request better than a separate Bible API with a different corpus/availability contract.

## Validation

```sh
python3 -m unittest discover -s Tests -p test_integration.py
```

Host checks: mobile TypeScript, an actual 0hi simulator build, existing Books component/session tests, web TypeScript, `tests/scripture.test.ts`, original Scripture unit tests and local browser interaction checks. Physical-device audio handoff, interruption/lock-screen behavior, VoiceOver and production release remain separate acceptance work.
