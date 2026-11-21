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
import { readFileSync } from "node:fs";
import { join } from "node:path";

const directory = process.argv[2];
if (!directory)
  throw new Error("Usage: node scripts/agent-benchmark/report.mjs RESULTS_DIR");
const read = (name) => JSON.parse(readFileSync(join(directory, name), "utf8"));
const config = read("config.json");
const attempts = read("attempts.json");
const ordered = Object.entries(
  Object.groupBy(
    attempts,
    ({ task, variant, repetition }) => `${task} ${variant} ${repetition}`
  )
);
const sum = (rows, key) =>
  rows.some((row) => typeof row[key] !== "number")
    ? "—"
    : rows.reduce((total, row) => total + row[key], 0);
const distinctFiles = (rows) =>
  rows.some((row) => !Array.isArray(row.readPaths))
    ? "—"
    : new Set(rows.flatMap((row) => row.readPaths)).size;

console.log(
  `Model ${config.model}, reasoning effort ${config.reasoningEffort}, CLI ${config.cli}`
);
console.log(`Source snapshot SHA-256 ${config.sourceHash}\n`);
console.log(
  "| Task | Docs | Run | Result | Input tokens | Cached input tokens | Unique files read | Tool output bytes | Reruns | Elapsed ms |"
);
console.log(
  "| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |"
);
for (const [key, rows] of ordered) {
  const [task, variant, run] = key.split(" ");
  const result = rows.at(-1).status;
  console.log(
    `| ${task} | ${variant} | ${run} | ${result} | ${sum(
      rows,
      "inputTokens"
    )} | ${sum(rows, "cachedInputTokens")} | ${distinctFiles(rows)} | ${sum(
      rows,
      "toolOutputBytes"
    )} | ${rows.length - 1} | ${sum(rows, "elapsedMs")} |`
  );
}

const expected = config.tasks.length * 2 * config.repetitions;
if (
  ordered.length !== expected ||
  ordered.some(([, rows]) => rows.at(-1).status !== "pass")
) {
  console.log(
    "\nComparison incomplete. Keep failed runs visible and do not report a savings estimate."
  );
}
