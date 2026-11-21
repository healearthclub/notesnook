const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../../../..");
const req = createRequire(path.join(root, "apps/mobile/package.json"));
const ts = createRequire(path.join(root, "package.json"))("typescript");
const { createStore } = req("zustand/vanilla");
function setup() {
  let now = Date.now();
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  let locked = false,
    reads = 0,
    stops = 0,
    pendingRead;
  const calls = [],
    cache = new Map(),
    listeners = new Map();
  const session = {
    userId: "google:test",
    email: "test@example.com",
    expiresAt: Date.now() + 3600000,
    token: "x".repeat(43)
  };
  const mocks = {
    "../playback/remote-controls": { routeRemoteMusicAction: () => false, isRemoteMusicHeld: () => false },
    "react-native": {
      Platform: { OS: "ios" },
      NativeModules: {
        OhaiMusicPlayer: {
          start: async (...args) => calls.push(args),
          setMetadata() {},
          stop: () => stops++,
          setPaused() {}
        }
      },
      NativeEventEmitter: class {
        addListener(name, fn) {
          listeners.set(name, fn);
          return { remove: () => listeners.delete(name) };
        }
      }
    },
    "react-native-keychain": {
      ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked" },
      getGenericPassword: async () => {
        reads++;
        if (locked) throw new Error("errSecInteractionNotAllowed");
        if (pendingRead) await pendingRead;
        return { password: JSON.stringify(session) };
      },
      resetGenericPassword: async () => true
    },
    zustand: { create: (fn) => createStore(fn) }
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const m = { exports: {} };
    const out = ts.transpileModule(
      fs.readFileSync(
        path.join(root, "apps/mobile/app/features", file + ".ts"),
        "utf8"
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020
        }
      }
    ).outputText;
    vm.runInNewContext("(function(require,module,exports){" + out + "})", {
      URL,
      Date: Clock,
      setTimeout,
      clearTimeout,
      AbortController
    })(
      (id) =>
        id === "./account-identity"
          ? load("login/account-identity")
          : id === "../login/google-session"
          ? load("login/google-session")
          : id === "./music-queue"
          ? load("notes/music-queue")
          : mocks[id],
      m,
      m.exports
    );
    cache.set(file, m.exports);
    return m.exports;
  }
  const auth = load("login/google-session");
  auth.useOhaiAccount.setState({
    userId: session.userId,
    email: session.email
  });
  const player = load("notes/music-player");
  player.listenForMusicPlayback();
  const track = (id) => ({
    id,
    title: id,
    artist: "Test",
    playback: "account"
  });
  return {
    player,
    auth,
    calls,
    track,
    session,
    elapse: (ms) => (now += ms),
    lock: () => (locked = true),
    unlock: () => (locked = false),
    deferRead: () => {
      let finish;
      pendingRead = new Promise((r) => (finish = r));
      return finish;
    },
    reads: () => reads,
    stops: () => stops,
    ended: () =>
      listeners.get("OhaiMusicState")({
        requestId: player.useMusicPlayback.getState().current.requestId,
        state: "ended"
      })
  };
}
test("an authenticated playlist starts its next song after the screen locks", async () => {
  const s = setup(),
    a = s.track("a"),
    b = s.track("b");
  await s.player.playMusic(a, [a, b]);
  assert.equal(s.calls.length, 1);
  s.lock();
  s.ended();
  await new Promise(setImmediate);
  assert.equal(s.player.useMusicPlayback.getState().current.phase, "loading");
  assert.equal(s.calls.length, 2);
  assert.match(s.calls[1][0], /id=b$/);
});

test("automatic wraparound reuses the active credential for the first song", async () => {
  const s = setup(),
    a = s.track("a"),
    b = s.track("b");
  await s.player.playMusic(b, [a, b]);
  s.lock();
  s.ended();
  await new Promise(setImmediate);
  assert.equal(s.reads(), 1);
  assert.equal(s.calls.length, 2);
  assert.match(s.calls[1][0], /id=a$/);
});
test("manual next and previous work with the screen locked", async () => {
  const s = setup(),
    a = s.track("a"),
    b = s.track("b");
  await s.player.playMusic(a, [a, b]);
  s.lock();
  await s.player.advanceMusic();
  await s.player.advanceMusic(-1);
  assert.equal(s.reads(), 1);
  assert.equal(s.calls.length, 3);
});
test("stopping playback releases the active credential", async () => {
  const s = setup(),
    a = s.track("a");
  await s.player.playMusic(a, [a]);
  s.player.stopMusic();
  s.lock();
  await s.player.playMusic(a, [a]);
  assert.equal(s.calls.length, 1);
  assert.equal(s.player.useMusicPlayback.getState().current.phase, "failed");
});
test("an account change cannot reuse a prior account credential", async () => {
  const s = setup(),
    a = s.track("a");
  await s.player.playMusic(a, [a]);
  s.auth.useOhaiAccount.setState({ userId: "google:other" });
  s.lock();
  await s.player.playMusic(a, [a]);
  assert.equal(s.calls.length, 1);
});
test("expired credentials cannot authorize the next track", async () => {
  const s = setup(),
    a = s.track("a"),
    b = s.track("b");
  await s.player.playMusic(a, [a, b]);
  s.elapse(3600001);
  s.lock();
  s.ended();
  await new Promise(setImmediate);
  assert.equal(s.calls.length, 1);
  assert.equal(s.player.useMusicPlayback.getState().current.phase, "failed");
});
test("a delayed Keychain response cannot repopulate credentials after dismissal", async () => {
  const s = setup(),
    a = s.track("a"),
    finish = s.deferRead();
  const starting = s.player.playMusic(a, [a]);
  s.player.stopMusic();
  finish();
  await starting;
  assert.equal(s.calls.length, 0);
  s.lock();
  await s.player.playMusic(a, [a]);
  assert.equal(s.calls.length, 0);
});
test("preparing a track does not stop audio before the source is ready", async () => {
  const s = setup(),
    a = s.track("a"),
    finish = s.deferRead();
  const starting = s.player.playMusic(a, [a]);
  assert.equal(s.stops(), 0);
  finish();
  await starting;
  assert.equal(s.calls.length, 1);
});
