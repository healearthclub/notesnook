import { clearNativePortals } from "./heal-native-portals";
/* Heal Earth native React workspace. GPL-3.0-or-later. */
import type { ComponentType } from "react";
import {
  configureNativeContext,
  getNativeContext,
  notesLocalStorage
} from "./heal-native-runtime";
export type Palette = { dark: boolean; colors: Record<string, string> };
let currentNamespace: string | undefined,
  prepared: Promise<ComponentType> | undefined;
let releaseLock: (() => void) | undefined;
let active = false;
let viewGeneration = 0;
let verifyInstalled = false;
let nativeSurface: HTMLDivElement | undefined;
let shadow: ShadowRoot | undefined;
export async function prepareNativeNotes(
  host: HTMLElement,
  cssURLs: string[]
): Promise<{
  Component: ComponentType;
  surface: HTMLElement;
  shadow: ShadowRoot;
  detach: () => void;
  setTheme: (p: Palette) => Promise<void>;
}> {
  const generation = ++viewGeneration;
  const response = await fetch("/api/private-notes/context", {
    cache: "no-store",
    credentials: "same-origin"
  });
  if (!response.ok) throw Error("Sign in to Heal Earth to open your notes.");
  const { namespace } = await response.json();
  if (!/^heal-notes-[a-f0-9]{64}-$/.test(namespace))
    throw Error("Invalid Notes session.");
  if (currentNamespace && currentNamespace !== namespace) {
    window.location.reload();
    throw Error("Reloading Notes for the current account.");
  }
  if (!nativeSurface) {
    const shell = document.createElement("div");
    shell.style.cssText = "width:100%;height:100%;min-height:0";
    shadow = shell.attachShadow({ mode: "open" });
    nativeSurface = document.createElement("div");
    nativeSurface.className = "theme-scope-base";
    nativeSurface.style.cssText =
      "position:relative;width:100%;height:100%;overflow:hidden;font-family:Inter,system-ui,sans-serif";
    const scopedStyles = document.createElement("style");
    scopedStyles.textContent =
      ":host{display:block;height:100%;min-height:0}#root{height:100%;width:100%;display:flex;flex-direction:column}*{box-sizing:border-box}";
    shadow.append(scopedStyles);
    for (const href of cssURLs) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      shadow.append(link);
    }
    const style = document.createElement("style");
    style.id = "theme-colors";
    shadow.append(style);
    nativeSurface.innerHTML =
      '<div id="root"></div><div id="dialogContainer"></div><div id="floatingViewContainer"></div>';
    shadow.append(nativeSurface);
    currentNamespace = namespace;
    configureNativeContext({
      namespace,
      surface: nativeSurface,
      shadow,
      active: true
    });
  }
  host.replaceChildren(shadow!.host);
  active = true;
  getNativeContext().active = true;
  prepared ??= (async () => {
    if (!navigator.locks)
      throw Error("Notes requires a browser with Web Locks support.");
    await new Promise<void>((resolve, reject) => {
      navigator.locks
        .request(
          namespace + "workspace",
          {
            ifAvailable: true,
            mode: typeof SharedWorker !== "undefined" ? "shared" : "exclusive"
          },
          (lock) => {
            if (!lock) {
              reject(
                Error(
                  "An earlier Notes view is still open. Close that view and try again; your notes are preserved."
                )
              );
              return;
            }
            resolve();
            return new Promise<void>((r) => {
              releaseLock = r;
            });
          }
        )
        .catch(reject);
    });
    notesLocalStorage.setItem("skipInitiation", "true");
    notesLocalStorage.setItem("followSystemTheme", "false");
    notesLocalStorage.setItem(
      "colorScheme",
      JSON.stringify(
        document.documentElement.dataset.theme === "dark" ||
          document.documentElement.dataset.themeTone === "dark"
          ? "dark"
          : "light"
      )
    );
    await import("./polyfills");
    const { initLocale } = await import("./common/locale");
    await initLocale();
    const { init } = await import("./bootstrap");
    const data = await init();
    const { isFeatureSupported } = await import("./utils/feature-check");
    if (
      !isFeatureSupported("indexedDB") ||
      !isFeatureSupported("clonableCryptoKey")
    )
      throw Error(
        "This browser cannot open your existing private Notes storage safely. No data has been changed."
      );
    const { useKeyStore } = await import("./interfaces/key-store");
    await useKeyStore.getState().init({ persistence: data.persistence });
    const { createNativeWorkspace } = await import("./heal-native-workspace");
    return createNativeWorkspace(data, shadow!);
  })().catch((error) => {
    prepared = undefined;
    releaseLock?.();
    releaseLock = undefined;
    throw error;
  });
  const Component = await prepared;
  if (!verifyInstalled) {
    verifyInstalled = true;
    const verify = async () => {
      if (!active) return;
      try {
        const r = await fetch("/api/private-notes/context", {
          cache: "no-store"
        });
        if (!r.ok || (await r.json()).namespace !== currentNamespace) {
          getNativeContext().active = false;
          window.location.reload();
        }
      } catch {
        /* Offline editing remains available. */
      }
    };
    window.addEventListener("focus", verify);
    window.addEventListener("online", verify);
    setInterval(verify, 30000);
  }
  return {
    Component,
    surface: nativeSurface,
    shadow: shadow!,
    detach() {
      if (generation !== viewGeneration) return;
      active = false;
      getNativeContext().active = false;
      void import("./common/dialog-manager").then(({ DialogManager }) => {
        DialogManager.closeAll();
        clearNativePortals();
      });
    },
    setTheme: applyNativeTheme
  };
}
async function applyNativeTheme({ dark, colors: c }: Palette) {
  const { ThemeDark, ThemeLight } = await import("@notesnook/theme");
  const theme = structuredClone(dark ? ThemeDark : ThemeLight);
  if (
    c &&
    [
      "surface",
      "raised",
      "ink",
      "muted",
      "soft",
      "line",
      "control",
      "green"
    ].every((k) => typeof c[k] === "string" && CSS.supports("color", c[k]))
  ) {
    for (const scope of Object.values(theme.scopes))
      for (const [variant, values] of Object.entries(scope)) {
        if (
          !values ||
          typeof values !== "object" ||
          variant === "error" ||
          variant === "success"
        )
          continue;
        Object.assign(values, {
          background:
            variant === "selected"
              ? c.control
              : variant === "secondary"
                ? c.raised
                : c.surface,
          paragraph: c.ink,
          heading: c.ink,
          icon: c.muted,
          placeholder: c.muted,
          border: c.line,
          separator: c.line,
          hover: c.soft,
          accent: c.green,
          accentForeground: c.raised
        });
      }
  }
  const { useStore } = await import("./stores/theme-store");
  useStore.getState().setTheme(theme);
}
