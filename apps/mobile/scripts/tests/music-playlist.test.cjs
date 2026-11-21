const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../../../..");
const localRequire = createRequire(path.join(root, "package.json"));
const ts = localRequire("typescript");
const { createStore } = createRequire(
  path.join(root, "apps/mobile/package.json")
)("zustand/vanilla");
const folder = path.join(root, "apps/mobile/app/features/notes");
const tick = () => new Promise(setImmediate);
const track = (id) => ({
  id,
  title: id,
  artist: "Test",
  playback: "https://example.com/" + id + ".mp3"
});
function setup() {
  const account = createStore(() => ({ userId: "owner" }));
  const starts = [],
    pauses = [],
    metadata = [];
  const listeners = new Map();
  let source = async (_, t) => ({ url: t.playback, token: "" });
  const native = {
    start: async (...args) => starts.push(args),
    setMetadata: (...args) => metadata.push(args),
    stop: () => {},
    setPaused: (...args) => pauses.push(args)
  };
  const mocks = {
    "../playback/remote-controls": { routeRemoteMusicAction: () => false, isRemoteMusicHeld: () => false },
    "react-native": {
      NativeModules: { OhaiMusicPlayer: native },
      NativeEventEmitter: class {
        addListener(name, fn) {
          listeners.set(name, fn);
          return { remove: () => listeners.delete(name) };
        }
      }
    },
    zustand: { create: (fn) => createStore(fn) },
    "../login/google-session": {
      useOhaiAccount: account,
      clearMusicPlaybackSession: () => {},
      getMusicPlaybackSource: (...args) => source(...args)
    }
  };
  function load(name) {
    const js = ts.transpileModule(
      fs.readFileSync(path.join(folder, name + ".ts"), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020
        }
      }
    ).outputText;
    const mod = { exports: {} };
    vm.runInNewContext("(function(require,module,exports){" + js + "})", {})(
      (id) => {
        if (id === "./music-queue") return load("music-queue");
        if (!mocks[id]) throw new Error(id);
        return mocks[id];
      },
      mod,
      mod.exports
    );
    return mod.exports;
  }
  const player = load("music-player");
  player.listenForMusicPlayback();
  return {
    player,
    account,
    starts,
    pauses,
    metadata,
    command: (
      command,
      requestId = player.useMusicPlayback.getState().current.requestId
    ) => listeners.get("OhaiMusicCommand")({ command, requestId }),
    current: () => player.useMusicPlayback.getState().current,
    event: (state, id = player.useMusicPlayback.getState().current.requestId) =>
      listeners.get("OhaiMusicState")({ state, requestId: id }),
    source: (fn) => (source = fn)
  };
}
test("queue uses displayed order, excludes non-playable items, and deduplicates IDs", async () => {
  const s = setup(),
    a = track("a"),
    b = track("b");
  await s.player.playMusic(b, [a, { id: "image" }, b, a]);
  assert.deepEqual(
    Array.from(s.player.useMusicPlayback.getState().queue, (t) => t.id),
    ["a", "b"]
  );
  s.event("ended");
  await tick();
  assert.equal(s.current().track.id, "a");
});
test("finishing a middle track advances once and ignores duplicate or stale events", async () => {
  const s = setup(),
    a = track("a"),
    b = track("b"),
    c = track("c");
  await s.player.playMusic(a, [a, b, c]);
  const old = s.current().requestId;
  s.event("ended", old);
  s.event("ended", old);
  await tick();
  assert.equal(s.current().track.id, "b");
  assert.equal(s.starts.length, 2);
  s.event("failed", old);
  assert.equal(s.current().phase, "loading");
});
test("single-song playlist restarts with a new native request on completion", async () => {
  const s = setup(),
    a = track("a");
  await s.player.playMusic(a, [a]);
  const old = s.current().requestId;
  s.event("ended");
  await tick();
  assert.equal(s.starts.length, 2);
  assert.notEqual(s.current().requestId, old);
  assert.equal(s.current().track.id, "a");
});
test("turning loop off still advances and stops at the end", async () => {
  const s = setup(),
    a = track("a"),
    b = track("b");
  s.player.togglePlaylistLoop();
  await s.player.playMusic(a, [a, b]);
  s.event("ended");
  await tick();
  assert.equal(s.current().track.id, "b");
  s.event("ended");
  await tick();
  assert.equal(s.current().phase, "ended");
  assert.equal(s.starts.length, 2);
});
test("previous and next follow playlist order and wrap", async () => {
  const s = setup(),
    a = track("a"),
    b = track("b");
  await s.player.playMusic(a, [a, b]);
  await s.player.advanceMusic(-1);
  assert.equal(s.current().track.id, "b");
  await s.player.advanceMusic();
  assert.equal(s.current().track.id, "a");
});
test("retry keeps the queue and a failed stream does not automatically loop", async () => {
  const s = setup(),
    a = track("a"),
    b = track("b");
  await s.player.playMusic(a, [a, b]);
  s.event("failed");
  await tick();
  assert.equal(s.starts.length, 1);
  s.player.toggleMusic();
  await tick();
  assert.equal(s.starts.length, 2);
  assert.equal(s.player.useMusicPlayback.getState().queue.length, 2);
});
test("dismissal cancels a pending source and clears the playlist", async () => {
  const s = setup(),
    a = track("a");
  let resolve;
  s.source(() => new Promise((r) => (resolve = r)));
  const pending = s.player.playMusic(a, [a]);
  s.player.stopMusic();
  resolve({ url: a.playback, token: "" });
  await pending;
  assert.equal(s.current(), undefined);
  assert.equal(s.starts.length, 0);
  assert.equal(s.player.useMusicPlayback.getState().queue.length, 0);
});
test("changing account cancels pending playback and clears the queue", async () => {
  const s = setup(),
    a = track("a");
  let resolve;
  s.source(() => new Promise((r) => (resolve = r)));
  const pending = s.player.playMusic(a, [a]);
  s.account.setState({ userId: "other" });
  resolve({ url: a.playback, token: "" });
  await pending;
  assert.equal(s.current(), undefined);
  assert.equal(s.starts.length, 0);
});
test("rapid skip starts only the newest requested song", async () => {
  const s = setup(),
    a = track("a"),
    b = track("b"),
    c = track("c");
  await s.player.playMusic(a, [a, b, c]);
  const pendingSources = [];
  s.source(
    (_, t) =>
      new Promise((r) =>
        pendingSources.push(() => r({ url: t.playback, token: "" }))
      )
  );
  const first = s.player.advanceMusic(),
    second = s.player.advanceMusic();
  pendingSources[1]();
  await second;
  pendingSources[0]();
  await first;
  assert.equal(s.current().track.id, "c");
  assert.deepEqual(
    s.starts.map((args) => args[0]),
    [a.playback, c.playback]
  );
});

