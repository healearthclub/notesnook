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
const knownBlockedDomains = ["privbrsr.com"];
const youtube = "youtube";

function isHostOrSubdomain(host: string, domain: string) {
  return host === domain || host.endsWith("." + domain);
}

function resemblesYouTube(label: string) {
  const candidate = label.replace(/-/g, "");
  if (candidate.length === youtube.length) {
    const differences = Array.from(candidate)
      .map((letter, index) => (letter === youtube[index] ? -1 : index))
      .filter((index) => index !== -1);
    if (differences.length < 2) return true;
    const [first, second] = differences;
    return (
      differences.length === 2 &&
      second === first + 1 &&
      candidate[first] === youtube[second] &&
      candidate[second] === youtube[first]
    );
  }
  if (Math.abs(candidate.length - youtube.length) !== 1) return false;
  const longer = candidate.length > youtube.length ? candidate : youtube;
  const shorter = candidate.length > youtube.length ? youtube : candidate;
  return Array.from(longer).some(
    (_, index) => longer.slice(0, index) + longer.slice(index + 1) === shorter
  );
}

export function isYouTubeLookalike(host: string) {
  if (
    isHostOrSubdomain(host, "youtube.com") ||
    isHostOrSubdomain(host, "youtu.be") ||
    isHostOrSubdomain(host, "youtube-nocookie.com")
  )
    return false;
  if (/(^|\.)youtube\.com\./.test(host)) return true;
  const labels = host.split(".");
  const label = labels[labels.length - 2];
  return (
    !!label &&
    /^(com|co|cm|con|cmo|om)$/.test(labels[labels.length - 1]) &&
    resemblesYouTube(label)
  );
}

export function blockedBrowserHost(address: string) {
  let host: string;
  try {
    host = new URL(address).hostname.toLowerCase().replace(/\.+$/, "");
  } catch {
    return;
  }
  if (
    knownBlockedDomains.some((domain) => isHostOrSubdomain(host, domain)) ||
    isYouTubeLookalike(host)
  )
    return host;
}
