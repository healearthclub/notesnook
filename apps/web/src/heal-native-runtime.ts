/* Heal Earth native component integration. GPL-3.0-or-later. */
export type NativeContext = {
  namespace: string;
  surface: HTMLElement;
  shadow: ShadowRoot;
  active: boolean;
};
let context: NativeContext;
const navigationEvents = new EventTarget();
let routeURL: URL;
let historyIndex = 0;
let historyEntries: Array<{ href: string; state: any }> = [];
export function configureNativeContext(value: NativeContext) {
  context = value;
  routeURL = new URL("/notes", window.location.origin);
  if (window.location.pathname === "/notes") {
    routeURL.search = window.location.search;
    routeURL.hash = window.location.hash;
  }
  historyIndex = 0;
  historyEntries = [{ href: routeURL.href, state: {} }];
}
export function getNativeContext() {
  if (!context) throw Error("Notes runtime is not configured.");
  return context;
}
const storageKeys = () =>
  Array.from({ length: window.localStorage.length }, (_, i) =>
    window.localStorage.key(i)!
  ).filter((k) => k?.startsWith(context.namespace));
export const notesLocalStorage = {
  get length() {
    return storageKeys().length;
  },
  key(i: number) {
    return storageKeys()[i]?.slice(context.namespace.length) ?? null;
  },
  getItem(k: string) {
    return window.localStorage.getItem(context.namespace + k);
  },
  setItem(k: string, v: string) {
    window.localStorage.setItem(context.namespace + k, String(v));
  },
  removeItem(k: string) {
    window.localStorage.removeItem(context.namespace + k);
  },
  clear() {
    for (const k of storageKeys()) window.localStorage.removeItem(k);
  }
} as Storage;
export const notesIndexedDB = new Proxy({} as IDBFactory, {
  get(_, key) {
    if (key === "open")
      return (name: string, version?: number) =>
        window.indexedDB.open(context.namespace + name, version);
    if (key === "deleteDatabase")
      return (name: string) =>
        window.indexedDB.deleteDatabase(context.namespace + name);
    const value = (window.indexedDB as any)[key];
    return typeof value === "function" ? value.bind(window.indexedDB) : value;
  }
});
const listenerMap = new Map<any, Map<any, any>>();
function listen(type: string, callback: any, options?: any) {
  if (type === "popstate" || type === "hashchange")
    return navigationEvents.addEventListener(type, callback, options);
  const wrap = (event: Event) => {
    if (!context?.active) return;
    if (
      [
        "keydown",
        "keyup",
        "keypress",
        "paste",
        "copy",
        "cut",
        "input",
        "pointerdown",
        "mousedown",
        "click",
        "contextmenu"
      ].includes(type) &&
      !event.composedPath().includes(context.surface) &&
      !event.composedPath().includes(context.shadow.host)
    )
      return;
    const scopedEvent = new Proxy(event, {
      get(target, key) {
        if (key === "target" || key === "srcElement")
          return event.composedPath()[0] ?? event.target;
        if (key === "currentTarget") return notesDocument;
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    typeof callback === "function"
      ? callback(scopedEvent)
      : callback.handleEvent(scopedEvent);
  };
  let map = listenerMap.get(type);
  if (!map) listenerMap.set(type, (map = new Map()));
  map.set(callback, wrap);
  document.addEventListener(type, wrap, options);
}
function unlisten(type: string, callback: any, options?: any) {
  if (type === "popstate" || type === "hashchange")
    return navigationEvents.removeEventListener(type, callback, options);
  const map = listenerMap.get(type),
    wrap = map?.get(callback);
  if (wrap) {
    document.removeEventListener(type, wrap, options);
    map?.delete(callback);
  }
}
export const notesDocument = new Proxy({} as Document, {
  has: (_, key) => key in document,
  get(_, key) {
    const c = getNativeContext();
    if (key === "body" || key === "documentElement") return c.surface;
    if (key === "head") return c.shadow;
    if (key === "activeElement") return c.shadow.activeElement;
    if (key === "getElementById")
      return (id: string) => c.shadow.getElementById(id);
    if (key === "querySelector")
      return (selector: string) =>
        selector === "html" || selector === "body"
          ? c.surface
          : c.shadow.querySelector(selector);
    if (key === "querySelectorAll")
      return (selector: string) => c.shadow.querySelectorAll(selector);
    if (key === "addEventListener") return listen;
    if (key === "removeEventListener") return unlisten;
    if (key === "getSelection")
      return () =>
        (c.shadow as any).getSelection?.() ?? document.getSelection();
    if (key === "defaultView") return notesWindow;
    const value = (document as any)[key];
    return typeof value === "function" ? value.bind(document) : value;
  },
  set(_, key, value) {
    if (key === "title") return true;
    (document as any)[key] = value;
    return true;
  }
});
const virtualLocation = new Proxy({} as Location, {
  get(_, key) {
    if (key === "reload") return () => window.location.reload();
    const value = (routeURL as any)[key];
    return typeof value === "function" ? value.bind(routeURL) : value;
  },
  set(_, key, value) {
    (routeURL as any)[key] = value;
    return true;
  }
});
const virtualHistory = {
  pushState(data: any, _unused: string, url?: string | URL | null) {
    if (url) routeURL = new URL(url, routeURL);
    historyEntries.splice(historyIndex + 1);
    historyEntries.push({ href: routeURL.href, state: data ?? {} });
    historyIndex++;
  },
  replaceState(data: any, _unused: string, url?: string | URL | null) {
    if (url) routeURL = new URL(url, routeURL);
    historyEntries[historyIndex] = { href: routeURL.href, state: data ?? {} };
  },
  get state() {
    return historyEntries[historyIndex]?.state ?? {};
  },
  get length() {
    return historyEntries.length;
  },
  go(delta = 0) {
    const next = Math.min(
      historyEntries.length - 1,
      Math.max(0, historyIndex + delta)
    );
    if (next === historyIndex) return;
    historyIndex = next;
    routeURL = new URL(historyEntries[next].href);
    navigationEvents.dispatchEvent(new PopStateEvent("popstate"));
    navigationEvents.dispatchEvent(new HashChangeEvent("hashchange"));
  },
  back() {
    virtualHistory.go(-1);
  },
  forward() {
    virtualHistory.go(1);
  }
};
export const notesHistory = virtualHistory;

function containerMedia(query: string): MediaQueryList {
  if (!/(min|max)-width/.test(query)) return window.matchMedia(query);
  const target = new EventTarget();
  const matches = () =>
    Array.from(query.matchAll(/(min|max)-width:\s*([\d.]+)px/g)).every(
      ([, kind, value]) =>
        kind === "min"
          ? context.surface.clientWidth >= Number(value)
          : context.surface.clientWidth <= Number(value)
    );
  let last = matches();
  const observer = new ResizeObserver(() => {
    const next = matches();
    if (next !== last) {
      last = next;
      target.dispatchEvent(new Event("change"));
    }
  });
  const result = {
    media: query,
    get matches() {
      return matches();
    },
    onchange: null,
    addEventListener(type: string, fn: any) {
      target.addEventListener(type, fn);
      observer.observe(context.shadow.host);
    },
    removeEventListener(type: string, fn: any) {
      target.removeEventListener(type, fn);
      observer.disconnect();
    },
    addListener(fn: any) {
      result.addEventListener("change", fn);
    },
    removeListener(fn: any) {
      result.removeEventListener("change", fn);
    },
    dispatchEvent: (event: Event) => target.dispatchEvent(event)
  };
  return result as MediaQueryList;
}
const windowFunctions = new WeakMap<Function, Function>();
export const notesWindow = new Proxy({} as Window, {
  has: (_, key) =>
    key in window ||
    key === "__HEAL_NOTES_NAMESPACE__" ||
    key === "__HEAL_NOTES_LOCAL__",
  get(_, key) {
    if (key === "self" || key === "window" || key === "parent" || key === "top")
      return notesWindow;
    if (key === "hasNativeTitlebar") return true;
    if (key === "document") return notesDocument;
    if (key === "localStorage") return notesLocalStorage;
    if (key === "indexedDB") return notesIndexedDB;
    if (key === "location") return virtualLocation;
    if (key === "matchMedia") return containerMedia;
    if (key === "innerWidth") return context.surface.clientWidth;
    if (key === "innerHeight") return context.surface.clientHeight;
    if (key === "history") return virtualHistory;
    if (key === "__HEAL_NOTES_NAMESPACE__") return context.namespace;
    if (key === "__HEAL_NOTES_LOCAL__") return true;
    if (key === "addEventListener")
      return (type: string, fn: any, opts?: any) =>
        type === "popstate" || type === "hashchange"
          ? navigationEvents.addEventListener(type, fn, opts)
          : window.addEventListener(type, fn, opts);
    if (key === "removeEventListener")
      return (type: string, fn: any, opts?: any) =>
        type === "popstate" || type === "hashchange"
          ? navigationEvents.removeEventListener(type, fn, opts)
          : window.removeEventListener(type, fn, opts);
    if (key === "open")
      return (url: string | URL, target?: string) => {
        if (target === "_self") {
          routeURL = new URL(url, routeURL);
          navigationEvents.dispatchEvent(new PopStateEvent("popstate"));
          navigationEvents.dispatchEvent(new HashChangeEvent("hashchange"));
          return null;
        }
        return window.open(url, target);
      };
    const value = (window as any)[key];
    if (typeof value !== "function") return value;
    let bound = windowFunctions.get(value);
    if (!bound) {
      bound = new Proxy(value, {
        apply(target, _receiver, args) {
          return Reflect.apply(target, window, args);
        }
      });
      windowFunctions.set(value, bound);
    }
    return bound;
  },
  set(_, key, value) {
    (window as any)[key] = value;
    return true;
  }
});
export const notesDispatchEvent = (event: Event) =>
  navigationEvents.dispatchEvent(event);

export const notesHasNativeTitlebar = true;
