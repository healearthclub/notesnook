/*
This file is part of the Notesnook project (https://notesnook.com/)

Copyright (C) 2023 Streetwriters (Private) Limited

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { tasks, verifySyntax } from "./tasks.mjs";

const docs = [
  "README.md",
  "apps/mobile/app/features/login/README.md",
  "apps/mobile/app/features/browser/README.md",
  "packages/ohai-backup/README.md",
  "servers/ohai-backup/README.md"
];
const helper = "scripts/agent-benchmark/context.mjs";
const sourceScope = [
  "apps/mobile/app/features/login/",
  "apps/mobile/app/features/browser/",
  "apps/mobile/app/components/auth/",
  "apps/mobile/app/navigation/",
  "apps/mobile/app/DesignSystem/",
  "apps/mobile/e2e/tests/ios-smoke.e2e.ts",
  "packages/ohai-backup/src/",
  "servers/ohai-backup/src/",
  "servers/ohai-backup/test/"
];
const { values: args } = parseArgs({
  options: {
    "capture-docs": { type: "string" },
    "baseline-docs": { type: "string" },
    out: { type: "string" },
    model: { type: "string" },
    repetitions: { type: "string", default: "1" },
    retries: { type: "string", default: "1" },
    "dry-run": { type: "boolean" }
  }
});
const root = realpathSync(
  spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8"
  }).stdout.trim()
);

function copy(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

if (args["capture-docs"]) {
  const capture = resolve(args["capture-docs"]);
  mkdirSync(capture);
  for (const file of docs) {
    if (existsSync(join(root, file)))
      copy(join(root, file), join(capture, file));
  }
  console.log(`Captured baseline docs in ${capture}`);
  process.exit(0);
}

const repetitions = Number(args.repetitions);
const retries = Number(args.retries);
if (
  !args["baseline-docs"] ||
  !args.out ||
  !args.model ||
  !Number.isSafeInteger(repetitions) ||
  repetitions < 1 ||
  repetitions > 10 ||
  !Number.isSafeInteger(retries) ||
  retries < 0 ||
  retries > 3
) {
  throw new Error(
    "Set --baseline-docs DIR --out NEW_DIR --model MODEL [--repetitions 1..10] [--retries 0..3] [--dry-run]."
  );
}
const baseline = realpathSync(args["baseline-docs"]);
if (!existsSync(join(baseline, "README.md")))
  throw new Error("Baseline root README is missing.");
const output = resolve(args.out);
const paths = spawnSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { cwd: root, encoding: "utf8" }
);
if (paths.status !== 0) throw new Error("Could not list repository files.");
const files = [...new Set(paths.stdout.split("\0").filter(Boolean))].sort();
const sourceHash = createHash("sha256");
const scratch = mkdtempSync(join(tmpdir(), "ohai-agent-benchmark-"));
const schema = join(scratch, "response-schema.json");
const metrics = [];
try {
  const base = join(scratch, "source");
  for (const path of files) {
    if (
      (path !== helper &&
        !sourceScope.some((entry) =>
          entry.endsWith("/") ? path.startsWith(entry) : path === entry
        )) ||
      isAbsolute(path) ||
      path.split("/").includes("..") ||
      /(^|\/)(\.env(?:\.|$)|\.dev\.vars(?:\.|$)|\.npmrc$|AGENTS\.md$|\.codex\/|\.agents\/)/i.test(
        path
      ) ||
      /\.(pem|p8|p12|key|mobileprovision)$/i.test(path) ||
      (path.startsWith("scripts/agent-benchmark/") && path !== helper) ||
      docs.includes(path)
    )
      continue;
    const from = join(root, path);
    if (
      !existsSync(from) ||
      !lstatSync(from).isFile() ||
      realpathSync(from) !== from
    )
      continue;
    const bytes = readFileSync(from);
    if (bytes.length > 1024 * 1024 || bytes.includes(0)) continue;
    copy(from, join(base, path));
    sourceHash
      .update(path)
      .update("\0")
      .update(createHash("sha256").update(bytes).digest());
  }
  for (const task of Object.values(tasks)) {
    if (!existsSync(join(base, task.path)))
      throw new Error(`Task source missing: ${task.path}`);
  }
  const variants = {
    before: join(scratch, "snapshot-a"),
    after: join(scratch, "snapshot-b")
  };
  const docDigests = {};
  for (const [variant, folder] of Object.entries(variants)) {
    const copyResult = spawnSync("cp", ["-R", base, folder]);
    if (copyResult.status !== 0)
      throw new Error("Could not copy source snapshot.");
    docDigests[variant] = {};
    for (const path of docs) {
      const from = join(variant === "before" ? baseline : root, path);
      if (existsSync(from)) {
        copy(from, join(folder, path));
        docDigests[variant][path] = createHash("sha256")
          .update(readFileSync(from))
          .digest("hex");
      }
    }
  }
  if (JSON.stringify(docDigests.before) === JSON.stringify(docDigests.after)) {
    throw new Error("Before and after docs are identical.");
  }
  const cli = spawnSync("codex", ["--version"], { encoding: "utf8" });
  if (cli.status !== 0) throw new Error("Codex CLI is unavailable.");
  const config = {
    model: args.model,
    reasoningEffort: "low",
    cli: cli.stdout.trim(),
    sourceHash: sourceHash.digest("hex"),
    sourceScope,
    docDigests,
    repetitions,
    retries,
    tasks: Object.keys(tasks)
  };
  mkdirSync(output);
  writeFileSync(
    join(output, "config.json"),
    JSON.stringify(config, null, 2) + "\n"
  );
  if (!args["dry-run"]) {
    writeFileSync(
      schema,
      JSON.stringify({
        type: "object",
        properties: {
          path: { type: "string" },
          edits: {
            type: "array",
            items: {
              type: "object",
              properties: {
                before: { type: "string" },
                after: { type: "string" }
              },
              required: ["before", "after"],
              additionalProperties: false
            }
          }
        },
        required: ["path", "edits"],
        additionalProperties: false
      })
    );
    for (let repeat = 0; repeat < repetitions; repeat++) {
      for (const [id, task] of Object.entries(tasks)) {
        for (const variant of repeat % 2
          ? ["after", "before"]
          : ["before", "after"]) {
          let failure;
          for (let attempt = 0; attempt <= retries; attempt++) {
            const entry = run(
              task,
              id,
              variant,
              variants[variant],
              repeat,
              attempt,
              failure
            );
            metrics.push(entry);
            writeFileSync(
              join(output, "attempts.json"),
              JSON.stringify(metrics, null, 2) + "\n"
            );
            console.log(
              `${id} ${variant} #${repeat + 1} attempt ${attempt + 1}: ${
                entry.status
              }`
            );
            if (entry.status === "infra_error")
              throw new Error(
                "Codex invocation failed. See the local benchmark logs."
              );
            if (entry.status === "pass") break;
            failure = entry.failure;
          }
        }
      }
    }
  }
  console.log(
    `${args["dry-run"] ? "Benchmark plan" : "Benchmark results"}: ${output}`
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

function run(task, id, variant, cwd, repeat, attempt, failure) {
  const stem = `${id}-${variant}-${repeat + 1}-${attempt + 1}`;
  const raw = join(output, stem + ".jsonl");
  const answer = join(output, stem + ".answer.json");
  const stdout = openSync(raw, "wx", 0o600);
  const stderr = openSync(join(output, stem + ".stderr"), "wx", 0o600);
  const started = performance.now();
  let command;
  try {
    const prompt = `This is a read-only coding benchmark. Read README.md first with node ${helper} read README.md 1 100. Follow its feature map if available. Inspect repository contents only with node ${helper} read PATH [FIRST LAST] or node ${helper} search "LITERAL" [PATH], one command per call. Do not call other tools, edit files, or run tests. Return the repository-relative path and exact, unique before/after text replacements for a minimal edit to one source file. An external checker validates the proposal.

Task: ${task.prompt}${failure ? `\nPrevious check failed: ${failure}` : ""}`;
    command = spawnSync(
      "codex",
      [
        "exec",
        "--json",
        "--ephemeral",
        "--ignore-user-config",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "-C",
        cwd,
        "-m",
        args.model,
        "-c",
        'model_reasoning_effort="low"',
        "--output-schema",
        schema,
        "-o",
        answer,
        prompt
      ],
      {
        cwd,
        stdio: ["ignore", stdout, stderr],
        timeout: 90000,
        killSignal: "SIGKILL"
      }
    );
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
  const elapsedMs = Math.round(performance.now() - started);
  const events = [];
  let malformedEvent = false;
  for (const line of readFileSync(raw, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      malformedEvent = true;
    }
  }
  const completed = events
    .filter((event) => event.type === "item.completed")
    .map(({ item }) => item);
  const commands = completed.filter(({ type }) => type === "command_execution");
  const turn = events.findLast(({ type }) => type === "turn.completed");
  const reads = new Set();
  let toolOutputBytes = 0;
  let metered = true;
  let failedCommands = 0;
  for (const item of commands) {
    if (item.exit_code !== 0) failedCommands++;
    const text = item.aggregated_output ?? "";
    if (
      typeof item.aggregated_output !== "string" ||
      !/scripts\/agent-benchmark\/context\.mjs\s+(read|search)\s/.test(
        item.command
      ) ||
      /[;&|<>]|\$\(|`/.test(item.command)
    )
      metered = false;
    toolOutputBytes += Buffer.byteLength(text);
    for (const match of text.matchAll(/^@@benchmark-file ("[^\n]+")$/gm)) {
      reads.add(JSON.parse(match[1]));
    }
  }
  if (completed.some(({ type }) => /mcp|web_search|file_change/.test(type)))
    metered = false;
  const result = {
    task: id,
    variant,
    repetition: repeat + 1,
    attempt: attempt + 1,
    elapsedMs,
    inputTokens: turn?.usage?.input_tokens ?? null,
    cachedInputTokens: turn?.usage?.cached_input_tokens ?? null,
    outputTokens: turn?.usage?.output_tokens ?? null,
    filesRead: metered ? reads.size : null,
    readPaths: metered ? [...reads].sort() : null,
    toolOutputBytes: metered ? toolOutputBytes : null,
    failedCommands,
    metered
  };
  if (command.status !== 0 || malformedEvent || !turn || !existsSync(answer)) {
    return {
      ...result,
      status: "infra_error",
      failure: "Codex did not complete. See stderr and JSONL."
    };
  }
  try {
    if (!metered || !reads.has("README.md"))
      throw new Error(
        "Use the metered context command and read the root README first."
      );
    const proposal = JSON.parse(readFileSync(answer, "utf8"));
    if (
      proposal.path !== task.path ||
      !Array.isArray(proposal.edits) ||
      !proposal.edits.length ||
      proposal.edits.length > 5
    ) {
      throw new Error(
        "Return a minimal edit to the single file that owns the behavior."
      );
    }
    let source = readFileSync(join(cwd, task.path), "utf8");
    for (const { before, after } of proposal.edits) {
      if (
        typeof before !== "string" ||
        !before ||
        typeof after !== "string" ||
        source.indexOf(before) === -1 ||
        source.indexOf(before) !== source.lastIndexOf(before)
      ) {
        throw new Error("Each before string must match exactly once.");
      }
      source = source.replace(before, () => after);
    }
    verifySyntax(source);
    task.verify(source);
    return { ...result, status: "pass" };
  } catch (error) {
    return {
      ...result,
      status: "fail",
      failure: String(error.message).split("\n")[0].slice(0, 240)
    };
  }
}
