/* Heal Earth integration, 2026. GPL-3.0-or-later; see HEAL-EARTH-NOTICE.md. */
// Bootstrap before importing any upstream module: Config and the key store read
// browser storage during module initialization.
async function start() {
  if (!HEAL_EMBED) return import("./index");
  const response = await fetch("/api/private-notes/context", {cache:"no-store", credentials:"same-origin"});
  if (!response.ok) throw new Error("Sign in to Heal Earth to open your private notes.");
  const {namespace} = await response.json();
  if (typeof namespace !== "string" || !/^heal-notes-[a-f0-9]{64}-$/.test(namespace)) throw new Error("Invalid notes session.");
  if (!window.indexedDB || !window.crypto?.subtle) throw new Error("This browser cannot safely store private notes. Use a current browser with site storage enabled.");
  try {
    const testKey=await crypto.subtle.generateKey({name:"AES-KW",length:256},false,["wrapKey","unwrapKey"]);
    structuredClone(testKey);
  } catch {throw new Error("This browser cannot persist private note keys. Use a current browser with site storage enabled.");}
  // IndexedDB SQLite must have one owning worker per account. Hold the lock
  // for this document's lifetime; navigating away releases it automatically.
  if (!navigator.locks) throw new Error("This browser cannot safely coordinate Notes storage. Use a current browser.");
  await new Promise<void>((resolve,reject)=>{
    navigator.locks.request(namespace+"workspace",{ifAvailable:true},lock=>{
      if(!lock){reject(new Error("Notes is already open in another tab. Close that Notes view, then reload this page to continue."));return;}
      resolve();
      return new Promise<void>(()=>{});
    }).catch(reject);
  });
  window.__HEAL_NOTES_NAMESPACE__ = namespace;
  window.__HEAL_NOTES_LOCAL__ = true;
  const real = window.localStorage;
  const keys = () => Array.from({length:real.length},(_,i)=>real.key(i)!).filter(k=>k?.startsWith(namespace));
  const storage = {
    get length(){return keys().length;},
    key(i:number){return keys()[i]?.slice(namespace.length) ?? null;},
    getItem(k:string){return real.getItem(namespace+k);},
    setItem(k:string,v:string){real.setItem(namespace+k,String(v));},
    removeItem(k:string){real.removeItem(namespace+k);},
    clear(){for(const k of keys()) real.removeItem(k);}
  };
  Object.defineProperty(window,"localStorage",{value:storage});
  // Keychain, config, attachment and feature-check databases in this realm.
  // SQLite workers receive a namespaced dbName separately in common/db.ts.
  const open = indexedDB.open.bind(indexedDB), remove = indexedDB.deleteDatabase.bind(indexedDB);
  indexedDB.open = (name, version) => open(namespace+name,version);
  indexedDB.deleteDatabase = name => remove(namespace+name);
  storage.setItem("skipInitiation","true");
  storage.setItem("followSystemTheme","false");
  const dark = parent !== window ? parent.document.documentElement.dataset.theme === "dark" || parent.document.documentElement.dataset.themeTone === "dark" : new URLSearchParams(location.search).get("theme") === "dark";
  storage.setItem("colorScheme",JSON.stringify(dark?"dark":"light"));
  await import("./index");
  window.addEventListener("message",async event=>{
    if(event.source!==parent || event.origin!==location.origin || event.data?.type!=="heal-notes-theme") return;
    const {useStore} = await import("./stores/theme-store");
    const {ThemeDark,ThemeLight} = await import("@notesnook/theme");
    const theme=structuredClone(event.data.dark?ThemeDark:ThemeLight);
    const c=event.data.colors;
    if(c && ["surface","raised","ink","muted","soft","line","control","green"].every(k=>typeof c[k]==="string" && CSS.supports("color",c[k]))) {
      for(const scope of Object.values(theme.scopes)) {
        for(const [variant,values] of Object.entries(scope)) {
          if(!values || typeof values!=="object" || variant==="error" || variant==="success")continue;
          Object.assign(values,{background:variant==="selected"?c.control:variant==="secondary"?c.raised:c.surface,paragraph:c.ink,heading:c.ink,icon:c.muted,placeholder:c.muted,border:c.line,separator:c.line,hover:c.soft,accent:c.green,accentForeground:c.raised});
        }
      }
    }
    useStore.getState().setTheme(theme);
  });
  parent.postMessage({type:"heal-notes-ready"},location.origin);
  // End this view if its authenticated account changes in another browser tab.
  const verify = async()=>{
    try {
      const r=await fetch("/api/private-notes/context",{cache:"no-store"});
      if(!r.ok || (await r.json()).namespace!==namespace) location.reload();
    } catch { /* Offline editing is intentional; verify again on reconnect. */ }
  };
  window.addEventListener("focus",verify);
  window.addEventListener("online",verify);
  setInterval(verify,30000);
}
start().catch(error=>{
  document.body.replaceChildren();
  const message=document.createElement("p");
  message.style.cssText="font:16px system-ui;padding:32px";
  message.textContent=error instanceof Error?error.message:"Unable to open private notes.";
  document.body.append(message);
});
