import type { MusicTrack } from "../login/google-session";
export type RemoteMusicAction =
  | { type: "toggle" | "stop" | "loop" }
  | { type: "advance"; direction: 1 | -1 }
  | { type: "play"; track: MusicTrack; queue?: MusicTrack[] };
type Handler = { active(): boolean; dispatch(action: RemoteMusicAction): void };
let handler: Handler | undefined;
export function installRemoteMusicHandler(value: Handler) {
  handler = value;
  return () => {
    if (handler === value) handler = undefined;
  };
}
export function routeRemoteMusicAction(action: RemoteMusicAction) {
  if (!handler?.active()) return false;
  handler.dispatch(action);
  return true;
}

export function isRemoteMusicHeld() {
  return !!handler?.active();
}
