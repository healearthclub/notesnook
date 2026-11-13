/*
This file is part of the Notesnook project (https://notesnook.com/)

Copyright (C) 2023 Streetwriters (Private) Limited

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
export type YouTubePlayback = {
  title: string;
  playing: boolean;
  progress: number;
  position: number;
};

export type YouTubeSession = {
  id: number;
  videoId: string;
};

function isYouTubeUrl(url: URL) {
  return (
    url.protocol === "https:" &&
    ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)
  );
}

function parseYouTubeUrl(address: string) {
  try {
    const url = new URL(address);
    if (isYouTubeUrl(url)) return url;
  } catch {
    // WebView errors and untrusted messages may have an invalid URL.
  }
}

export function getYouTubeVideoId(address: string) {
  const url = parseYouTubeUrl(address);
  if (!url) return;
  const id =
    url.pathname === "/watch"
      ? url.searchParams.get("v")
      : /^\/(?:shorts|live)\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : undefined;
}

export function readYouTubePlayback(
  data: string,
  frameAddress: string,
  session: YouTubeSession
): YouTubePlayback | "ended" | null | undefined {
  if (!parseYouTubeUrl(frameAddress) || data.length > 2000) return;
  try {
    const message = JSON.parse(data);
    if (
      message?.type !== "ohai-youtube-playback" ||
      message.session !== session.id ||
      message.videoId !== session.videoId
    ) {
      return;
    }
    const playback = message.playback;
    if (playback === null) return message.ended === true ? "ended" : null;
    if (
      typeof playback?.title !== "string" ||
      typeof playback.playing !== "boolean" ||
      typeof playback.progress !== "number" ||
      !Number.isFinite(playback.progress) ||
      !Number.isSafeInteger(playback.position) ||
      playback.position < 0
    ) {
      return;
    }
    return {
      title: playback.title.trim().slice(0, 160) || "YouTube video",
      playing: playback.playing,
      progress: Math.max(0, Math.min(1, playback.progress)),
      position: playback.position
    };
  } catch {
    // Pages may send unrelated messages through the WebView bridge.
  }
}

export function observeYouTubePlayback(
  session: YouTubeSession,
  resumePosition = 0
) {
  return `
  (() => {
    if (window.top !== window ||
        location.protocol !== "https:" ||
        !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(location.hostname)) return;

    const session = ${JSON.stringify(session)};
    window.__ohaiYouTubePlayback?.dispose();
    const events = ["play", "playing", "pause", "timeupdate", "loadedmetadata", "emptied", "ended"];
    let pendingPosition = ${JSON.stringify(resumePosition)};
    let trackedVideo;
    let lastMessage;

    function currentVideoId() {
      if (location.pathname === "/watch") {
        return new URLSearchParams(location.search).get("v");
      }
      return /^\\/(?:shorts|live)\\/([^/]+)\\/?$/.exec(location.pathname)?.[1];
    }

    function send(playback, ended = false) {
      const data = JSON.stringify({
        type: "ohai-youtube-playback",
        session: session.id,
        videoId: session.videoId,
        playback,
        ended
      });
      if (data === lastMessage || !window.ReactNativeWebView) return;
      lastMessage = data;
      window.ReactNativeWebView.postMessage(data);
    }

    function isPlayer(video) {
      return video instanceof HTMLVideoElement &&
        (video.matches(".html5-main-video") || video.closest("#movie_player, ytm-player, #player"));
    }

    function report(event) {
      if (currentVideoId() !== session.videoId) {
        trackedVideo = undefined;
        send(null);
        return;
      }

      const video = event?.target;
      if (isPlayer(video) && !video.paused && !video.ended) trackedVideo = video;
      if (!trackedVideo?.isConnected || trackedVideo.ended || event?.type === "emptied" && video === trackedVideo) {
        const ended = trackedVideo?.ended === true;
        trackedVideo = undefined;
        send(null, ended);
        return;
      }
      if (video && video !== trackedVideo) return;
      if (document.querySelector("#movie_player.ad-showing, #movie_player.ad-interrupting")) return;

      const duration = trackedVideo.duration;
      if (pendingPosition > 0) {
        if (!Number.isFinite(duration) || duration <= 0 || !trackedVideo.seekable.length) return;
        const position = Math.min(pendingPosition, Math.max(0, duration - 0.5));
        if (trackedVideo.currentTime < position - 1) {
          try {
            trackedVideo.currentTime = position;
          } catch {
            return;
          }
        }
        pendingPosition = 0;
      }
      const title = document.title.replace(/ - YouTube$/, "").trim();
      const progress = Number.isFinite(duration) && duration > 0
        ? Math.floor(100 * trackedVideo.currentTime / duration) / 100
        : 0;
      const position = Number.isFinite(trackedVideo.currentTime)
        ? Math.max(0, Math.floor(trackedVideo.currentTime))
        : 0;
      send({ title: title.slice(0, 160), playing: !trackedVideo.paused, progress, position });
    }

    function onPageHide() {
      report();
    }

    const observer = new MutationObserver(() => {
      if (trackedVideo && !trackedVideo.isConnected) report();
    });
    observer.observe(document, { childList: true, subtree: true });
    for (const event of events) document.addEventListener(event, report, true);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onPageHide);

    window.__ohaiYouTubePlayback = {
      toggle(expectedSession, shouldPlay) {
        if (session.id !== expectedSession || currentVideoId() !== session.videoId ||
            !trackedVideo?.isConnected || trackedVideo.ended) return;
        if (shouldPlay) trackedVideo.play().catch(() => report());
        else trackedVideo.pause();
      },
      dispose() {
        observer.disconnect();
        for (const event of events) document.removeEventListener(event, report, true);
        window.removeEventListener("pagehide", onPageHide);
        document.removeEventListener("visibilitychange", onPageHide);
      }
    };

    const playingVideo = Array.from(document.querySelectorAll("video")).find(
      (video) => isPlayer(video) && !video.paused && !video.ended
    );
    if (playingVideo) report({ target: playingVideo });
  })();
  true;
  `;
}

export function toggleYouTubePlayback(
  session: YouTubeSession,
  shouldPlay: boolean
) {
  return `window.__ohaiYouTubePlayback?.toggle(${session.id}, ${shouldPlay}); true;`;
}
