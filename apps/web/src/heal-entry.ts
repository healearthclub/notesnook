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
  const dark = new URLSearchParams(location.search).get("theme") === "dark";
  storage.setItem("colorScheme",JSON.stringify(dark?"dark":"light"));
  await import("./index");
  window.addEventListener("message",async event=>{
    if(event.source!==parent || event.origin!==location.origin || event.data?.type!=="heal-notes-theme") return;
    const {useStore} = await import("./stores/theme-store");
    useStore.getState().setColorScheme(event.data.dark?"dark":"light");
  });
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
