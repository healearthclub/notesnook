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

import { isHealEarthAccountId } from "./account-identity";
import { type ImageURISource, NativeModules, Platform } from "react-native";
import * as Keychain from "react-native-keychain";
import { create } from "zustand";

const origin = "https://healearth.club/ohai";
const keychainOptions = {
  service: "org.healearth.ohai.google-session",
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY
};

type Account = { userId: string; email: string; expiresAt: number };
type Session = Account & { token: string };

function isAccount(value: unknown): value is Account {
  if (!value || typeof value !== "object") return false;
  const account = value as Partial<Account>;
  return (
    isHealEarthAccountId(account.userId) &&
    typeof account.email === "string" &&
    typeof account.expiresAt === "number" &&
    Number.isSafeInteger(account.expiresAt) &&
    account.expiresAt > Date.now()
  );
}
function isSession(value: unknown): value is Session {
  return (
    isAccount(value) &&
    "token" in value &&
    typeof value.token === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(value.token)
  );
}

type GoogleAuthModule = {
  openGoogleSignIn(): Promise<{ code: string; verifier: string } | null>;
};

export class GoogleSignInUnavailableError extends Error {}

export const useOhaiAccount = create<{
  email: string | null;
  userId: string | null;
}>(() => ({
  userId: null,
  email: null
}));

async function readSession(): Promise<Session | null> {
  if (Platform.OS !== "ios") return null;
  const entry = await Keychain.getGenericPassword(keychainOptions);
  if (!entry) return null;
  let session: unknown;
  try {
    session = JSON.parse(entry.password);
  } catch {
    // A corrupt Keychain entry cannot identify a Heal Earth Club account.
  }
  if (!isSession(session)) {
    await Keychain.resetGenericPassword(keychainOptions);
    return null;
  }
  return session;
}

export async function loadOhaiAccount() {
  const session = await readSession();
  if (!session) {
    useOhaiAccount.setState({ email: null, userId: null });
    return;
  }

  // Keep a locally valid account available when the device is offline.
  const response = await request("/auth/native/session", {
    headers: { Authorization: `Bearer ${session.token}` }
  }).catch(() => null);
  const account: unknown = response?.ok
    ? await response.json().catch(() => null)
    : null;
  // A concurrent sign-in or sign-out may have replaced this credential.
  if ((await readSession())?.token !== session.token) return;
  if (
    response?.status === 401 ||
    (response?.ok && (!isAccount(account) || account.userId !== session.userId))
  ) {
    await Keychain.resetGenericPassword(keychainOptions);
    useOhaiAccount.setState({ email: null, userId: null });
    return;
  }
  useOhaiAccount.setState({
    email: isAccount(account) ? account.email : session.email,
    userId: session.userId
  });
}

