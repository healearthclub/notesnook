import React, { useEffect, useState } from "react";
import { NativeModules, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useThemeColors } from "@notesnook/theme";
import AppIcon from "../../components/ui/AppIcon";
import { useOhaiAccount } from "../login/google-session";
import { useMusicPlayback } from "../notes/music-player";

type ScriptureBridge = { open(scope: string): Promise<void>; close(): Promise<void> };
const scripture = NativeModules.OhaiScripture as ScriptureBridge | undefined;
export function ScriptureCard() {
  const { colors } = useThemeColors();
  const [error, setError] = useState<string>();
  const [opening, setOpening] = useState(false);
  useEffect(() => useOhaiAccount.subscribe((state, previous) => {
    if (state.userId !== previous.userId) void scripture?.close().catch(() => {});
  }), []);
  async function open() {
    if (opening) return;
    setError(undefined);
    if (Platform.OS !== "ios" || !scripture) { setError("Install the latest iOS build to open Scripture."); return; }
    setOpening(true);
    try {
      const music = useMusicPlayback.getState().current;
      if (music?.phase === "playing" || music?.phase === "loading") NativeModules.OhaiMusicPlayer?.setPaused(true, music.requestId);
      await scripture.open(useOhaiAccount.getState().userId || "guest");
    } catch { setError("Could not open Scripture. It requires iOS 17 or later. Try again."); }
    finally { setOpening(false); }
  }
  return <View style={{ width: "100%" }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Read the Bible" testID="open-scripture" disabled={opening} onPress={() => void open()}
      style={[styles.card, { backgroundColor: colors.secondary.background, borderColor: colors.primary.border }]}>
      <AppIcon name="book-open-outline" size={28} color={colors.primary.accent} />
      <View style={{ flex: 1 }}><Text style={{ color: colors.primary.heading, fontSize: 17, fontWeight: "600" }}>Bible</Text>
        <Text style={{ color: colors.secondary.paragraph, marginTop: 4 }}>Scripture · WEB &amp; BSB · Read offline</Text></View>
      <AppIcon name="chevron-right" size={22} color={colors.primary.accent} />
    </Pressable>
    {error && <Text accessibilityRole="alert" style={{ color: colors.primary.paragraph, marginTop: 8 }}>{error}</Text>}
  </View>;
}
const styles = StyleSheet.create({ card: { width: "100%", minHeight: 80, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, flexDirection: "row", alignItems: "center", gap: 14 } });
