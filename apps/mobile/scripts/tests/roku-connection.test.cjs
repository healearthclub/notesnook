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

const { createStore } = local("zustand/vanilla");
const model = compile(
  "apps/mobile/app/features/playback/connection-model.ts",
  {}
);
const intent = {
  contentId: "song",
  kind: "music",
  position: 12,
  paused: false,
  queue: [{ entryId: "entry-1", contentId: "song" }],
  queueIndex: 0,
  repeat: "all"
};
const snapshot = {
  contentId: "song",
  kind: "music",
  generation: "gen-1",
  phase: "playing",
  position: 12,
  duration: 180,
  seekable: true,
  queueIndex: 0,
  queueRevision: 1,
  repeat: "all",
  lastAppliedCommandId: "",
  error: ""
};
const connection = {
  sessionId: "session-1",
  receiverId: "tv-1",
  receiverEpoch: "epoch-1",
  revision: 3,
  fence: "fence-1",
  phase: "active",
  online: true,
  intent,
  snapshot,
  receivedAt: 1
};
const receiver = {
  id: "tv-1",
  name: "Living Room",
  epoch: "epoch-1",
  online: true,
  enabled: true,
  protocol: 1,
  capabilities: { music: true, videos: true, silentPrepare: true }
};
test("connection contracts distinguish offline devices, paged queues and corrupt snapshots", () => {
  assert.equal(model.eligible(receiver, "music"), true);
  assert.equal(model.eligible({ ...receiver, online: false }, "music"), false);
  assert.equal(
    model.eligible(
      {
        ...receiver,
        capabilities: { ...receiver.capabilities, silentPrepare: false }
      },
      "music"
    ),
    false
  );
  assert.equal(model.readConnection(connection).snapshot.position, 12);
  assert.throws(() =>
    model.readConnection({
      ...connection,
      snapshot: { ...snapshot, position: NaN }
    })
  );
  assert.notEqual(
    model.playbackStorageKey("account-a"),
    model.playbackStorageKey("account-b")
  );
  const paged = {
    ...intent,
    queueId: "queue-137",
    queueOffset: 100,
    queueTotal: 137,
    queueIndex: 120,
    queue: Array.from({ length: 37 }, (_, i) => ({
      entryId: "entry-" + i,
      contentId: "song"
    }))
  };
  assert.equal(
    model.readConnection({
      ...connection,
      intent: paged,
      snapshot: { ...snapshot, queueIndex: 120 }
    }).intent.queueTotal,
    137
  );
});
test("library video RPC is origin-bound, correlated and canceled when its window closes", async () => {
  const video = compile(
    "apps/mobile/app/features/playback/library-video.ts",
    {}
  );
  assert.equal(
    video.libraryVideoId("https://healearth.club/pin/private-video"),
    "private-video"
  );
  assert.equal(
    video.libraryVideoId("https://healearth.club.evil/pin/private-video"),
    undefined
  );
  let address = "https://healearth.club/pin/private-video",
    script;
  const rpc = video.videoRPC(
    (value) => (script = value),
    () => address
  );
  const promise = rpc.call("snapshot");
  const request = JSON.parse(/var r=(.*?);var v=/.exec(script)[1]);
  rpc.receive(
    JSON.stringify({
      ohaiLibraryVideo: request.nonce,
      position: 4,
      duration: 30,
      paused: false,
      ready: true
    }),
    address
  );
  assert.equal((await promise).position, 4);
  const changed = rpc.call("pause");
  const request2 = JSON.parse(/var r=(.*?);var v=/.exec(script)[1]);
  address = "https://healearth.club/pin/another";
  rpc.receive(
    JSON.stringify({
      ohaiLibraryVideo: request2.nonce,
      position: 4,
      duration: 30,
      paused: true,
      ready: true
    }),
    address
  );
  await assert.rejects(changed, /page changed/);
  const closing = rpc.call("snapshot");
  rpc.dispose();
  await assert.rejects(closing, /window closed/);
});
function coordinatorFixture(mode = "ok") {
  const log = [],
    cache = new Map();
  const account = createStore(() => ({ userId: "google:a" }));
  const track = {
    id: "song",
    title: "Song",
    artist: "Artist",
    playback: "account"
  };
  const music = createStore(() => ({
    current: { track, requestId: 7, phase: "playing" },
    queue: [track],
    loop: true
  }));
  let state = structuredClone(connection),
    lastCommand,
    localRequestId = 7,
    enabled = true,
    expired = false,
    appChange;
  const api = async (owner, path, data) => {
    assert.equal(owner, "google:a");
    if (path === "sessions") {
      state = {
        ...state,
        phase: "consent",
        sessionId: data.sessionId,
        intent: data.intent
      };
      log.push("intent");
      if (mode === "inactive-consent") {
        mocks["react-native"].AppState.currentState = "inactive";
        setTimeout(() => { mocks["react-native"].AppState.currentState = "active"; }, 50);
      }
      return structuredClone(state);
    }
    if (path.endsWith("/commands")) {
      log.push(data.action);
      if (mode === "lost-commit" && data.action === "commit")
        throw new Error("Network response lost");
      lastCommand = data.commandId;
      state = {
        ...state,
        phase: "active",
        snapshot: {
          ...snapshot,
          lastAppliedCommandId: lastCommand,
          phase:
            data.action === "setPaused"
              ? "paused"
              : data.action === "cancel"
                ? "idle"
                : "playing",
          position: 25
        }
      };
      if (data.action === "cancel") state.phase = "closed";
      return { status: "pending", state: structuredClone(state) };
    }
    if (path.includes("/commands/")) {
      log.push("acknowledged");
      return { status: "applied", state: structuredClone(state) };
    }
    if (path.includes("/queue/"))
      return { entries: intent.queue, offset: 0, total: 1 };
    if (path.startsWith("sessions/")) {
      if (expired) throw Object.assign(new Error("TV session ended."), { status: 410 });
      if (state.phase === "consent")
        state = {
          ...state,
          phase: "ready",
          snapshot: { ...snapshot, phase: "ready" }
        };
      return structuredClone(state);
    }
    if (path === "receivers") {
      log.push("receivers");
      return { enabled, receivers: enabled ? [receiver] : [] };
    }
    throw new Error(path);
  };
  const mocks = {
    "react-native": {
      AppState: {
        currentState: "active",
        addEventListener: (_event, listener) => {
          appChange = listener;
          return { remove() {} };
        }
      }
    },
    zustand: { create: (fn) => createStore(fn) },
    "../../common/database/mmkv": {
      MMKV: {
        setString: (k, v) => cache.set(k, v),
        getString: (k) => cache.get(k)
      }
    },
    "../login/google-session": {
      useOhaiAccount: account,
      requestOhaiPlayback: api,
      fetchOhaiMusic: async () => [track]
    },
    "../notes/music-player": {
      useMusicPlayback: music,
      localMusicSnapshot: async () => ({
        position: 12,
        duration: 180,
        ready: true,
        paused: false,
        requestId: localRequestId
      }),
      pauseLocalMusicForTransfer: () => log.push("pause-local"),
      releaseLocalMusicOutput: () => log.push("release-local"),
      prepareLocalMusic: async () => {
        log.push("prepare-local");
        localRequestId = 8;
        return 8;
      },
      resumeLocalMusicAt: async (position, paused) =>
        log.push(["resume-local", position, paused]),
      stopLocalMusic: () => log.push("stop-local")
    },
    "./remote-controls": { installRemoteMusicHandler: () => () => {} },
    "./connection-model": model,
    "./library-video": { findLibraryVideo: () => undefined }
  };
  const module = compile(
    "apps/mobile/app/features/playback/connection.ts",
    mocks
  );
  return { module, log, cache, music, account, expireSession: () => { expired = true; }, setEnabled: value => { enabled = value; }, appChange: phase => appChange(phase) };
}
test("foregrounding discovers newly enabled Roku support without opening a receiver sheet or interrupting local playback", async () => {
  const f = coordinatorFixture();
  f.setEnabled(false);
  const stop = f.module.listenForRokuConnection();
  try {
    await new Promise(setImmediate);
    assert.equal(f.module.useRokuConnection.getState().enabled, false);
    const count = f.log.filter(x => x === "receivers").length;
    f.setEnabled(true);
    f.appChange("background");
    await new Promise(setImmediate);
    assert.equal(f.log.filter(x => x === "receivers").length, count);
    f.appChange("active");
    await new Promise(setImmediate);
    assert.equal(f.module.useRokuConnection.getState().enabled, true);
    assert.equal(f.log.filter(x => x === "receivers").length, count + 1);
    assert.equal(f.log.includes("pause-local"), false);
    assert.equal(f.log.includes("intent"), false);
  } finally { stop(); }
});
test("phone pauses only after TV readiness, releases output after acknowledgement and returns at the confirmed position", async () => {
  const f = coordinatorFixture();
  await f.module.connectRoku(receiver);
  assert.equal(f.module.useRokuConnection.getState().stage, "active");
  assert.ok(f.log.indexOf("pause-local") > f.log.indexOf("intent"));
  assert.ok(f.log.indexOf("commit") > f.log.indexOf("pause-local"));
  assert.ok(f.log.indexOf("release-local") > f.log.indexOf("acknowledged"));
  await f.module.returnToIPhone();
  assert.equal(f.module.useRokuConnection.getState().stage, "idle");
  assert.deepEqual(
    f.log.find((v) => Array.isArray(v) && v[0] === "resume-local"),
    ["resume-local", 25, false]
  );
});
test("temporary iOS inactivity during consent does not abort or commit until foreground returns", async () => {
  const f = coordinatorFixture("inactive-consent");
  await f.module.connectRoku(receiver);
  assert.equal(f.module.useRokuConnection.getState().stage, "active");
  assert.equal(f.module.useRokuConnection.getState().error, undefined);
  assert.ok(f.log.indexOf("pause-local") > f.log.indexOf("intent"));
  assert.ok(f.log.indexOf("commit") > f.log.indexOf("pause-local"));
});
test("a definitively ended TV session releases routing and preserves a paused local track without auto-playing", async () => {
  const f = coordinatorFixture();
  await f.module.connectRoku(receiver);
  assert.equal(f.module.remotePlaybackHeld(), true);
  f.expireSession();
  await f.module.refreshRokuConnection();
  const state = f.module.useRokuConnection.getState();
  assert.equal(state.connection, undefined);
  assert.equal(state.localSuspended, false);
  assert.equal(state.busy, false);
  assert.equal(state.error, undefined);
  assert.equal(f.module.remotePlaybackHeld(), false);
  assert.equal(f.music.getState().current.phase, "paused");
  assert.ok([...f.cache.values()].some(value => value === "null"));
  assert.equal(f.log.some(value => Array.isArray(value) && value[0] === "resume-local"), false);
});
test("a lost commit acknowledgement keeps the phone paused and never silently resumes or discards its persisted session", async () => {
  const f = coordinatorFixture("lost-commit");
  await f.module.connectRoku(receiver);
  assert.equal(f.module.useRokuConnection.getState().stage, "unknown");
  assert.equal(f.module.remotePlaybackHeld(), true);
  assert.equal(f.log.filter((v) => v === "commit").length, 2);
  assert.equal(f.log.includes("release-local"), false);
  assert.ok([...f.cache.values()].some((value) => value.includes("sessionId")));
  assert.equal(
    f.log.some((v) => Array.isArray(v) && v[0] === "resume-local"),
    false
  );
});
function rowFixture(overrides = {}) {
  const log = [];
  const state = {
    enabled: true,
    receivers: [
      receiver,
      { ...receiver, id: "tv-offline", name: "Bedroom", online: false }
    ],
    name: "Living Room",
    stage: "idle",
    busy: false,
    ...overrides
  };
  const component = compile(
    "apps/mobile/app/features/playback/roku-device-rows.tsx",
    {
      "react-native": {
        ActivityIndicator: "Spinner",
        Pressable: "Pressable",
        Text: "Text",
        View: "View",
        Alert: { alert: (...args) => log.push(["alert", ...args]) }
      },
      "@notesnook/theme": {
        useThemeColors: () => ({
          colors: {
            primary: { heading: "#111", accent: "#080", icon: "#333" },
            secondary: { paragraph: "#666" }
          }
        })
      },
      "../../components/ui/AppIcon": (props) =>
        React.createElement("Icon", props),
      "../login/google-session": {
        useOhaiAccount: (selector) => selector({ userId: "google:a" })
      },
      "./connection-model": model,
      "./connection": {
        useRokuConnection: () => state,
        observeRokuPicker: () => () => log.push("closed-picker"),
        refreshRokuConnection: async () => log.push("refresh"),
        connectRoku: async (r) => log.push(["connect", r.id]),
        cancelRokuConnection: async () => log.push("cancel"),
        detachRokuController: async () => log.push("detach"),
        returnToIPhone: async (force) => log.push(["return", force]),
        rokuAction: async (action) => log.push(action)
      }
    }
  );
  return { Rows: component.RokuDeviceRows, log, state };
}
test("device rows select only available receivers and closing the sheet does not stop TV playback", async () => {
  const f = rowFixture();
  let view;
  await Renderer.act(async () => {
    view = Renderer.create(React.createElement(f.Rows, { kind: "music" }));
  });
  const room = view.root.findByProps({
    accessibilityLabel: "Living Room. Ready to connect"
  });
  assert.equal(room.props.disabled, false);
  assert.equal(view.root.findAllByProps({
    accessibilityLabel: "Bedroom. Open the app on your TV"
  }).length, 0);
  await Renderer.act(async () => room.props.onPress());
  assert.deepEqual(
    f.log.find((v) => Array.isArray(v) && v[0] === "connect"),
    ["connect", "tv-1"]
  );
  await Renderer.act(async () => view.unmount());
  assert.ok(f.log.includes("closed-picker"));
  assert.equal(f.log.includes("stop"), false);
});
test("stale sign-in rows show an honest empty state while different online TVs remain selectable", async () => {
  const f = rowFixture({ receivers: [
    { ...receiver, id: "old-1", online: false },
    { ...receiver, id: "old-2", enabled: false }
  ] });
  let view;
  await Renderer.act(async () => { view = Renderer.create(React.createElement(f.Rows, { kind: "music" })); });
  assert.ok(view.root.findByProps({ children: "No Roku is available yet. Open Heal Earth Club on your TV, sign in to the same account, and enable phone control in Account." }));
  assert.equal(view.root.findAllByType("Pressable").length, 1); // Refresh only.
  await Renderer.act(async () => view.unmount());
  const live = rowFixture({ receivers: [receiver, { ...receiver, id: "tv-2" }] });
  await Renderer.act(async () => { view = Renderer.create(React.createElement(live.Rows, { kind: "music" })); });
  const rows = view.root.findAllByType("Pressable").filter(x => /Ready to connect/.test(x.props.accessibilityLabel || ""));
  assert.equal(rows.length, 2);
  await Renderer.act(async () => rows[1].props.onPress());
  assert.ok(live.log.some(x => Array.isArray(x) && x[0] === "connect" && x[1] === "tv-2"));
  await Renderer.act(async () => view.unmount());
});
test("uncertain outcomes require explicit confirmation before playing locally and cancellation stays available during TV consent", async () => {
  const pending = rowFixture({
    connection: { ...connection, phase: "consent" },
    stage: "consent",
    busy: true
  });
  let a;
  await Renderer.act(async () => {
    a = Renderer.create(React.createElement(pending.Rows, { kind: "music" }));
  });
  const cancelText = a.root.findByProps({ children: "Cancel connection" });
  const cancel = cancelText.parent;
  assert.equal(cancel.props.disabled, false);
  await Renderer.act(async () => cancel.props.onPress());
  assert.ok(pending.log.includes("cancel"));
  await Renderer.act(async () => a.unmount());
  const f = rowFixture({ connection, stage: "unknown" });
  let b;
  await Renderer.act(async () => {
    b = Renderer.create(React.createElement(f.Rows, { kind: "music" }));
  });
  const forceText = b.root.findByProps({
    children: "TV unreachable? Play here anyway…"
  });
  await Renderer.act(async () => forceText.parent.props.onPress());
  assert.equal(
    f.log.some((v) => Array.isArray(v) && v[0] === "return"),
    false
  );
  const alert = f.log.find((v) => Array.isArray(v) && v[0] === "alert");
  assert.match(alert[2], /TV may still be playing/);
  await Renderer.act(async () => alert[3][1].onPress());
  assert.deepEqual(
    f.log.find((v) => Array.isArray(v) && v[0] === "return"),
    ["return", true]
  );
  await Renderer.act(async () => b.unmount());
});

