import { findLibraryVideo } from "./library-video";
import { AppState } from "react-native";
import { create } from "zustand";
import { v4 as uuid } from "uuid";
import { MMKV } from "../../common/database/mmkv";
import {
  fetchOhaiMusic,
  detachOhaiPlaybackForAccount,
  requestOhaiPlayback,
  useOhaiAccount,
  type MusicTrack
} from "../login/google-session";
import {
  localMusicSnapshot,
  pauseLocalMusicForTransfer,
  prepareLocalMusic,
  releaseLocalMusicOutput,
  resumeLocalMusicAt,
  stopLocalMusic,
  useMusicPlayback
} from "../notes/music-player";
import {
  installRemoteMusicHandler,
  type RemoteMusicAction
} from "./remote-controls";
import {
  eligible,
  playbackStorageKey,
  readConnection,
  readReceivers,
  type Connection,
  type Intent,
  type QueueEntry,
  type Receiver
} from "./connection-model";

type Stage =
  | "idle"
  | "consent"
  | "preparing"
  | "connecting"
  | "active"
  | "unknown"
  | "returning";
export const useRokuConnection = create<{
  enabled: boolean;
  receivers: Receiver[];
  connection?: Connection;
  name: string;
  stage: Stage;
  busy: boolean;
  localSuspended: boolean;
  error?: string;
}>(() => ({
  enabled: false,
  receivers: [],
  name: "Roku TV",
  stage: "idle",
  busy: false,
  localSuspended: false
}));
let generation = 0,
  timer: ReturnType<typeof setTimeout> | undefined,
  refreshing = false;
let observers = 0;
export function observeRokuPicker() {
  observers++;
  return () => {
    observers = Math.max(0, observers - 1);
  };
}
let tracks: MusicTrack[] = [];
let queueEntries: QueueEntry[] = [];
const queueSnapshots = new Map<string, QueueEntry[]>();
const queueKey = (intent: Intent) =>
  intent.queueId || intent.queue.map((q) => q.entryId).join(";");