async function request(path: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(origin + path, {
      ...init,
      credentials: "omit",
      redirect: "error",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function continueWithGoogle() {
  const auth = NativeModules.OhaiGoogleAuth as GoogleAuthModule | undefined;
  if (!auth) throw new Error("Google sign-in is unavailable on this device.");
  const ready = await request("/auth/native/status")
    .then(async (response) => {
      if (
        !response.ok ||
        !response.headers.get("content-type")?.includes("application/json")
      ) {
        return false;
      }
      return (await response.json())?.ready === true;
    })
    .catch(() => false);
  if (!ready) throw new GoogleSignInUnavailableError();

  const handoff = await auth.openGoogleSignIn();
  if (!handoff) return;
  const result = await request("/auth/native/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(handoff)
  });
  if (!result.ok) throw new Error("Sign-in expired. Please try again.");

  const session: unknown = await result.json();
  if (!isSession(session)) {
    throw new Error("Could not verify the ohai session.");
  }
  const saved = await Keychain.setGenericPassword(
    "ohai-google",
    JSON.stringify(session),
    keychainOptions
  );
  if (!saved) throw new Error("Could not save your sign-in on this device.");
  clearMusicPlaybackSession();
  useOhaiAccount.setState({ email: session.email, userId: session.userId });
}

export async function signOutOfOhai() {
  const session = await readSession();
  if (session) {
    const result = await request("/auth/sign-out", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}` }
    });
    if (!result.ok && result.status !== 401) {
      throw new Error("Could not sign out. Please try again.");
    }
  }
  if (!(await Keychain.resetGenericPassword(keychainOptions)) && session) {
    throw new Error("Could not clear the saved sign-in. Please try again.");
  }
  useOhaiAccount.setState({ email: null, userId: null });
}

export type MusicTrack = {
  id: string;
  title: string;
  artist: string;
  artworkSource?: ImageURISource;
  playback?: string;
};

type MusicTrackResponse = Omit<MusicTrack, "artworkSource"> & {
  artwork?: string;
};

function isMusicTrack(track: unknown): track is MusicTrackResponse {
  if (!track || typeof track !== "object") return false;
  const candidate = track as Partial<MusicTrackResponse>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.artist === "string" &&
    (candidate.artwork === undefined ||
      typeof candidate.artwork === "string") &&
    (candidate.playback === undefined || typeof candidate.playback === "string")
  );
}

export async function fetchOhaiMusic(
  userId: string
): Promise<MusicTrack[] | null> {
  const session = await readSession();
  if (session?.userId !== userId) return null;
  const response = await request("/auth/native/music", {
    headers: { Authorization: `Bearer ${session.token}` }
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Could not load your music library.");
  const body = await response.json();
  if (!Array.isArray(body?.tracks) || !body.tracks.every(isMusicTrack))
    throw new Error("The music library returned an invalid response.");
  return (body.tracks as MusicTrackResponse[]).map(
    ({ id, title, artist, artwork, playback }) => ({
      id,
      title,
      artist,
      playback,
      artworkSource: trackArtwork(id, artwork, session.token)
    })
  );
}

// Account-scoped book requests reuse the existing Keychain session, never expose it to UI.
export async function requestOhaiBooks(
  userId: string,
  bookId?: string
): Promise<unknown | null> {
  if (bookId && !/^[A-Za-z0-9_-]{1,100}$/.test(bookId))
    throw new Error("Invalid book ID.");
  const session = await readSession();
  if (session?.userId !== userId) return null;
  const response = await request(
    "/auth/native/books" + (bookId ? "?id=" + encodeURIComponent(bookId) : ""),
    {
      headers: {
        Authorization: `Bearer ${session.token}`,
        "X-Books-Account": userId
      }
    }
  );
  if (response.status === 401) return null;
  if (response.status === 404 && bookId)
    throw new Error(
      "This reading copy isn’t available in your account. Sync it from Heal Earth Club and refresh Books."
    );
  if (response.status === 404 || response.status === 503)
    throw new Error(
      "Account books are not available yet. Try again after Heal Earth Club is updated."
    );
  if (!response.ok) throw new Error("Could not load your books. Try again.");
  const raw = await response.text();
  if (raw.length > 2_000_000)
    throw new Error("The book response is too large.");
  const body: unknown = JSON.parse(raw);
  const current = await readSession();
  if (
    current?.token !== session.token ||
    useOhaiAccount.getState().userId !== userId
  )
    return null;
  return body;
}

function trackArtwork(
  id: string,
  artwork: string | undefined,
  token: string
): ImageURISource | undefined {
  if (artwork === "account") {
    return {
      uri: origin + "/auth/native/music/artwork?id=" + encodeURIComponent(id),
      headers: { Authorization: `Bearer ${token}` },
      cache: "reload"
    };
  }
  if (!artwork) return;
  try {
    const url = new URL(artwork);
    if (url.protocol === "https:" && !url.username && !url.password)
      return { uri: url.href };
  } catch {
    // Leave the placeholder visible when the artwork address is invalid.
  }
}

// Keep the active music credential in memory so changing tracks does not
// require an unlocked Keychain. It is released when playback or the account ends.
let musicSession: Session | null = null;
let musicSessionGeneration = 0;

export function clearMusicPlaybackSession() {
  musicSession = null;
  musicSessionGeneration++;
}

useOhaiAccount.subscribe((state, previous) => {
  if (state.userId !== previous.userId) clearMusicPlaybackSession();
});

export async function getMusicPlaybackSource(
  userId: string,
  track: MusicTrack
) {
  if (track.playback === "account") {
    const generation = musicSessionGeneration;
    const session =
      isSession(musicSession) && musicSession.userId === userId
        ? musicSession
        : await readSession();
    if (
      generation !== musicSessionGeneration ||
      session?.userId !== userId ||
      useOhaiAccount.getState().userId !== userId
    )
      return;
    musicSession = session;
    return {
      url:
        origin + "/auth/native/music/stream?id=" + encodeURIComponent(track.id),
      token: session.token
    };
  }
  if (!track.playback) return;
  try {
    const url = new URL(track.playback);
    if (url.protocol === "https:" && !url.username && !url.password) {
      return { url: url.href, token: "" };
    }
  } catch {
    return;
  }
}

let playbackCleanupSession: Session | undefined;

// First-party playback control keeps the native credential in this session boundary.
export async function requestOhaiPlayback(
  userId: string,
  path: string,
  data?: unknown
): Promise<unknown> {
  if (
    !/^(receivers|queues|sessions(?:\/[A-Za-z0-9_-]{1,100}(?:\/(?:commands(?:\/[A-Za-z0-9_-]{1,100})?|queue\/[0-9]{1,5}|detach))?)?)$/.test(
      path
    )
  )
    throw new Error("Invalid TV request.");
  const session = await readSession();
  if (
    !session ||
    session.userId !== userId ||
    useOhaiAccount.getState().userId !== userId
  )
    throw new Error("Sign in to connect to your TV.");
  playbackCleanupSession = session;
  const response = await request("/auth/native/playback/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${session.token}`,
      ...(data === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  });
  const text = await response.text();
  if (text.length > 262144) throw new Error("The TV response is too large.");
  const body: unknown = JSON.parse(text);
  const current = await readSession();
  if (
    current?.token !== session.token ||
    useOhaiAccount.getState().userId !== userId
  )
    throw new Error("Your account changed.");
  if (!response.ok) {
    const error = new Error(
      typeof body === "object" &&
      body &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : "Could not connect to your TV."
    );
    Object.assign(error, { status: response.status });
    throw error;
  }
  return body;
}

// Cleanup only: the previous account credential never enters the UI or a receiver payload.
export async function detachOhaiPlaybackForAccount(
  userId: string,
  sessionId: string
) {
  const session = playbackCleanupSession;
  if (
    !session ||
    session.userId !== userId ||
    !/^[-\w]{1,100}$/.test(sessionId)
  )
    return;
  playbackCleanupSession = undefined;
  try {
    await request("/auth/native/playback/sessions/" + sessionId + "/detach", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json"
      },
      body: "{}"
    });
  } catch {
    /* Already-issued commands remain bounded by their server expiry. */
  }
}