test("canceling before handoff does not stop the phone's current music", async () => {
  const f = coordinatorFixture();
  f.module.useRokuConnection.setState({
    connection: { ...connection, phase: "consent" },
    stage: "consent",
    localSuspended: false,
    busy: true
  });
  await f.module.cancelRokuConnection();
  assert.equal(f.module.useRokuConnection.getState().stage, "idle");
  assert.equal(f.log.includes("stop-local"), false);
  assert.equal(f.log.includes("release-local"), false);
});
function nativeSessionFixture() {
  const state = {
    session: {
      userId: "google:a",
      email: "a@example.com",
      expiresAt: Date.now() + 3600000,
      token: "a".repeat(43)
    }
  };
  const api = compile("apps/mobile/app/features/login/google-session.ts", {
    "react-native": { Platform: { OS: "ios" }, NativeModules: {} },
    "react-native-keychain": {
      ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: "unlocked" },
      getGenericPassword: async () => ({
        password: JSON.stringify(state.session)
      }),
      resetGenericPassword: async () => true
    },
    zustand: { create: (fn) => createStore(fn) }
  });
  api.useOhaiAccount.setState({ userId: "google:a", email: "a@example.com" });
  return { api, state };
}
test("native playback requests use only the fixed first-party origin and keep credentials out of TV command bodies", async () => {
  const { api } = nativeSessionFixture(),
    previous = global.fetch;
  let calls = 0;
  global.fetch = async (url, init) => {
    calls++;
    assert.equal(
      url,
      "https://healearth.club/ohai/auth/native/playback/sessions/session-1/commands"
    );
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, "Bearer " + "a".repeat(43));
    assert.equal(init.body.includes("a".repeat(43)), false);
    return Response.json({ status: "pending" });
  };
  try {
    await api.requestOhaiPlayback("google:a", "sessions/session-1/commands", {
      commandId: "one",
      action: "stop",
      payload: {}
    });
    await assert.rejects(
      api.requestOhaiPlayback("google:a", "https://evil.example/")
    );
    assert.equal(calls, 1);
  } finally {
    global.fetch = previous;
  }
});
test("a playback response cannot update a newly selected account", async () => {
  const { api, state } = nativeSessionFixture(),
    previous = global.fetch;
  global.fetch = async () => {
    state.session = {
      ...state.session,
      userId: "google:b",
      token: "b".repeat(43)
    };
    api.useOhaiAccount.setState({ userId: "google:b" });
    return Response.json({ enabled: true, receivers: [receiver] });
  };
  try {
    await assert.rejects(
      api.requestOhaiPlayback("google:a", "receivers"),
      /account changed/
    );
  } finally {
    global.fetch = previous;
  }
});


