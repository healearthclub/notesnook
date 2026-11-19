import { isRemoteMusicHeld, routeRemoteMusicAction } from "../playback/remote-controls";
import { NativeEventEmitter, NativeModules } from "react-native";
import { create } from "zustand";
import {
  clearMusicPlaybackSession,
  getMusicPlaybackSource,
  MusicTrack,
  useOhaiAccount
} from "../login/google-session";

import { nextQueueIndex } from "./music-queue";

type Phase = "loading" | "playing" | "paused" | "ended" | "failed";
type PlayingTrack = { track: MusicTrack; requestId: number; phase: Phase };
type PlayerModule = {
  start(url: string, token: string, requestId: number): Promise<void>;
  setMetadata(
    metadata: {
      title: string;
      artist: string;
      artworkURI?: string;
      artworkAuthorization?: string;
      queueCount: number;
      queueIndex: number;
    },
    requestId: number
  ): void;
  setPaused(paused: boolean, requestId: number): void;
  stop(): void;
  releaseForRemote(): void;
  prepare(url: string, token: string, requestId: number): Promise<void>;
  snapshot(): Promise<{requestId:number;position:number;duration:number;ready:boolean;paused:boolean}>;
  seek(position: number, requestId: number): Promise<void>;
  addListener(event: string): void;
  removeListeners(count: number): void;
};

const player = NativeModules.OhaiMusicPlayer as PlayerModule | undefined;
let sequence = 0;
let localOutputReleased = false;
export const useMusicPlayback = create<{
  current?: PlayingTrack;
  queue: MusicTrack[];
  loop: boolean;
}>(() => ({ queue: [], loop: true }));

export function stopMusic() {
  if (routeRemoteMusicAction({ type: "stop" })) return;
  stopLocalMusic();
}

export function stopLocalMusic() {
  clearMusicPlaybackSession();
  useMusicPlayback.setState({ current: undefined, queue: [] });
  player?.stop();
}

export function listenForMusicPlayback() {
  const subscription = player
    ? new NativeEventEmitter(player).addListener(
        "OhaiMusicState",
        ({ requestId, state }: { requestId: number; state: Phase }) => {
          if (isRemoteMusicHeld()) return;
          const current = useMusicPlayback.getState().current;
          if (!current || current.requestId !== requestId) return;
          useMusicPlayback.setState({ current: { ...current, phase: state } });
          if (state === "failed") clearMusicPlaybackSession();
          if (state === "ended" && current.phase !== "ended") {
            void advanceMusic(1, true);
          }
        }
      )
    : undefined;
  const commands = player
    ? new NativeEventEmitter(player).addListener(
        "OhaiMusicCommand",
        ({ requestId, command }: { requestId: number; command: string }) => {
          if (isRemoteMusicHeld()) return;
          if (useMusicPlayback.getState().current?.requestId !== requestId)
            return;
          if (command === "next") void advanceMusic(1);
          else if (command === "previous") void advanceMusic(-1);
        }
      )
    : undefined;
  const unsubscribe = useOhaiAccount.subscribe((state, previous) => {
    if (state.userId !== previous.userId) stopLocalMusic();
  });
  return () => {
    subscription?.remove();
    commands?.remove();
    unsubscribe();
    stopLocalMusic();
  };
}

export async function playMusic(track: MusicTrack, playlist?: MusicTrack[]) {
  if (routeRemoteMusicAction({ type: "play", track, queue: playlist })) return;
  if (!useOhaiAccount.getState().userId || !track.playback) return;
  if (playlist) {
    const ids = new Set<string>();
    const queue = playlist.filter((item) => {
      if (!item.playback || ids.has(item.id)) return false;
      ids.add(item.id);
      return true;
    });
    useMusicPlayback.setState({
      queue: queue.some((item) => item.id === track.id) ? queue : [track]
    });
  } else if (
    !useMusicPlayback.getState().queue.some((item) => item.id === track.id)
  ) {
    useMusicPlayback.setState({ queue: [track] });
  }
  const selected = useMusicPlayback.getState().current;
  if (selected?.track.id === track.id && selected.phase !== "failed" && !localOutputReleased) {
    publishMusicMetadata(track, selected.requestId);
    if (selected.phase === "paused" || selected.phase === "ended") {
      player?.setPaused(false, selected.requestId);
    }
    return;
  }

  await startMusic(track);
}

