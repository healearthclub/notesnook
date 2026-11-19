import { v4 as uuid } from "uuid";
export type VideoState = {
  position: number;
  duration: number;
  paused: boolean;
  ready: boolean;
};
export type LibraryVideo = {
  key: string;
  contentId: string;
  title: string;
  snapshot(): Promise<VideoState>;
  pause(): Promise<VideoState>;
  resume(position: number, paused: boolean): Promise<VideoState>;
  prepare(): Promise<VideoState>;
  release(): Promise<VideoState>;
};
const adapters = new Map<string, LibraryVideo>();
export function libraryVideoId(address: string) {
  try {
    const url = new URL(address);
    return url.origin === "https://healearth.club"
      ? /^\/pin\/([\w-]{1,100})$/.exec(url.pathname)?.[1]
      : undefined;
  } catch {
    return undefined;
  }
}
export function registerLibraryVideo(adapter: LibraryVideo) {
  adapters.set(adapter.key, adapter);
  return () => {
    if (adapters.get(adapter.key) === adapter) adapters.delete(adapter.key);
  };
}
export function findLibraryVideo(contentId: string, key?: string) {
  const exact = key ? adapters.get(key) : undefined;
  if (exact?.contentId === contentId) return exact;
  const matches = [...adapters.values()].filter(
    (a) => a.contentId === contentId
  );
  return matches.length === 1 ? matches[0] : undefined;
}
export function videoRPC(
  inject: (script: string) => void,
  currentAddress: () => string
) {
  const pending = new Map<
    string,
    {
      resolve: (s: VideoState) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      address: string;
    }
  >();
  const call = (action: string, position = 0, paused = true) =>
    new Promise<VideoState>((resolve, reject) => {
      const address = currentAddress();
      if (!libraryVideoId(address)) {
        reject(new Error("Open an account video on Heal Earth Club."));
        return;
      }
      const nonce = uuid(),
        timer = setTimeout(() => {
          pending.delete(nonce);
          reject(new Error("The video is not ready."));
        }, 6000);
      pending.set(nonce, { resolve, reject, timer, address });
      const request = JSON.stringify({ nonce, action, position, paused });
      inject(
        `(function(){if(window.top!==window)return;var r=${request};var v=document.querySelector('video');var send=function(error){window.ReactNativeWebView.postMessage(JSON.stringify({ohaiLibraryVideo:r.nonce,error:error||'',position:v&&isFinite(v.currentTime)?v.currentTime:0,duration:v&&isFinite(v.duration)?v.duration:0,paused:!v||v.paused,ready:!!v&&v.readyState>=2}));};if(!v){send('No playable account video.');return;}try{if(r.action==='pause'||r.action==='release')v.pause();if(r.action==='release'&&navigator.mediaSession){navigator.mediaSession.metadata=null;navigator.mediaSession.playbackState='none';}if(r.action==='resume'){v.currentTime=Math.max(0,Math.min(r.position,isFinite(v.duration)?v.duration:r.position));if(r.paused)v.pause();else{var p=v.play();if(p&&p.catch)p.catch(function(){send('Could not resume video.');});}}if(r.action==='prepare'){v.pause();if(v.readyState<2){v.addEventListener('canplay',function(){send();},{once:true});v.load();return;}}send();}catch(e){send('Video control failed.');}})();true;`
      );
    });
  return {
    call,
    receive(raw: string, address: string) {
      let v: Record<string, unknown>;
      try {
        v = JSON.parse(raw);
      } catch {
        return false;
      }
      if (typeof v.ohaiLibraryVideo !== "string") return false;
      const request = pending.get(v.ohaiLibraryVideo);
      if (!request) return true;
      pending.delete(v.ohaiLibraryVideo);
      clearTimeout(request.timer);
      if (address !== request.address || currentAddress() !== request.address) {
        request.reject(new Error("The browser page changed."));
        return true;
      }
      if (
        v.error ||
        typeof v.position !== "number" ||
        !Number.isFinite(v.position) ||
        v.position < 0 ||
        typeof v.duration !== "number" ||
        !Number.isFinite(v.duration) ||
        v.duration < 0 ||
        typeof v.paused !== "boolean" ||
        typeof v.ready !== "boolean"
      )
        request.reject(
          new Error(
            typeof v.error === "string" ? v.error : "Invalid video state."
          )
        );
      else request.resolve(v as unknown as VideoState);
      return true;
    },
    dispose() {
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("The video window closed."));
      }
      pending.clear();
    }
  };
}
