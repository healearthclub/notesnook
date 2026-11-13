export const inlineVideoScript = `
  (() => {
    let expanded;
    let controlsBeforeExpand;
    let collapseButton;

    function collapseVideo() {
      if (!expanded) return;
      const video = expanded;
      expanded = undefined;
      if (video.matches(":popover-open")) video.hidePopover();
      video.removeAttribute("popover");
      video.removeAttribute("data-ohai-expanded-video");
      video.controls = controlsBeforeExpand;
      collapseButton.remove();
    }

    function expandVideo(video) {
      if (video === expanded) return;
      collapseVideo();
      controlsBeforeExpand = video.controls;
      video.controls = true;
      video.setAttribute("popover", "manual");
      video.setAttribute("data-ohai-expanded-video", "");
      video.showPopover();
      expanded = video;

      collapseButton = document.createElement("button");
      collapseButton.type = "button";
      collapseButton.textContent = "Exit expanded video";
      collapseButton.setAttribute("popover", "manual");
      collapseButton.setAttribute("data-ohai-collapse-video", "");
      collapseButton.addEventListener("click", collapseVideo);
      document.body.append(collapseButton);
      collapseButton.showPopover();
    }

    function allowInlineVideo(element) {
      if (!(element instanceof HTMLVideoElement)) return;
      element.playsInline = true;
      element.setAttribute("webkit-playsinline", "");
    }

    function updateVideos(node) {
      allowInlineVideo(node);
      node.querySelectorAll?.("video").forEach(allowInlineVideo);
    }

    updateVideos(document);
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) updateVideos(node);
      }
      if (expanded && !expanded.isConnected) collapseVideo();
    }).observe(document, { childList: true, subtree: true });

    if (!HTMLElement.prototype.showPopover) return;
    const style = document.createElement("style");
    style.textContent = \`
      video[data-ohai-expanded-video] {
        position: fixed !important;
        inset: 0 !important;
        width: 100% !important;
        height: 100% !important;
        max-width: none !important;
        max-height: none !important;
        transform: none !important;
        margin: 0 !important;
        border: 0 !important;
        border-radius: 0 !important;
        padding: 0 !important;
        object-fit: contain !important;
        background: black !important;
      }
      button[data-ohai-collapse-video] {
        position: fixed !important;
        inset: 12px 12px auto auto !important;
        margin: 0 !important;
        padding: 12px !important;
        border: 1px solid #666 !important;
        border-radius: 20px !important;
        background: #202020 !important;
        color: white !important;
        font: 14px system-ui !important;
      }
    \`;
    function installStyles() {
      (document.head || document.documentElement).append(style);
    }
    if (document.documentElement) installStyles();
    else document.addEventListener("DOMContentLoaded", installStyles, { once: true });

    const setPresentationMode = HTMLVideoElement.prototype.webkitSetPresentationMode;
    if (setPresentationMode) {
      HTMLVideoElement.prototype.webkitSetPresentationMode = function (mode) {
        if (mode === "fullscreen") expandVideo(this);
        else setPresentationMode.call(this, mode);
      };
    }
    for (const name of ["webkitEnterFullscreen", "webkitEnterFullScreen"]) {
      if (HTMLVideoElement.prototype[name]) {
        HTMLVideoElement.prototype[name] = function () { expandVideo(this); };
      }
    }
    for (const name of ["requestFullscreen", "webkitRequestFullscreen", "webkitRequestFullScreen"]) {
      const original = Element.prototype[name];
      if (!original) continue;
      Element.prototype[name] = function (...args) {
        const video = this instanceof HTMLVideoElement ? this : this.querySelector("video");
        if (!video) return original.apply(this, args);
        expandVideo(video);
        if (name === "requestFullscreen") return Promise.resolve();
      };
    }

    document.addEventListener("webkitbeginfullscreen", (event) => {
      const video = event.target;
      if (!(video instanceof HTMLVideoElement)) return;
      video.webkitExitFullscreen();
      expandVideo(video);
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") collapseVideo();
    });

    if (location.hostname === "youtube.com" || location.hostname.endsWith(".youtube.com")) {
      document.addEventListener("click", (event) => {
        const button = event.target.closest?.(".ytp-fullscreen-button, .fullscreen-icon, button[aria-label='Full screen'], button[aria-label='Fullscreen']");
        const video = button?.closest("#movie_player, .html5-video-player, ytm-player, #player")?.querySelector("video")
          || (button && document.querySelector("video.html5-main-video"));
        if (!video) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        expandVideo(video);
      }, true);
    }
  })();
  true;
`;
