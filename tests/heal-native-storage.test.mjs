import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url)
);
const { build } = require("esbuild");
test("native adapters retain legacy account names and never replace host storage or routing", async () => {
  const map = new Map([
    ["host-setting", "keep"],
    ["heal-notes-a-colorScheme", '"dark"'],
    ["heal-notes-b-secret", "other"]
  ]);
  const storage = {
    get length() {
      return map.size;
    },
    key: (i) => Array.from(map.keys())[i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
  const opened = [];
  const factory = {
    open: (name, version) => {
      opened.push([name, version]);
      return {};
    },
    deleteDatabase: (name) => opened.push(["delete", name])
  };
  const realWindow = {
    localStorage: storage,
    indexedDB: factory,
    location: {
      origin: "https://healearth.club",
      href: "https://healearth.club/notes"
    },
    history: {}
  };
  const surface = {},
    shadow = {
      getElementById: (id) => ({ id }),
      querySelector: (selector) => ({ selector }),
      querySelectorAll: () => []
    };
  const context = {
    window: realWindow,
    document: { body: { host: true } },
    EventTarget,
    URL,
    console,
    module: { exports: {} },
    exports: {}
  };
  context.globalThis = context;
  const { outputFiles } = await build({
    entryPoints: [
      new URL("../apps/web/src/heal-native-runtime.ts", import.meta.url)
        .pathname
    ],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node"
  });
  vm.runInNewContext(outputFiles[0].text, context);
  const api = context.module.exports;
  api.configureNativeContext({
    namespace: "heal-notes-a-",
    surface,
    shadow,
    active: true
  });
  assert.equal(api.notesLocalStorage.getItem("colorScheme"), '"dark"');
  api.notesLocalStorage.setItem("editorConfig", "saved");
  assert.equal(storage.getItem("heal-notes-a-editorConfig"), "saved");
  api.notesIndexedDB.open("NNKeyStore-secrets", 1);
  assert.deepEqual(opened, [["heal-notes-a-NNKeyStore-secrets", 1]]);
  assert.equal("indexedDB" in api.notesWindow, true);
  assert.equal(api.notesDocument.body, surface);
  assert.equal(api.notesDocument.getElementById("root").id, "root");
  api.notesWindow.history.pushState(
    null,
    "",
    "/notes-engine/index.html?route=/notebooks/test"
  );
  assert.equal(api.notesWindow.location.search, "?route=/notebooks/test");
  assert.equal(realWindow.location.href, "https://healearth.club/notes");
  assert.equal(realWindow.localStorage, storage);
  assert.equal(realWindow.indexedDB, factory);
  api.notesLocalStorage.clear();
  assert.equal(storage.getItem("host-setting"), "keep");
  assert.equal(storage.getItem("heal-notes-b-secret"), "other");
});