// Publishing uses the same first-party credential boundary, with its own path
// allowlist. The credential never enters the editor, storage record or viewer.
export async function requestOhaiPublishing(
  userId: string,
  path: string,
  method: "GET" | "POST" | "DELETE" = "GET",
  data?: unknown
): Promise<unknown> {
  if (
    !/^(capabilities|v2|[A-Za-z0-9_-]{1,128}(?:\/metadata)?)$/.test(path) ||
    !["GET", "POST", "DELETE"].includes(method)
  )
    throw new Error("Invalid publishing request.");
  const session = await readSession();
  if (
    !session ||
    session.userId !== userId ||
    useOhaiAccount.getState().userId !== userId
  )
    throw new Error("Your selected account changed. Reopen publishing.");
  const response = await request("/auth/native/monographs/" + path, {
    method,
    headers: {
      Authorization: `Bearer ${session.token}`,
      "X-Heal-Earth-Account": userId,
      ...(data === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  });
  const raw = await response.text();
  if (raw.length > 65536)
    throw new Error("The publishing response is too large.");
  const current = await readSession();
  if (
    current?.token !== session.token ||
    useOhaiAccount.getState().userId !== userId
  )
    throw new Error("Your selected account changed. Reopen publishing.");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error("Publishing returned an invalid response.");
  }
  if (!response.ok) {
    const v =
      body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const error = new Error(
      typeof v.error === "string"
        ? v.error
        : "Publishing is unavailable. Retry the same note."
    );
    Object.assign(error, {
      status: response.status,
      code: typeof v.code === "string" ? v.code : "unavailable",
      retryable: v.retryable === true,
      publicationState: v.publicationState
    });
    throw error;
  }
  return body;
}
