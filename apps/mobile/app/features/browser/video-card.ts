const availabilityMessage = "ohai-video-card-availability";

export function readVideoCardAvailability(data: string): boolean | undefined {
  if (typeof data !== "string" || data.length > 200) return;
  try {
    const message = JSON.parse(data);
    if (
      message?.type === availabilityMessage &&
      typeof message.available === "boolean"
    ) {
      return message.available;
    }
  } catch {
    // Pages can send unrelated messages on the same bridge.
  }
}

export function setVideoCardMode(enabled: boolean) {
  return `window.__ohaiSetVideoCardMode?.(${enabled}); true;`;
}

// Each frame can control its own DOM. If a player is embedded cross-origin,
// its ancestors crop the iframe while the player's frame crops the video.
// Keeping the original elements mounted preserves the player and its position.
export const videoCardScript = `
  (() => {
    if (!HTMLElement.prototype.showPopover) return;

    const channel = "ohai-video-card";
    const modeAttribute = "data-ohai-video-card-mode";
    const previewAttribute = "data-ohai-video-card-player";
    const top = window === window.top;
    const candidates = new Set();
    let enabled = false;
    let available = false;
    let presented;
    let restorePresented;

    // CSSOM property writes also work on pages that disallow inline style tags.
    function applyStyles(element, styles) {
      if (!element) return;
      const previous = Object.entries(styles).map(([property, value]) => {
        const oldValue = element.style.getPropertyValue(property);
        const priority = element.style.getPropertyPriority(property);
        element.style.setProperty(property, value, "important");
        return [property, oldValue, priority];
      });
      return () => {
        for (const [property, value, priority] of previous) {
          if (value) element.style.setProperty(property, value, priority);
          else element.style.removeProperty(property);
        }
      };
    }

    function report(next, started) {
      if (next === available && (top || !started)) return;
      if (top) {
        if (!window.ReactNativeWebView) return;
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: "${availabilityMessage}",
          available: next
        }));
      } else {
        window.parent.postMessage({ channel, available: next, started }, "*");
      }
      available = next;
    }

    function setFrameMode(frame, next) {
      frame.contentWindow?.postMessage({ channel, enabled: next }, "*");
    }

    function updatePreview(candidate) {
      const next = enabled ? candidate : undefined;
      if (next === presented) return;
      restorePresented?.();
      presented = undefined;
      restorePresented = undefined;
      document.documentElement?.removeAttribute(modeAttribute);
      if (!next) return;

      const previousPopover = next.getAttribute("popover");
      const wasOpen = next.matches(":popover-open");
      if (!wasOpen) {
        next.setAttribute("popover", "manual");
        try {
          next.showPopover();
        } catch {
          if (previousPopover === null) next.removeAttribute("popover");
          else next.setAttribute("popover", previousPopover);
          return;
        }
      }

      present(next, previousPopover, wasOpen);
    }

    function present(next, previousPopover, wasOpen) {
      const isVideo = next instanceof HTMLVideoElement;
      const previousControls = isVideo ? next.controls : undefined;
      next.setAttribute(previewAttribute, "");
      document.documentElement?.setAttribute(modeAttribute, "");
      const restoreLayout = applyStyles(next, {
        position: "fixed", top: "0", right: "0", bottom: "0", left: "0",
        "box-sizing": "border-box", width: "100%", height: "100%",
        "min-width": "0", "min-height": "0", "max-width": "none", "max-height": "none",
        transform: "none", margin: "0", "border-width": "0", "border-radius": "0",
        padding: "0", "object-fit": "contain", "object-position": "center",
        "background-color": "black"
      });
      const restoreScroll = applyStyles(document.documentElement, { overflow: "hidden" });
      const restoreExpandControl = applyStyles(
        document.querySelector("[data-ohai-collapse-video]"),
        { visibility: "hidden" }
      );
      if (isVideo) next.controls = true;
      else setFrameMode(next, true);
      presented = next;

      restorePresented = () => {
        if (isVideo) next.controls = previousControls;
        else setFrameMode(next, false);
        restoreLayout?.();
        restoreScroll?.();
        restoreExpandControl?.();
        if (!wasOpen) {
          if (next.matches(":popover-open")) next.hidePopover();
          if (previousPopover === null) next.removeAttribute("popover");
          else next.setAttribute("popover", previousPopover);
        }
        next.removeAttribute(previewAttribute);
      };
    }

    function update(started = false) {
      for (const candidate of candidates) {
        if (!candidate.isConnected) candidates.delete(candidate);
      }
      const candidate = Array.from(candidates).pop();
      updatePreview(candidate);
      report(!!candidate, started);
    }

    function record(candidate, playable, started) {
      if (!playable || started) candidates.delete(candidate);
      if (playable) candidates.add(candidate);
      update(started);
    }

    function trackVideo(event) {
      const video = event.target;
      if (!(video instanceof HTMLVideoElement)) return;
      if (video.ended || event.type === "emptied") {
        record(video, false, false);
      } else if (video.videoWidth > 0 && (!video.paused || candidates.has(video))) {
        record(video, true, event.type === "playing");
      }
    }

    function updateMode(next) {
      enabled = next;
      update();
    }
    if (top) window.__ohaiSetVideoCardMode = updateMode;

    window.addEventListener("message", (event) => {
      const data = event.data;
      if (data?.channel !== channel) return;
      if (!top && event.source === window.parent && typeof data.enabled === "boolean") {
        updateMode(data.enabled);
        return;
      }
      if (typeof data.available !== "boolean") return;
      const frame = Array.from(document.querySelectorAll("iframe")).find(
        (item) => item.contentWindow === event.source
      );
      if (frame) record(frame, data.available, data.started === true);
    });

    for (const event of ["play", "playing", "pause", "loadedmetadata", "ended", "emptied"]) {
      document.addEventListener(event, trackVideo, true);
    }
    new MutationObserver(() => {
      if (Array.from(candidates).some((candidate) => !candidate.isConnected)) update();
    }).observe(document, { childList: true, subtree: true });
    window.addEventListener("pagehide", (event) => {
      if (!event.persisted) candidates.clear();
      updateMode(false);
      report(false, false);
    });
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) update();
    });
  })();
  true;
`;