test("Now Playing metadata follows each selected track and queue position", async () => {
  const s = setup(),
    a = track("a"),
    b = track("b");
  a.artist = "Artist";
  a.artworkSource = { uri: "https://example.com/cover.jpg" };
  await s.player.playMusic(a, [a, b]);
  assert.equal(s.metadata[0][0].title, "a");
  assert.equal(s.metadata[0][0].artist, "Artist");
  assert.equal(s.metadata[0][0].artworkURI, a.artworkSource.uri);
  assert.equal(s.metadata[0][0].queueCount, 2);
  assert.equal(s.metadata[0][0].queueIndex, 0);
  await s.player.advanceMusic();
  assert.equal(s.metadata[1][0].title, "b");
  assert.equal(s.metadata[1][0].queueIndex, 1);
  assert.equal(s.metadata[1][1], s.current().requestId);
});
test("Lock Screen next and previous use the current playlist", async () => {
  const s = setup(),
    a = track("a"),
    b = track("b");
  await s.player.playMusic(a, [a, b]);
  s.command("next");
  await tick();
  assert.equal(s.current().track.id, "b");
  s.command("previous");
  await tick();
  assert.equal(s.current().track.id, "a");
});
test("remote commands for dismissed or replaced tracks are ignored", async () => {
  const s = setup(),
    a = track("a"),
    b = track("b");
  await s.player.playMusic(a, [a, b]);
  const old = s.current().requestId;
  await s.player.advanceMusic();
  s.command("next", old);
  await tick();
  assert.equal(s.current().track.id, "b");
  s.player.stopMusic();
  s.command("next", old);
  await tick();
  assert.equal(s.current(), undefined);
});

test("playing the same track after releasing audio to Roku starts a fresh local player", async () => {
  const s = setup(), a = track("a");
  await s.player.playMusic(a);
  s.event("playing");
  s.player.releaseLocalMusicOutput();
  s.player.useMusicPlayback.setState({ current: { ...s.current(), phase: "paused" } });
  s.player.toggleMusic();
  await tick();
  assert.equal(s.starts.length, 2);
  assert.notEqual(s.starts[0][2], s.starts[1][2]);
  assert.equal(s.pauses.length, 0);
});
