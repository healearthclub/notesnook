/* Heal Earth native React portals. GPL-3.0-or-later. */
import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
const entries = new Map<HTMLElement, { node: ReactNode; key: number }>();
const listeners = new Set<() => void>();
let sequence = 0;
let snapshot: Array<{ container: HTMLElement; node: ReactNode; key: number }> =
  [];
function publish() {
  snapshot = Array.from(entries, ([container, value]) => ({
    container,
    ...value
  }));
  listeners.forEach((listener) => listener());
}
export function renderNativePortal(container: HTMLElement, node: ReactNode) {
  entries.set(container, {
    node,
    key: entries.get(container)?.key ?? ++sequence
  });
  publish();
}
export function unmountNativePortal(container: HTMLElement) {
  entries.delete(container);
  publish();
}
export function NativePortals() {
  const portals = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => snapshot,
    () => snapshot
  );
  return (
    <>
      {portals.map(({ container, node, key }) =>
        createPortal(node, container, String(key))
      )}
    </>
  );
}

export function clearNativePortals() {
  entries.clear();
  publish();
}