test("local playback opens the native AirPlay picker directly; active Roku retains explicit handoff controls", async () => {
  const remote = { enabled: false, connection: undefined };
  const output = { id: "tv-airplay", name: '55 inch TCL Roku TV', kind: "airplay" };
  const colors = { primary: { accent: "green", icon: "white", heading: "white" }, secondary: { paragraph: "gray" } };
  const module = compile("apps/mobile/app/features/playback/play-on-device.tsx", {
    "react-native": { Platform: { OS: "ios" }, View: "View", Text: "Text", Pressable: "Pressable", Modal: "Modal", ScrollView: "ScrollView", Keyboard: { dismiss() {} }, StyleSheet: { create: x => x }, requireNativeComponent: () => "NativeRoutePicker" },
    "@notesnook/theme": { useThemeColors: () => ({ colors }) },
    "../../components/bottom-sheet": { BottomSheet: "BottomSheet" },
    "../../components/ui/AppIcon": { __esModule: true, default: "AppIcon" },
    "../notes/music-player": { useMusicPlayback: () => undefined },
    "./roku-device-rows": { RokuDeviceRows: "RokuDeviceRows" },
    "./connection": { useRokuConnection: () => remote },
    "./audio-output": { useAudioOutput: select => select({ outputs: [output] }), audioOutputName: list => list.map(p => p.name).join(", ") }
  });
  let view;
  await Renderer.act(async () => { view = Renderer.create(React.createElement(module.PlayOnDeviceButton, { title: "Song", kind: "music", compact: true })); });
  let picker = view.root.findByType("NativeRoutePicker");
  assert.equal(picker.props.prioritizesVideoDevices, false);
  assert.match(picker.props.accessibilityLabel, /55 inch TCL Roku TV/);
  assert.equal(view.root.findAllByType("Pressable").length, 0);
  await Renderer.act(async () => { view.update(React.createElement(module.PlayOnDeviceButton, { title: "Video", kind: "video", compact: true })); });
  picker = view.root.findByType("NativeRoutePicker");
  assert.equal(picker.props.prioritizesVideoDevices, true);
  remote.connection = connection;
  await Renderer.act(async () => { view.update(React.createElement(module.PlayOnDeviceButton, { title: "Song", kind: "music", compact: true })); });
  assert.equal(view.root.findAllByType("NativeRoutePicker").length, 0);
  assert.equal(view.root.findAllByType("Pressable").length, 1);
  await Renderer.act(async () => view.unmount());
});

test("disabled receiver service does not show a misleading Roku coming-soon destination", async () => {
  const f = rowFixture({ enabled: false, connection: undefined });
  let view;
  await Renderer.act(async () => { view = Renderer.create(React.createElement(f.Rows, { kind: "music" })); });
  assert.equal(view.toJSON(), null);
  await Renderer.act(async () => view.unmount());
});
