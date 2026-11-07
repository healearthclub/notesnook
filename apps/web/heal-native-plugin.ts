/* Scope Notes component DOM/storage references without modifying host globals. */
import type { Plugin } from "vite";
import path from "node:path";
export function healNativePlugin(): Plugin {
  const runtime = path.resolve(__dirname, "src/heal-native-runtime.ts");
  return {
    name: "heal-native-scopes",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "wouter" && importer?.includes("/apps/web/src/"))
        return path.resolve(__dirname, "src/heal-native-router.ts");
      if (
        source === "react-dom/client" &&
        importer &&
        !importer.includes("/node_modules/") &&
        (importer.includes("/apps/web/src/") ||
          importer.includes("/packages/editor/")) &&
        !importer.includes("heal-native-react-root")
      )
        return path.resolve(__dirname, "src/heal-native-react-root.ts");
    },
    transform(code, id) {
      const file = id.split("?")[0];
      if (
        !/\.[cm]?[jt]sx?$/.test(file) ||
        file === runtime ||
        file.includes("/node_modules/") ||
        file.includes("/common/sqlite/") ||
        file.includes("/heal-native") ||
        file.endsWith("/heal-entry.ts")
      )
        return;
      if (
        !file.includes("/apps/web/src/") &&
        !file.includes("/packages/editor/") &&
        !file.includes("/packages/theme/") &&
        !file.includes("/packages/ui/")
      )
        return;
      const names = [
        "window",
        "document",
        "localStorage",
        "indexedDB",
        "dispatchEvent",
        "history",
        "hasNativeTitlebar"
      ].filter((name) => new RegExp("\\b" + name + "\\b").test(code));
      if (!names.length) return;
      const aliases: Record<string, string> = {
        window: "notesWindow",
        document: "notesDocument",
        localStorage: "notesLocalStorage",
        indexedDB: "notesIndexedDB",
        dispatchEvent: "notesDispatchEvent",
        history: "notesHistory",
        hasNativeTitlebar: "notesHasNativeTitlebar"
      };
      return {
        code:
          `import {${names.map((n) => aliases[n] + " as " + n).join(",")}} from ${JSON.stringify(runtime)};\n` +
          code,
        map: null
      };
    }
  };
}