async function startMusic(track: MusicTrack) {
  const userId = useOhaiAccount.getState().userId;
  if (!userId || !track.playback) return;
  const requestId = ++sequence;
  useMusicPlayback.setState({
    current: { track, requestId, phase: "loading" }
  });
  const stillSelected = () =>
    useMusicPlayback.getState().current?.requestId === requestId &&
    useOhaiAccount.getState().userId === userId;
  try {
    const source = await getMusicPlaybackSource(userId, track);
    if (!stillSelected()) return;
    if (!source || !player) throw new Error("Audio is unavailable.");
    await player.start(source.url, source.token, requestId);
    localOutputReleased = false;
    if (!stillSelected()) return;
    publishMusicMetadata(track, requestId);
  } catch {
    if (stillSelected()) {
      clearMusicPlaybackSession();
      player?.stop();
      useMusicPlayback.setState({
        current: { track, requestId, phase: "failed" }
      });
    }
  }
}

function publishMusicMetadata(track: MusicTrack, requestId: number) {
  const queue = useMusicPlayback.getState().queue;
  player?.setMetadata(
    {
      title: track.title || "Untitled track",
      artist: track.artist || "",
      artworkURI: track.artworkSource?.uri,
      artworkAuthorization: track.artworkSource?.headers?.Authorization,
      queueCount: queue.length,
      queueIndex: Math.max(
        0,
        queue.findIndex((item) => item.id === track.id)
      )
    },
    requestId
  );
}

export function toggleMusic() {
  if (routeRemoteMusicAction({ type: "toggle" })) return;
  const current = useMusicPlayback.getState().current;
  if (!current) return;
  if (current.phase === "failed" || localOutputReleased) void playMusic(current.track);
  else
    player?.setPaused(
      current.phase === "playing" || current.phase === "loading",
      current.requestId
    );
}

export function togglePlaylistLoop() {
  if (routeRemoteMusicAction({ type: "loop" })) return;
  useMusicPlayback.setState((state) => ({ loop: !state.loop }));
}

export async function advanceMusic(direction: 1 | -1 = 1, automatic = false) {
  if (routeRemoteMusicAction({ type: "advance", direction })) return;
  const { current, queue, loop } = useMusicPlayback.getState();
  if (!current) return;
  const index = queue.findIndex((track) => track.id === current.track.id);
  if (automatic && !loop && index === queue.length - 1) return;
  const next = nextQueueIndex(queue.length, index, direction);
  if (next !== null) await startMusic(queue[next]);
}

export async function localMusicSnapshot() {
  if (!player?.snapshot) throw new Error("Install the latest iPhone build to transfer playback.");
  return player.snapshot();
}
export function pauseLocalMusicForTransfer() {
  const current = useMusicPlayback.getState().current;
  if (current) player?.setPaused(true, current.requestId);
}
export function releaseLocalMusicOutput() { localOutputReleased = true; if (player?.releaseForRemote) player.releaseForRemote(); else player?.stop(); }
export async function prepareLocalMusic(track: MusicTrack, userId: string) {
  const source = await getMusicPlaybackSource(userId, track);
  if (!source || !player?.prepare || useOhaiAccount.getState().userId !== userId) throw new Error("The local music source is unavailable.");
  const requestId = ++sequence;
  useMusicPlayback.setState({current:{track, requestId, phase:"paused"}});
  await player.prepare(source.url, source.token, requestId);
  localOutputReleased = false;
  return requestId;
}
export async function resumeLocalMusicAt(position: number, paused: boolean, requestId: number) {
  if (!player || useMusicPlayback.getState().current?.requestId !== requestId) throw new Error("Local playback changed.");
  await player.seek(position, requestId);
  const current = useMusicPlayback.getState().current;
  if (!current || current.requestId !== requestId) throw new Error("Local playback changed.");
  publishMusicMetadata(current.track, requestId);
  player.setPaused(paused, requestId);
}
