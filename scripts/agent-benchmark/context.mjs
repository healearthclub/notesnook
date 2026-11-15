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
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const [mode, query, first, last] = process.argv.slice(2);
const root = realpathSync(".");
const limit = 12000;

function filePath(path) {
  if (!path || isAbsolute(path) || path.startsWith("-"))
    throw new Error("Use a repository-relative path.");
  const absolute = realpathSync(resolve(root, path));
  const name = relative(root, absolute);
  if (
    name === ".." ||
    name.startsWith("../") ||
    name.startsWith("scripts/agent-benchmark/")
  ) {
    throw new Error("Path is outside the source being measured.");
  }
  return { absolute, name };
}

function emit(path, excerpt) {
  if (excerpt)
    process.stdout.write(
      `@@benchmark-file ${JSON.stringify(path)}\n${excerpt}\n`
    );
}

try {
  if (mode === "read") {
    const { absolute, name } = filePath(query);
    const start = first === undefined ? 1 : Number(first);
    const end = last === undefined ? start + 79 : Number(last);
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 1 ||
      end < start ||
      end - start >= 100
    ) {
      throw new Error("Read between 1 and 100 lines.");
    }
    if (!statSync(absolute).isFile() || statSync(absolute).size > 1024 * 1024) {
      throw new Error("Choose a source file below 1 MiB.");
    }
    const lines = readFileSync(absolute, "utf8").split("\n");
    const excerpt = lines
      .slice(start - 1, end)
      .map((line, i) => `${start + i}: ${line}`)
      .join("\n");
    emit(name, excerpt.slice(0, limit));
  } else if (mode === "search") {
    if (!query || query.length > 150 || query.includes("\n"))
      throw new Error("Supply a short literal search.");
    const { name } = filePath(first ?? ".");
    const result = spawnSync(
      "rg",
      [
        "--json",
        "--fixed-strings",
        "--ignore-case",
        "--max-count",
        "3",
        "--glob",
        "!scripts/agent-benchmark/**",
        "--",
        query,
        name || "."
      ],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }
    );
    if (result.error || ![0, 1].includes(result.status))
      throw new Error("Search failed. Try a narrower path or phrase.");
    const matches = result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse)
      .filter(({ type }) => type === "match");
    for (const { data } of matches.slice(0, 12)) {
      emit(
        data.path.text.replace(/^\.\//, ""),
        `${data.line_number}: ${data.lines.text.trimEnd().slice(0, 650)}`
      );
    }
    if (!matches.length) console.log("No matches.");
    if (matches.length > 12)
      console.log("More matches exist. Narrow the path or phrase.");
  } else {
    throw new Error('Use read PATH [FIRST LAST] or search "LITERAL" [PATH].');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
