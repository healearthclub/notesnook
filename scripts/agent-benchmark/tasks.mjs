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
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function parse(source) {
  return ts.createSourceFile(
    "feature.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
}

export function verifySyntax(source) {
  const diagnostic = parse(source).parseDiagnostics[0];
  if (diagnostic) {
    throw new Error(
      ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")
    );
  }
}

function topLevelFunction(source, name) {
  const tree = parse(source);
  const declaration = tree.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name
  );
  assert.ok(declaration, `Expected function ${name}.`);
  return declaration;
}

export const tasks = {
  login: {
    path: "apps/mobile/app/features/login/google-screen.tsx",
    prompt:
      'Change the iOS Google sign-in button label from "Continue with Google" to "Sign in with Google". Update the visible idle label and its accessibility label. Keep the busy label and sign-in behavior.',
    verify(source) {
      assert.equal(
        source.split("Sign in with Google").length - 1,
        2,
        "Expected the new label twice."
      );
      assert.ok(
        !source.includes("Continue with Google"),
        "The old label still appears."
      );
      assert.ok(source.includes("Please wait…"), "The busy label changed.");
    }
  },
  browser: {
    path: "apps/mobile/app/features/browser/browser-page.tsx",
    prompt:
      "When a user enters a bare localhost address with an explicit port, treat it as a local web URL using http. Preserve its port and any path or query. Keep explicit HTTP(S), ordinary domains, empty input, and normal search behavior.",
    verify(source) {
      const functions = ["isWebAddress", "addressFromInput"]
        .map((name) => topLevelFunction(source, name).getText())
        .join("\n");
      const { outputText } = ts.transpileModule(functions, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 }
      });
      const examples = [
        ["localhost:3000", "http://localhost:3000"],
        [" localhost:8080/notes?q=one ", "http://localhost:8080/notes?q=one"],
        ["https://example.com/page", "https://example.com/page"],
        ["http://localhost:3000/", "http://localhost:3000/"],
        ["example.com", "https://example.com"],
        [
          "what is localhost",
          "https://duckduckgo.com/?q=what%20is%20localhost"
        ],
        [" ", undefined]
      ];
      for (const [input, expected] of examples) {
        const result = runInNewContext(
          `${outputText}\naddressFromInput(${JSON.stringify(input)})`,
          {},
          {
            timeout: 100,
            contextCodeGeneration: { strings: false, wasm: false }
          }
        );
        assert.equal(
          result,
          expected,
          `Unexpected result for ${JSON.stringify(input)}.`
        );
      }
    }
  },
  backup: {
    path: "servers/ohai-backup/src/accounts.ts",
    prompt:
      "Add maxInFlightUploads with numeric value 1 to the existing Cloud Backup Worker entitlement response. This represents the one staged upload per account. Keep the rest of the response and authorization rules as they are.",
    verify(source) {
      const handler = topLevelFunction(source, "getEntitlement");
      const response = handler.body?.statements.find(
        ts.isReturnStatement
      )?.expression;
      const metadata =
        response && ts.isCallExpression(response)
          ? response.arguments[0]
          : undefined;
      const property =
        metadata && ts.isObjectLiteralExpression(metadata)
          ? metadata.properties.find(
              (entry) =>
                ts.isPropertyAssignment(entry) &&
                entry.name.getText() === "maxInFlightUploads"
            )
          : undefined;
      assert.equal(
        property?.initializer.getText(),
        "1",
        "Expected numeric metadata in the entitlement response."
      );
    }
  }
};
