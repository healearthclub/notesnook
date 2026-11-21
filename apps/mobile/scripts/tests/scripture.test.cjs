const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../../../..");
const local = createRequire(path.join(root, "apps/mobile/package.json"));
const ts = createRequire(path.join(root, "package.json"))("typescript");
const React = local("react");
const Renderer = local("react-test-renderer");
global.IS_REACT_ACT_ENVIRONMENT = true;
function compile(file, mocks) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true
    }
  }).outputText;
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + js + "})", {
    filename: file
  })(
    (id) => {
      if (id in mocks) return mocks[id];
      if (id.startsWith(".")) {
        const relative = path.join(path.dirname(file), id);
        for (const extension of ["", ".ts", ".tsx"]) {
          if (fs.existsSync(path.join(root, relative + extension)))
            return compile(relative + extension, mocks);
        }
      }
      return local(id);
    },
    mod,
    mod.exports
  );
  return mod.exports;
}
function fixture() {
  const state = { userId: "google:a", opened: [], closed: 0, paused: 0, phase: "playing", listener: null };
  const account = () => {};
  account.getState = () => state;
  account.subscribe = (listener) => { state.listener = listener; return () => { state.listener = null; }; };
  const native = { NativeModules: { OhaiMusicPlayer: { setPaused: () => state.paused++ }, OhaiScripture: { open: async (scope) => state.opened.push(scope), close: async () => { state.closed++; } } }, Platform: { OS: "ios" }, Pressable: "Pressable", Text: "Text", View: "View", StyleSheet: { create: v => v, hairlineWidth: 1 } };
  const component = compile("apps/mobile/app/features/scripture/scripture-card.tsx", {
    "react-native": native,
    "@notesnook/theme": { useThemeColors: () => ({ colors: { primary: {}, secondary: {} } }) },
    "../../components/ui/AppIcon": () => React.createElement("Icon"),
    "../login/google-session": { useOhaiAccount: account },
    "../notes/music-player": { pauseLocalMusicForTransfer: () => state.paused++, useMusicPlayback: { getState: () => ({ current: { phase: state.phase } }) } }
  });
  return { state, Card: component.ScriptureCard };
}
test("Scripture opens the current account and pauses active music without replacing the queue", async () => {
  const { state, Card } = fixture();
  let view;
  await Renderer.act(async () => { view = Renderer.create(React.createElement(Card)); });
  await Renderer.act(async () => { await view.root.findByProps({ testID: "open-scripture" }).props.onPress(); });
  assert.deepEqual(state.opened, ["google:a"]);
  assert.equal(state.paused, 1);
  state.listener({ userId: "google:b" }, { userId: "google:a" });
  assert.equal(state.closed, 1);
  await Renderer.act(async () => { view.unmount(); });
  assert.equal(state.listener, null);
});
test("guest reading stays available and paused music stays paused", async () => {
  const { state, Card } = fixture(); state.userId = null; state.phase = "paused";
  let view;
  await Renderer.act(async () => { view = Renderer.create(React.createElement(Card)); });
  await Renderer.act(async () => { await view.root.findByProps({ testID: "open-scripture" }).props.onPress(); });
  assert.deepEqual(state.opened, ["guest"]);
  assert.equal(state.paused, 0);
  await Renderer.act(async () => { view.unmount(); });
});
