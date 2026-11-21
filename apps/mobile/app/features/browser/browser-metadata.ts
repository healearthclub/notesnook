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
import { blockedBrowserHost } from "./browser-guard";

const prefix = "ohai-browser-metadata:";

export function faviconForAddress(address: string, declared?: string) {
  try {
    const page = new URL(address);
    if (!/^https?:$/.test(page.protocol) || blockedBrowserHost(page.href))
      return;
    const icon = new URL(declared || "/favicon.ico", page);
    if (
      icon.origin === page.origin &&
      !icon.username &&
      !icon.password &&
      !/\.svgz?$/i.test(icon.pathname) &&
      icon.href.length <= 2048
    ) {
      return icon.href;
    }
  } catch {
    return;
  }
}

export const observeBrowserMetadata = `
(() => {
  if (window.__ohaiBrowserMetadata || !document.head) return;
  window.__ohaiBrowserMetadata = true;
  let lastMessage;
  function report() {
    const icon = Array.from(document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]'))
      .find(link => {
        if (!link.getAttribute("href") || link.type === "image/svg+xml") return false;
        try {
          const url = new URL(link.href);
          return url.origin === location.origin && !/\\.svgz?$/i.test(url.pathname);
        } catch {
          return false;
        }
      });
    const message = JSON.stringify({
      address: location.href,
      title: document.title.slice(0, 240),
      favicon: icon?.href.slice(0, 2048)
    });
    if (message === lastMessage || !window.ReactNativeWebView) return;
    lastMessage = message;
    window.ReactNativeWebView.postMessage(${JSON.stringify(prefix)} + message);
  }
  report();
  new MutationObserver(report).observe(document.head, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["href", "rel", "type"]
  });
  window.addEventListener("hashchange", report);
  window.addEventListener("popstate", report);
})();
true;
`;

export function readBrowserMetadata(data: string, address: string) {
  if (!data.startsWith(prefix) || data.length > 20000) return;
  try {
    const message = JSON.parse(data.slice(prefix.length));
    if (new URL(message.address).href !== new URL(address).href) return;
    return {
      title:
        typeof message.title === "string"
          ? message.title.slice(0, 240)
          : undefined,
      favicon: faviconForAddress(
        address,
        typeof message.favicon === "string" ? message.favicon : undefined
      )
    };
  } catch {
    return;
  }
}
