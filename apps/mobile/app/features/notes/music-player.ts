import { NativeEventEmitter, NativeModules } from "react-native";
import { create } from "zustand";
import {
  getMusicPlaybackSource,
  MusicTrack,
  useOhaiAccount
} from "../login/google-session";

type Phase = "loading" | "playing" | "paused" | "ended" | "failed";
type PlayingTrack = { track: MusicTrack; requestId: number; phase: Phase };
type PlayerModule = {
  start(url: string, token: string, requestId: number): Promise<void>;
  setPaused(paused: boolean, requestId: number): void;
  stop(): void;
  addListener(event: string): void;
  removeListeners(count: number): void;
};

const player = NativeModules.OhaiMusicPlayer as PlayerModule | undefined;
let sequence = 0;
export const useMusicPlayback = create<{ current?: PlayingTrack }>(() => ({}));

export function stopMusic() {
  useMusicPlayback.setState({ current: undefined });
  player?.stop();
}

export function listenForMusicPlayback() {
  const subscription = player
    ? new NativeEventEmitter(player).addListener(
        "OhaiMusicState",
        ({ requestId, state }: { requestId: number; state: Phase }) => {
          const current = useMusicPlayback.getState().current;
          if (current?.requestId === requestId) {
            useMusicPlayback.setState({
              current: { ...current, phase: state }
            });
          }
        }
      )
    : undefined;
  const unsubscribe = useOhaiAccount.subscribe((state, previous) => {
    if (state.userId !== previous.userId) stopMusic();
  });
  return () => {
    subscription?.remove();
    unsubscribe();
    stopMusic();
  };
}

export async function playMusic(track: MusicTrack) {
  const selected = useMusicPlayback.getState().current;
  if (selected?.track.id === track.id && selected.phase !== "failed") {
    if (selected.phase === "paused" || selected.phase === "ended") {
      player?.setPaused(false, selected.requestId);
    }
    return;
  }

  const userId = useOhaiAccount.getState().userId;
  if (!userId || !track.playback) return;
  player?.stop();
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
  } catch {
    if (stillSelected()) {
      useMusicPlayback.setState({
        current: { track, requestId, phase: "failed" }
      });
    }
  }
}

export function toggleMusic() {
  const current = useMusicPlayback.getState().current;
  if (!current) return;
  if (current.phase === "failed") void playMusic(current.track);
  else
    player?.setPaused(
      current.phase === "playing" || current.phase === "loading",
      current.requestId
    );
}