function cacheQueue(intent: Intent, entries: QueueEntry[]) {
  queueSnapshots.set(queueKey(intent), entries);
  if (queueSnapshots.size > 5) {
    const key = queueSnapshots.keys().next().value;
    if (key) queueSnapshots.delete(key);
  }
  return intent;
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const currentOwner = () => useOhaiAccount.getState().userId;
const fail = (message: string): never => {
  throw new Error(message);
};
export function remotePlaybackHeld() {
  const s = useRokuConnection.getState();
  return (
    !!s.connection && (s.connection.phase === "active" || s.localSuspended)
  );
}
function persist(
  owner: string,
  connection: Connection | undefined,
  name: string
) {
  MMKV.setString(
    playbackStorageKey(owner),
    JSON.stringify(
      connection
        ? {
            sessionId: connection.sessionId,
            name,
            connection,
            suspended: useRokuConnection.getState().localSuspended
          }
        : null
    )
  );
}
function remember(state: Connection, owner: string) {
  if (currentOwner() !== owner) return;
  const old = useRokuConnection.getState();
  useRokuConnection.setState({ connection: state });
  persist(owner, state, old.name);
  if (state.phase === "closed") {
    persist(owner, undefined, old.name);
    useRokuConnection.setState({
      connection: undefined,
      stage: "idle",
      localSuspended: false,
      busy: false,
      error: undefined
    });
    if (
      old.stage !== "returning" &&
      (old.localSuspended || old.connection?.phase === "active")
    ) {
      // A confirmed-ended TV session releases routing but never auto-plays here.
      releaseLocalMusicOutput();
      const current = useMusicPlayback.getState().current;
      if (current) useMusicPlayback.setState({ current: { ...current, phase: "paused" } });
    }
    return;
  }
  if (state.phase === "failed") {
    if (!old.localSuspended) {
      persist(owner, undefined, old.name);
      useRokuConnection.setState({
        connection: undefined,
        stage: "idle",
        localSuspended: false,
        error:
          "The TV declined or could not prepare this item. Local playback is unchanged."
      });
      return;
    }
    useRokuConnection.setState({
      stage: "unknown",
      error:
        "The TV could not complete playback. Choose Play here or reconnect."
    });
    return;
  }
  if (state.phase === "preparing" && old.busy)
    useRokuConnection.setState({ stage: "preparing" });
  if (state.phase === "active" && !state.online) {
    useRokuConnection.setState({
      stage: "unknown",
      error: "The TV is offline. Its last playback state may be out of date."
    });
    return;
  }
  if (state.phase === "active" && old.stage !== "returning") {
    useRokuConnection.setState({
      stage: "active",
      error: undefined,
      localSuspended: true
    });
    if (state.intent.kind === "music") {
      const activeEntries =
        queueSnapshots.get(queueKey(state.intent)) || state.intent.queue;
      const entry =
        activeEntries[state.snapshot.queueIndex ?? state.intent.queueIndex] ||
        state.intent.queue[
          (state.snapshot.queueIndex ?? state.intent.queueIndex) -
            (state.intent.queueOffset || 0)
        ];
      const track = [...tracks, ...useMusicPlayback.getState().queue].find(
        (t) => t.id === (state.snapshot.contentId || entry?.contentId)
      );
      if (track) {
        const oldMusic = useMusicPlayback.getState().current;
        useMusicPlayback.setState({
          current: {
            track,
            requestId: oldMusic?.requestId ?? 0,
            phase:
              state.snapshot.phase === "playing"
                ? "playing"
                : state.snapshot.phase === "failed"
                ? "failed"
                : state.snapshot.phase === "ended"
                ? "ended"
                : "paused"
          },
          queue: activeEntries
            .map((q) =>
              [...tracks, ...useMusicPlayback.getState().queue].find(
                (t) => t.id === q.contentId
              )
            )
            .filter((t): t is MusicTrack => !!t),
          loop: state.snapshot.repeat !== "off"
        });
      }
    }
  }
}
async function readState(owner: string, sessionId: string) {
  return readConnection(
    await requestOhaiPlayback(owner, "sessions/" + sessionId)
  );
}
export async function refreshRokuConnection() {
  const owner = currentOwner(),
    guard = generation;
  if (!owner || refreshing || AppState.currentState !== "active") return;
  refreshing = true;
  try {
    const result = readReceivers(await requestOhaiPlayback(owner, "receivers"));
    if (guard !== generation || currentOwner() !== owner) return;
    useRokuConnection.setState(result);
    const existing = useRokuConnection.getState().connection;
    if (existing) {
      const state = await readState(owner, existing.sessionId);
      if (guard === generation) remember(state, owner);
    }
  } catch (e) {
    if (guard === generation) {
      const s = useRokuConnection.getState();
      if ((e as { status?: number }).status === 410 && s.connection) {
        generation++; // Discard controls targeting the expired receiver epoch.
        remember({ ...s.connection, phase: "closed" }, owner);
        return;
      }
      if (s.connection && remotePlaybackHeld())
        useRokuConnection.setState({ stage: "unknown" });
      useRokuConnection.setState({
        error: e instanceof Error ? e.message : "Could not refresh your TV."
      });
    }
  } finally {
    refreshing = false;
  }
}
async function waitFor(
  owner: string,
  sid: string,
  predicate: (s: Connection) => boolean,
  guard: number,
  ms = 20000
) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (guard !== generation || currentOwner() !== owner)
      fail("Connection changed. Reopen Play on device to reconcile.");
    // Native alerts and system controls briefly make iOS inactive. Keep the
    // bounded intent alive, but do not send control requests while suspended.
    if (AppState.currentState !== "active") {
      await delay(200);
      continue;
    }
    const state = await readState(owner, sid);
    if (guard !== generation) fail("Connection changed.");
    remember(state, owner);
    if (predicate(state)) return state;
    if (state.phase === "failed" || state.phase === "closed")
      fail("The TV declined or could not complete this request.");
    await delay(700);
  }
  return fail(
    "TV response timed out. Playback may still be active; refresh before retrying."
  );
}
async function command(
  action: string,
  payload: Record<string, unknown>,
  owner: string,
  guard: number
) {
  const connection = useRokuConnection.getState().connection;
  if (!connection) fail("No TV is connected.");
  const latest = await readState(owner, connection!.sessionId);
  if (guard !== generation) fail("Connection changed.");
  if (!latest.online)
    fail("The TV is offline. Refresh before changing playback.");
  const commandId = uuid(),
    body = {
      commandId,
      action,
      payload,
      expectedRevision: latest.revision,
      receiverEpoch: latest.receiverEpoch,
      fence: latest.fence
    };
  // An ambiguous transport failure retries exactly the same command, never a new ID.
  let raw: unknown;
  try {
    raw = await requestOhaiPlayback(
      owner,
      "sessions/" + latest.sessionId + "/commands",
      body
    );
  } catch (e) {
    if ((e as { status?: number }).status) throw e;
    raw = await requestOhaiPlayback(
      owner,
      "sessions/" + latest.sessionId + "/commands",
      body
    );
  }
  if (guard !== generation) fail("Connection changed.");
  const result = raw as { status?: string; state?: unknown };
  if (result.state) remember(readConnection(result.state), owner);
  if (
    result.status === "expired" ||
    result.status === "failed" ||
    result.status === "superseded"
  )
    fail("The TV command expired or failed. Refresh playback before retrying.");
  if (result.status === "applied") return readState(owner, latest.sessionId);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (guard !== generation || currentOwner() !== owner)
      fail("Connection changed. Reopen Play on device to reconcile.");
    // Native alerts and system controls briefly make iOS inactive. Keep the
    // bounded intent alive, but do not send control requests while suspended.
    if (AppState.currentState !== "active") {
      await delay(200);
      continue;
    }
    const result = (await requestOhaiPlayback(
      owner,
      "sessions/" + latest.sessionId + "/commands/" + commandId
    )) as { status: string; state: unknown };
    const state = readConnection(result.state);
    if (guard !== generation) fail("Connection changed.");
    remember(state, owner);
    if (result.status === "applied") return state;
    if (result.status === "failed" || result.status === "expired")
      fail(
        "The TV command failed or expired. Refresh playback before retrying."
      );
    await delay(1000);
  }
  return fail(
    "TV response timed out. Playback may still be active; refresh before retrying."
  );
}
async function makeQueueIntent(
  owner: string,
  queue: MusicTrack[],
  index: number,
  position: number,
  paused: boolean,
  repeat: Intent["repeat"],
  guard: number
): Promise<Intent> {
  if (queue.length > 10000) fail("TV queues support up to 10,000 entries.");
  const entries = queue.map((t) => ({ entryId: uuid(), contentId: t.id }));
  queueEntries = entries;
  if (queue.length <= 100)
    return cacheQueue(
      {
        contentId: queue[index].id,
        kind: "music",
        position,
        paused,
        queue: entries,
        queueIndex: index,
        repeat
      },
      entries
    );
  const queueId = uuid();
  for (let offset = 0; offset < entries.length; offset += 100) {
    if (
      guard !== generation ||
      currentOwner() !== owner ||
      AppState.currentState !== "active"
    )
      fail("Queue upload interrupted. Try again.");
    const payload = {
      queueId,
      total: entries.length,
      offset,
      entries: entries.slice(offset, offset + 100)
    };
    try {
      await requestOhaiPlayback(owner, "queues", payload);
    } catch (e) {
      if ((e as { status?: number }).status) throw e;
      await requestOhaiPlayback(owner, "queues", payload);
    }
  }
  const queueOffset = Math.floor(index / 100) * 100;
  return cacheQueue(
    {
      contentId: queue[index].id,
      kind: "music",
      position,
      paused,
      queue: entries.slice(queueOffset, queueOffset + 100),
      queueId,
      queueOffset,
      queueTotal: entries.length,
      queueIndex: index,
      repeat
    },
    entries
  );
}
async function restoreQueue(owner: string, state: Connection, guard: number) {
  queueEntries = [];
  const total = state.intent.queueTotal || state.intent.queue.length;
  for (let offset = 0; offset < total; offset += 100) {
    if (guard !== generation) return;
    const raw = (await requestOhaiPlayback(
      owner,
      "sessions/" + state.sessionId + "/queue/" + offset
    )) as { entries: QueueEntry[]; offset: number; total: number };
    if (
      raw.offset !== offset ||
      raw.total !== total ||
      !Array.isArray(raw.entries) ||
      raw.entries.length !== Math.min(100, total - offset) ||
      raw.entries.some(
        (q) =>
          !q ||
          !/^[-\w]{1,100}$/.test(q.entryId) ||
          !/^[-\w]{1,100}$/.test(q.contentId)
      )
    )
      fail("Invalid TV queue snapshot.");
    queueEntries.push(...raw.entries);
  }
  cacheQueue(state.intent, queueEntries);
}
export async function connectRoku(
  receiver: Receiver,
  video?: { contentId: string; adapterKey?: string }
) {
  const owner = currentOwner(),
    s = useRokuConnection.getState();
  if (!owner || s.busy) return;
  const music = useMusicPlayback.getState(),
    current = music.current;
  const adapter = video
    ? findLibraryVideo(video.contentId, video.adapterKey)
    : undefined;
  if (
    (!video && !current) ||
    (video && !adapter) ||
    !eligible(receiver, video ? "videos" : "music")
  ) {
    useRokuConnection.setState({
      error:
        "Choose an available account MP3 and enable phone control on the TV."
    });
    return;
  }
  if (s.connection && remotePlaybackHeld()) {
    useRokuConnection.setState({
      error: "Return playback to this iPhone before switching TVs."
    });
    return;
  }
  const guard = ++generation;
  useRokuConnection.setState({
    busy: true,
    error: undefined,
    name: receiver.name,
    stage: "consent"
  });
  let paused = false;
  try {
    const local = adapter
      ? await adapter.snapshot()
      : await localMusicSnapshot();
    if (
      !local.ready ||
      (!adapter &&
        "requestId" in local &&
        local.requestId !== current!.requestId)
    )
      fail("Wait for the local track to be ready.");
    let intent: Intent;
    if (adapter) {
      intent = {
        contentId: adapter.contentId,
        kind: "videos",
        position: local.position,
        paused: local.paused,
        queue: [{ entryId: uuid(), contentId: adapter.contentId }],
        queueIndex: 0,
        repeat: "off"
      };
    } else {
      const queue = music.queue.length ? music.queue : [current!.track];
      const index = queue.findIndex((t) => t.id === current!.track.id);
      if (index < 0) fail("The music queue changed.");
      intent = await makeQueueIntent(
        owner,
        queue,
        index,
        local.position,
        local.paused,
        music.loop ? "all" : "off",
        guard
      );
      tracks = queue;
    }
    const sessionId = uuid();
    const state = readConnection(
      await requestOhaiPlayback(owner, "sessions", {
        sessionId,
        receiverId: receiver.id,
        deviceName: "0hi iPhone",
        intent
      })
    );
    if (guard !== generation) fail("Your account changed.");
    remember(state, owner);
    const ready = await waitFor(
      owner,
      sessionId,
      (v) => v.phase === "ready",
      guard,
      30000
    );
    if (
      !adapter &&
      useMusicPlayback.getState().current?.requestId !== current!.requestId
    )
      fail("The local track changed. Cancel and choose the TV again.");
    useRokuConnection.setState({ stage: "connecting" });
    const final = adapter
      ? await adapter.snapshot()
      : await localMusicSnapshot();
    if (
      !adapter &&
      "requestId" in final &&
      final.requestId !== current!.requestId
    )
      fail("The local player changed.");
    if (adapter) await adapter.pause();
    else pauseLocalMusicForTransfer();
    paused = true;
    useRokuConnection.setState({ localSuspended: true });
    persist(owner, useRokuConnection.getState().connection, receiver.name);
    await command(
      "commit",
      { position: final.position, paused: final.paused },
      owner,
      guard
    );
    if (guard !== generation) fail("Connection changed.");
    if (adapter) await adapter.release().catch(() => {});
    releaseLocalMusicOutput();
    if (adapter) stopLocalMusic();
    useRokuConnection.setState({ stage: "active" });
  } catch (e) {
    if (guard === generation)
      useRokuConnection.setState({
        error: e instanceof Error ? e.message : "Could not connect.",
        stage: paused ? "unknown" : "idle"
      });
  } finally {
    if (guard === generation) useRokuConnection.setState({ busy: false });
  }
}
export async function detachRokuController() {
  const owner = currentOwner(),
    s = useRokuConnection.getState();
  if (!owner || !s.connection || s.busy) return;
  try {
    await requestOhaiPlayback(
      owner,
      "sessions/" + s.connection.sessionId + "/detach",
      {}
    );
    generation++;
    persist(owner, undefined, s.name);
    useRokuConnection.setState({
      connection: undefined,
      stage: "idle",
      localSuspended: false,
      busy: false
    });
    stopLocalMusic();
  } catch (e) {
    useRokuConnection.setState({
      error:
        e instanceof Error ? e.message : "Could not disconnect the controller."
    });
  }
}
export async function cancelRokuConnection() {
  const owner = currentOwner();
  if (!owner) return;
  const s = useRokuConnection.getState();
  if (!s.connection) return;
  const guard = ++generation;
  try {
    await command("cancel", {}, owner, guard);
    useRokuConnection.setState({
      connection: undefined,
      stage: "idle",
      localSuspended: false,
      busy: false
    });
    persist(owner, undefined, s.name);
  } catch (e) {
    useRokuConnection.setState({
      stage: "unknown",
      busy: false,
      error:
        e instanceof Error ? e.message : "Could not cancel the TV connection."
    });
  }
}
export async function returnToIPhone(force = false) {
  const owner = currentOwner(),
    state = useRokuConnection.getState();
  if (!owner || !state.connection || state.busy) return;
  const guard = ++generation;
  useRokuConnection.setState({
    busy: true,
    stage: "returning",
    error: undefined
  });
  try {
    const remote = force
      ? state.connection
      : await readState(owner, state.connection.sessionId);
    const contentId = remote.snapshot.contentId || remote.intent.contentId;
    if (remote.intent.kind === "videos") {
      const adapter = findLibraryVideo(contentId);
      if (!adapter)
        fail(
          "Open this account video in your browser to return playback here."
        );
      const local = await adapter!.prepare();
      if (!local.ready) fail("The iPhone video is not ready.");
      const wasPaused =
        remote.snapshot.phase === "playing"
          ? false
          : remote.snapshot.phase === "paused"
          ? true
          : remote.intent.paused;
      const final = force
        ? remote
        : await command(
            "setPaused",
            { paused: true, generation: remote.snapshot.generation },
            owner,
            guard
          );
      if (guard !== generation) fail("Connection changed.");
      await adapter!.resume(final.snapshot.position ?? 0, wasPaused);
      useRokuConnection.setState({
        connection: undefined,
        stage: "idle",
        localSuspended: false
      });
      persist(owner, undefined, state.name);
      if (!force)
        void requestOhaiPlayback(
          owner,
          "sessions/" + remote.sessionId + "/detach",
          {}
        ).catch(() => {});
      return;
    }
    const track = [...tracks, ...((await fetchOhaiMusic(owner)) || [])].find(
      (t) => t.id === contentId
    );
    if (!track) fail("This track is not available on your iPhone.");
    const requestId = await prepareLocalMusic(track!, owner);
    const deadline = Date.now() + 15000;
    let local = await localMusicSnapshot();
    while (
      (!local.ready || local.requestId !== requestId) &&
      Date.now() < deadline
    ) {
      if (guard !== generation || AppState.currentState !== "active")
        fail("Return interrupted.");
      await delay(300);
      local = await localMusicSnapshot();
    }
    if (!local.ready || local.requestId !== requestId)
      fail("The iPhone could not prepare this track.");
    const wasPaused =
      remote.snapshot.phase === "playing"
        ? false
        : remote.snapshot.phase === "paused"
        ? true
        : remote.intent.paused;
    let final = remote;
    if (!force)
      final = await command(
        "setPaused",
        { paused: true, generation: remote.snapshot.generation },
        owner,
        guard
      );
    if (guard !== generation || currentOwner() !== owner)
      fail("Your account changed.");
    useRokuConnection.setState({
      connection: undefined,
      stage: "idle",
      localSuspended: false
    });
    persist(owner, undefined, state.name);
    await resumeLocalMusicAt(
      final.snapshot.position ?? 0,
      wasPaused,
      requestId
    );
    if (!force)
      void requestOhaiPlayback(
        owner,
        "sessions/" + remote.sessionId + "/detach",
        {}
      ).catch(() => {});
  } catch (e) {
    if (guard === generation) {
      releaseLocalMusicOutput();
      const latest = useRokuConnection.getState().connection;
      if (latest) remember(latest, owner);
      useRokuConnection.setState({
        stage: "unknown",
        error:
          e instanceof Error
            ? e.message
            : "Could not return playback to this iPhone."
      });
    }
  } finally {
    if (guard === generation) useRokuConnection.setState({ busy: false });
  }
}
export async function rokuAction(
  action: string,
  payload: Record<string, unknown> = {}
) {
  const owner = currentOwner(),
    s = useRokuConnection.getState();
  if (!owner || !s.connection || s.busy) return;
  const guard = generation;
  useRokuConnection.setState({ busy: true, error: undefined });
  try {
    await command(action, payload, owner, guard);
    if (action === "stop") {
      persist(owner, undefined, s.name);
      useRokuConnection.setState({
        connection: undefined,
        stage: "idle",
        localSuspended: false
      });
      stopLocalMusic();
    }
  } catch (e) {
    useRokuConnection.setState({
      error: e instanceof Error ? e.message : "Could not update TV playback."
    });
  } finally {
    if (guard === generation) useRokuConnection.setState({ busy: false });
  }
}
function dispatch(action: RemoteMusicAction) {
  const s = useRokuConnection.getState(),
    snap = s.connection?.snapshot;
  if (!snap || s.busy) return;
  if (action.type === "toggle")
    void rokuAction("setPaused", {
      paused: snap.phase === "playing",
      generation: snap.generation
    });
  else if (action.type === "stop") void rokuAction("stop");
  else if (action.type === "loop")
    void rokuAction("setRepeat", {
      repeat: snap.repeat === "off" ? "all" : "off"
    });
  else if (action.type === "advance")
    void rokuAction("advance", {
      direction: action.direction,
      generation: snap.generation,
      queueIndex: snap.queueIndex
    });
  else if (action.type === "play") {
    const queue = action.queue?.some((t) => t.id === action.track.id)
      ? action.queue
      : [action.track];
    const index = queue.findIndex((t) => t.id === action.track.id);
    tracks = queue;
    const owner = currentOwner(),
      guard = generation;
    if (owner) {
      useRokuConnection.setState({ busy: true, error: undefined });
      void makeQueueIntent(
        owner,
        queue,
        Math.max(0, index),
        0,
        false,
        snap.repeat || "off",
        guard
      )
        .then((intent) => {
          if (guard !== generation || currentOwner() !== owner) return;
          useRokuConnection.setState({ busy: false });
          return rokuAction("setQueue", { intent });
        })
        .catch((e) => {
          if (guard === generation)
            useRokuConnection.setState({ error: e.message, busy: false });
        });
    }
  }
}
export function listenForRokuConnection() {
  let disposed = false;
  const restore = async () => {
    const guard = ++generation,
      owner = currentOwner();
    tracks = [];
    queueEntries = [];
    queueSnapshots.clear();
    useRokuConnection.setState({
      connection: undefined,
      localSuspended: false,
      enabled: false,
      receivers: [],
      stage: "idle",
      busy: false,
      error: undefined
    });
    if (!owner) return;
    try {
      const raw = JSON.parse(
        MMKV.getString(playbackStorageKey(owner)) || "null"
      ) as {
        sessionId?: string;
        name?: string;
        connection?: unknown;
        suspended?: boolean;
      } | null;
      if (raw?.sessionId && /^[\w-]{1,100}$/.test(raw.sessionId)) {
        if (raw.connection) {
          const cached = readConnection(raw.connection);
          useRokuConnection.setState({
            connection: { ...cached, online: false },
            localSuspended: raw.suspended === true || cached.phase === "active",
            name: raw.name || "Roku TV",
            stage: "unknown"
          });
        }
        const connection = await readState(owner, raw.sessionId);
        if (guard !== generation) return;
        tracks = (await fetchOhaiMusic(owner)) || [];
        await restoreQueue(owner, connection, guard);
        if (guard !== generation) return;
        useRokuConnection.setState({
          name: raw.name || "Roku TV",
          stage: connection.phase === "active" ? "active" : "unknown"
        });
        remember(connection, owner);
      }
    } catch {
      /* Preserve persisted intent for explicit reconciliation, never auto-play. */
    }
    await refreshRokuConnection();
  };
  const schedule = () => {
    if (disposed) return;
    timer = setTimeout(async () => {
      if (
        AppState.currentState === "active" &&
        (observers > 0 || useRokuConnection.getState().connection)
      )
        await refreshRokuConnection();
      schedule();
    }, 2000);
  };
  const stopHooks = installRemoteMusicHandler({
    active: remotePlaybackHeld,
    dispatch
  });
  const stopAccount = useOhaiAccount.subscribe((s, p) => {
    if (s.userId !== p.userId) {
      const previous = useRokuConnection.getState().connection;
      if (p.userId && previous)
        void detachOhaiPlaybackForAccount(p.userId, previous.sessionId);
      void restore();
    }
  });
  const app = AppState.addEventListener("change", (phase) => {
    // One foreground refresh discovers newly enabled receiver support even when
    // the previous device button was the AirPlay-only picker. Continuous polling
    // still requires an open picker or an existing remote session.
    if (phase === "active" && currentOwner()) void refreshRokuConnection();
  });
  void restore();
  schedule();
  return () => {
    disposed = true;
    generation++;
    if (timer) clearTimeout(timer);
    app.remove();
    stopAccount();
    stopHooks();
  };
}
