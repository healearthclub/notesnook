/* Imperative editor widgets stay inside the host React tree. GPL-3.0-or-later. */
import type { Root } from "react-dom/client";
import { renderNativePortal, unmountNativePortal } from "./heal-native-portals";
export function createRoot(container: HTMLElement): Root {
  return {
    render(node) {
      renderNativePortal(container, node);
    },
    unmount() {
      unmountNativePortal(container);
    }
  };
}
