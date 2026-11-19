const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../../../..");
const localRequire = createRequire(path.join(root, "package.json"));
const ts = localRequire("typescript");
const { createStore } = createRequire(
  path.join(root, "apps/mobile/package.json")
)("zustand/vanilla");
const iphone = { id: "speaker", name: "This iPhone", kind: "iphone" };
const bluetooth = { id: "bt-1", name: "JBL Flip 6", kind: "bluetooth" };
const tick = () => new Promise(setImmediate);

function setup() {
  let resolveSnapshot;
  let changed;
  let removed = false;
  const snapshot = new Promise((resolve) => {
    resolveSnapshot = resolve;
  });
  const native = { currentOutput: () => snapshot };
  const mocks = {
    "react-native": {
      NativeModules: { OhaiAudioRoutes: native },
      NativeEventEmitter: class {
        addListener(name, fn) {
          assert.equal(name, "OhaiAudioOutputChanged");
          changed = fn;
          return {
            remove: () => {
              removed = true;
            }
          };
        }
      }
    },
    zustand: { create: (fn) => createStore(fn) }
  };
  const source = fs.readFileSync(
    path.join(root, "apps/mobile/app/features/playback/audio-output.ts"),
    "utf8"
  );
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext("(function(require,module,exports){" + js + "})", {})(
    (id) => {
      if (!mocks[id]) throw new Error(id);
      return mocks[id];
    },
    mod,
    mod.exports
  );
  return {
    api: mod.exports,
    resolveSnapshot,
    emit: (value) => changed(value),
    removed: () => removed
  };
}

test("audio outputs reject malformed bridge payloads and preserve real device names", () => {
  const { api } = setup();
  for (const invalid of [
    null,
    {},
    { outputs: null },
    { outputs: [null] },
    { outputs: [{ ...bluetooth, kind: "roku" }] },
    { outputs: [{ ...iphone, name: "" }] },
    { outputs: Array(17).fill(iphone) }
  ]) {
    assert.equal(api.readAudioOutputs(invalid), undefined);
  }
  assert.equal(
    api.audioOutputName(api.readAudioOutputs({ outputs: [bluetooth] })),
    "JBL Flip 6"
  );
  assert.equal(api.audioOutputName([]), "System output");
});

test("route changes win over a stale initial query and disconnect falls back to iPhone", async () => {
  const s = setup();
  const dispose = s.api.listenForAudioOutput();
  s.emit({ outputs: [bluetooth] });
  s.resolveSnapshot({ outputs: [iphone] });
  await tick();
  assert.equal(s.api.useAudioOutput.getState().outputs[0].id, bluetooth.id);
  s.emit({ outputs: [iphone] });
  assert.equal(s.api.useAudioOutput.getState().outputs[0].name, "This iPhone");
  s.emit({ outputs: [{ name: "bad", kind: "unknown" }] });
  assert.equal(s.api.useAudioOutput.getState().outputs[0].id, iphone.id);
  dispose();
  assert.equal(s.removed(), true);
});

test("an unmounted listener cannot publish a delayed snapshot or event", async () => {
  const s = setup();
  const dispose = s.api.listenForAudioOutput();
  dispose();
  s.resolveSnapshot({ outputs: [bluetooth] });
  s.emit({ outputs: [bluetooth] });
  await tick();
  assert.equal(s.api.useAudioOutput.getState().outputs.length, 0);
});
