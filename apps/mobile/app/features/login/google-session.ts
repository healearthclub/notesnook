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

import { NativeModules, Platform } from "react-native";
import * as Keychain from "react-native-keychain";
import { create } from "zustand";

const origin = "https://healearth.club/ohai";
const keychainOptions = {
  service: "org.healearth.ohai.google-session",
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY
};

type Session = { token: string; email: string; expiresAt: number };
type GoogleAuthModule = {
  openGoogleSignIn(): Promise<{ code: string; verifier: string } | null>;
};

export class GoogleSignInUnavailableError extends Error {}

export const useOhaiAccount = create<{ email: string | null }>(() => ({
  email: null
}));

async function readSession(): Promise<Session | null> {
  if (Platform.OS !== "ios") return null;
  const entry = await Keychain.getGenericPassword(keychainOptions);
  if (!entry) return null;
  const session: Session = JSON.parse(entry.password);
  if (session.expiresAt <= Date.now()) {
    await Keychain.resetGenericPassword(keychainOptions);
    return null;
  }
  return session;
}

export async function loadOhaiAccount() {
  const session = await readSession();
  useOhaiAccount.setState({ email: session?.email ?? null });
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

  const session: Partial<Session> = await result.json();
  if (
    typeof session.token !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(session.token) ||
    typeof session.email !== "string" ||
    typeof session.expiresAt !== "number" ||
    !Number.isSafeInteger(session.expiresAt) ||
    session.expiresAt <= Date.now()
  ) {
    throw new Error("Could not verify the ohai session.");
  }
  const saved = await Keychain.setGenericPassword(
    "ohai-google",
    JSON.stringify(session),
    keychainOptions
  );
  if (!saved) throw new Error("Could not save your sign-in on this device.");
  useOhaiAccount.setState({ email: session.email });
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
  useOhaiAccount.setState({ email: null });
}
