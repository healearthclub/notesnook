export type Receiver = {
  id: string;
  name: string;
  epoch: string;
  online: boolean;
  enabled: boolean;
  protocol: number;
  capabilities: { music: boolean; videos: boolean; silentPrepare: boolean };
};
export type QueueEntry = { entryId: string; contentId: string };
export type Intent = {
  contentId: string;
  kind: "music" | "videos";
  position: number;
  paused: boolean;
  queue: QueueEntry[];
  queueIndex: number;
  repeat: "off" | "all" | "one";
  queueId?: string;
  queueOffset?: number;
  queueTotal?: number;
};
export type Snapshot = {
  contentId: string;
  kind: "music" | "videos";
  generation: string;
  phase:
    "idle" | "preparing" | "ready" | "playing" | "paused" | "ended" | "failed";
  position: number;
  duration: number;
  seekable: boolean;
  queueIndex: number;
  queueRevision: number;
  repeat: "off" | "all" | "one";
  lastAppliedCommandId: string;
  error: string;
};
export type Connection = {
  sessionId: string;
  receiverId: string;
  receiverEpoch: string;
  revision: number;
  fence: string;
  phase: "consent" | "preparing" | "ready" | "active" | "closed" | "failed";
  online: boolean;
  intent: Intent;
  snapshot: Partial<Snapshot>;
  receivedAt: number;
};
const id = (v: unknown): v is string =>
  typeof v === "string" && /^[\w-]{1,100}$/.test(v);
function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Invalid TV response.");
  return v as Record<string, unknown>;
}
export function readReceivers(value: unknown) {
  const v = record(value);
  if (
    typeof v.enabled !== "boolean" ||
    !Array.isArray(v.receivers) ||
    v.receivers.length > 20
  )
    throw new Error("Invalid TV list.");
  const receivers = v.receivers.map((raw) => {
    const r = record(raw),
      c = record(r.capabilities);
    if (
      !id(r.id) ||
      typeof r.name !== "string" ||
      r.name.length > 60 ||
      typeof r.epoch !== "string" ||
      typeof r.online !== "boolean" ||
      typeof r.enabled !== "boolean" ||
      typeof r.protocol !== "number"
    )
      throw new Error("Invalid TV.");
    return {
      ...r,
      capabilities: {
        music: c.music === true,
        videos: c.videos === true,
        silentPrepare: c.silentPrepare === true
      }
    } as Receiver;
  });
  return { enabled: v.enabled, receivers };
}
export function readConnection(value: unknown): Connection {
  const r = record(value),
    intent = record(r.intent),
    snap = record(r.snapshot);
  if (
    !id(r.sessionId) ||
    !id(r.receiverId) ||
    !id(r.receiverEpoch) ||
    !id(r.fence) ||
    !Number.isSafeInteger(r.revision) ||
    Number(r.revision) < 0 ||
    typeof r.online !== "boolean" ||
    !["consent", "preparing", "ready", "active", "closed", "failed"].includes(
      String(r.phase)
    )
  )
    throw new Error("Invalid TV session.");
  if (
    !id(intent.contentId) ||
    !["music", "videos"].includes(String(intent.kind)) ||
    !Array.isArray(intent.queue) ||
    intent.queue.length < 1 ||
    intent.queue.length > 100 ||
    !Number.isSafeInteger(intent.queueIndex) ||
    Number(intent.queueIndex) < 0 ||
    Number(intent.queueIndex) >=
      Number(intent.queueTotal || intent.queue.length) ||
    !["off", "all", "one"].includes(String(intent.repeat))
  )
    throw new Error("Invalid TV queue.");
  if (
    intent.queueId &&
    (!id(intent.queueId) ||
      !Number.isInteger(intent.queueOffset) ||
      !Number.isInteger(intent.queueTotal) ||
      Number(intent.queueTotal) > 10000 ||
      Number(intent.queueTotal) < intent.queue.length ||
      Number(intent.queueOffset) < 0)
  )
    throw new Error("Invalid paged TV queue.");
  if (
    intent.queue.some(
      (q) => !q || typeof q !== "object" || !id(q.entryId) || !id(q.contentId)
    )
  )
    throw new Error("Invalid TV queue entry.");
  if (r.phase === "active" || r.phase === "ready") {
    if (
      !id(snap.generation) ||
      typeof snap.position !== "number" ||
      !Number.isFinite(snap.position) ||
      snap.position < 0 ||
      typeof snap.duration !== "number" ||
      !Number.isFinite(snap.duration) ||
      snap.duration < 0 ||
      !Number.isInteger(snap.queueIndex) ||
      Number(snap.queueIndex) < 0 ||
      Number(snap.queueIndex) >=
        Number(intent.queueTotal || intent.queue.length) ||
      typeof snap.seekable !== "boolean" ||
      ![
        "idle",
        "preparing",
        "ready",
        "playing",
        "paused",
        "ended",
        "failed"
      ].includes(String(snap.phase))
    )
      throw new Error("Invalid TV playback state.");
  }
  return r as unknown as Connection;
}
export function eligible(receiver: Receiver, kind: "music" | "videos") {
  return (
    receiver.online &&
    receiver.enabled &&
    receiver.protocol === 1 &&
    receiver.capabilities.silentPrepare &&
    receiver.capabilities[kind]
  );
}
export function playbackStorageKey(owner: string) {
  return "ohai:roku-connection:" + JSON.stringify(owner);
}
