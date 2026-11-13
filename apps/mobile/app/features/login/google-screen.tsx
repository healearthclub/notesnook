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

import { useIsFocused } from "@react-navigation/native";
import React, { useEffect, useRef, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View
} from "react-native";
import { AuthHeader } from "../../components/auth/header";
import { Button } from "../../components/ui/button";
import { openLinkInBrowser } from "../../utils/functions";
import {
  continueWithGoogle,
  GoogleSignInUnavailableError,
  loadOhaiAccount,
  signOutOfOhai,
  useOhaiAccount
} from "./google-session";

export const googleScreenBackground = "#fbfbf9";
const ink = "#202020";
const muted = "#62655c";

export function GoogleScreen({
  welcomeSignup = false,
  close,
  active = true
}: {
  welcomeSignup?: boolean;
  close?: () => void;
  active?: boolean;
}) {
  const isFocused = useIsFocused();
  const email = useOhaiAccount((state) => state.email);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string>();
  const running = useRef(true);

  useEffect(() => {
    let mounted = true;
    loadOhaiAccount()
      .catch(() => {
        if (mounted) setError("Could not read the saved sign-in.");
      })
      .finally(() => {
        if (mounted) {
          running.current = false;
          setBusy(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      const code = (failure as { code?: string })?.code;
      if (failure instanceof GoogleSignInUnavailableError)
        setError(
          "Google sign-in is unavailable right now. You can still use Notes offline."
        );
      else if (code === "not_allowed")
        setError("This Google account doesn’t have access to the ohai pilot.");
      else if (code === "os_unsupported")
        setError("Google sign-in requires iOS 17.4 or later.");
      else if (action === signOutOfOhai)
        setError("Could not sign out. Check your connection and try again.");
      else
        setError(
          "Could not sign in with Google. Try again or continue offline."
        );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      {isFocused && active ? <StatusBar barStyle="dark-content" /> : null}
      {close ? (
        <AuthHeader welcome={welcomeSignup} foregroundColor={muted} />
      ) : null}
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.center}>
          <View style={styles.form}>
            <Image
              accessible={false}
              source={require("./mascot.png")}
              style={styles.mascot}
              resizeMode="contain"
            />
            <Text accessibilityRole="header" style={styles.title}>
              {email ? "Your ohai account" : "gm fren"}
            </Text>
            {email ? (
              <>
                <Text selectable style={styles.description}>
                  {email}
                </Text>
                {close ? (
                  <Button
                    title="Done"
                    type="accent"
                    accentColor="#141414"
                    disabled={busy}
                    onPress={close}
                  />
                ) : null}
                <Button
                  title="Sign out"
                  type="plain"
                  buttonType={{ text: muted }}
                  disabled={busy}
                  onPress={() => void run(signOutOfOhai)}
                />
              </>
            ) : (
              <>
                <Text style={styles.description}>
                  Join the Club and help Build Heaven on Earth.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Continue with Google"
                  accessibilityState={{ disabled: busy, busy }}
                  disabled={busy}
                  onPress={() => void run(continueWithGoogle)}
                  testID="auth-google"
                  style={({ pressed }) => [
                    styles.google,
                    (busy || pressed) && styles.pressed
                  ]}
                >
                  <Image
                    accessible={false}
                    source={require("./google-g.png")}
                    style={styles.googleMark}
                    resizeMode="contain"
                  />
                  <Text style={styles.googleText}>
                    {busy ? "Please wait…" : "Continue with Google"}
                  </Text>
                </Pressable>
                {close && !welcomeSignup ? (
                  <Button
                    title="Continue offline"
                    type="plain"
                    buttonType={{ text: muted }}
                    onPress={close}
                  />
                ) : null}
              </>
            )}
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.footer}>
          <Text style={styles.footerText}>Thy Kingdom Come</Text>
          <View style={styles.links}>
            <Text
              accessibilityRole="link"
              onPress={() =>
                void openLinkInBrowser("https://healearth.club/privacy")
              }
              style={styles.footerText}
            >
              Privacy Policy
            </Text>
            <Text accessible={false} style={styles.footerText}>
              ·
            </Text>
            <Text
              accessibilityRole="link"
              onPress={() =>
                void openLinkInBrowser("https://healearth.club/terms")
              }
              style={styles.footerText}
            >
              Terms of Use
            </Text>
          </View>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  page: {
    flexGrow: 1,
    paddingHorizontal: 32,
    paddingBottom: 16
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 24
  },
  form: {
    width: "100%",
    maxWidth: 440,
    alignItems: "center"
  },
  mascot: { width: 160, height: 160 },
  title: {
    fontSize: 44,
    fontWeight: "700",
    letterSpacing: -2,
    color: ink,
    textAlign: "center",
    marginTop: 10
  },
  description: {
    fontSize: 14,
    color: muted,
    textAlign: "center",
    marginTop: 18
  },
  google: {
    width: "100%",
    minHeight: 48,
    backgroundColor: "#141414",
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 36
  },
  pressed: { opacity: 0.65 },
  googleMark: { width: 20, height: 20 },
  googleText: {
    flexShrink: 1,
    fontSize: 15,
    color: "#fff",
    textAlign: "center",
    fontWeight: "500"
  },
  error: { color: "#8b2727", textAlign: "center", marginTop: 12 },
  footer: { alignItems: "center", gap: 2 },
  links: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 5
  },
  footerText: { color: muted, fontSize: 11, textAlign: "center" }
});
