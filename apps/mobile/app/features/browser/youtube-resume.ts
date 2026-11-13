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
import { MMKV } from "../../common/database/mmkv";
import type { YouTubePlayback } from "./youtube-playback";

const storageKey = "nn::youtubeResume";

export type YouTubeResume = YouTubePlayback & { videoId: string };

export function readYouTubeResume() {
  const saved = MMKV.getMap<YouTubeResume>(storageKey);
  if (
    !saved ||
    typeof saved.videoId !== "string" ||
    !/^[A-Za-z0-9_-]{11}$/.test(saved.videoId) ||
    typeof saved.title !== "string" ||
    !Number.isSafeInteger(saved.position) ||
    saved.position < 0 ||
    !Number.isFinite(saved.progress)
  )
    return undefined;

  return { ...saved, playing: false };
}

export function saveYouTubeResume(saved?: YouTubeResume) {
  if (saved) MMKV.setMap(storageKey, saved);
  else MMKV.removeItem(storageKey);
}

export function resumeYouTubeAddress({ videoId, position }: YouTubeResume) {
  const url = new URL("https://m.youtube.com/watch");
  url.searchParams.set("v", videoId);
  if (position > 0) url.searchParams.set("t", position.toString());
  return url.href;
}
