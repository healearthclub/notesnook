# Agent iteration benchmark

Measure whether the repository map and feature guides help an agent find the right code and propose a correct change. Each task starts from the same source snapshot with either the previous docs or the updated docs. The benchmark records observations and does not estimate savings.

| Task                 | Requested change                                                    | Acceptance check                                                                                   |
| -------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Login label          | Change the Google button’s visible and accessibility labels.        | Both labels change, and the busy label stays present.                                              |
| Browser URL handling | Open a bare localhost address with an explicit port as HTTP.        | The address resolver passes local, explicit HTTP(S), normal domain, search, and empty-input cases. |
| Backup metadata      | Add the one-staged-upload limit to the Worker entitlement response. | The entitlement response function contains the requested numeric property.                         |

These are small, read-only coding tasks. Codex proposes exact text replacements, which the runner checks in memory. The task checks are deliberately narrower than the real feature checks in the [Login](../../apps/mobile/app/features/login/README.md), [Browser](../../apps/mobile/app/features/browser/README.md), and [Cloud Backup](../../servers/ohai-backup/README.md#contributor-map) guides.

## Run a paired measurement

From the repository root, with Node 22 or newer, root npm dependencies, Git, ripgrep, and a signed-in Codex CLI:

```sh
# Before editing the contributor docs
node scripts/agent-benchmark/run.mjs --capture-docs ../output/agent-docs-before

# After editing the contributor docs. Pick a model your CLI account can use.
node scripts/agent-benchmark/run.mjs \
  --baseline-docs ../output/agent-docs-before \
  --out ../output/agent-benchmark-run \
  --model gpt-5.5

node scripts/agent-benchmark/report.mjs ../output/agent-benchmark-run
```

Add `--dry-run` to build and compare snapshots without a model call. Use a new output directory each time. The runner records hashes of the common source snapshot and the two sets of docs. The same prompt, model, reasoning effort, and check run in both variants. With `--repetitions 4`, the order alternates across repetitions. Start with one pair per task to check the setup, then repeat before drawing conclusions.

A live run sends the task prompts and excerpts from the source snapshot to the configured Codex service. The runner copies an allowlist of Login, Browser, mobile navigation, and Cloud Backup files. The dry-run config lists the scope. The snapshot filters environment files, credential-like extensions, dependencies, binaries, and Git metadata. Keep the raw output outside the repository. [Codex CLI non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)

## Read the results

- **Input and cached input tokens** come from the CLI’s completed-turn usage. Cached tokens are part of input tokens.
- **Unique files read** counts files whose excerpts the metered context tool returned. A search counts matching files it showed to the model. It excludes files that ripgrep scanned internally.
- **Tool output bytes** counts UTF-8 bytes in the CLI’s completed command outputs, including the meter’s path markers. If the agent uses an unmetered tool, the file and byte counts are unavailable and the attempt fails validation.
- **Reruns** count additional fresh attempts after a failed check. The retry receives only the first error line, limited to 240 characters. The full command output and proposed edit are kept in the local run folder.
- **Elapsed time** sums the time spent in the Codex invocations for each run, including reruns. Snapshot preparation and the external checks are outside this measurement.

Report both variants and any failed attempts. Use the same model and task set for later measurements. For normal feature work, share the failed command, first failing test and useful error, and a path to the full log.
