import { useThemeColors } from "@notesnook/theme";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";
import AppIcon from "../../components/ui/AppIcon";
import {
  compactDockCardStyle,
  DismissibleCard,
  dismissCardAction,
  dockCardStyle
} from "../browser/dismissible-card";
import { TrackArtwork } from "./music-home";
import { stopMusic, toggleMusic, useMusicPlayback } from "./music-player";

export function MusicDock({ compact }: { compact?: boolean }) {
  const { colors } = useThemeColors();
  const current = useMusicPlayback((state) => state.current);
  if (!current) return null;
  const { track, phase } = current;
  const title = track.title || "Untitled track";
  const subtitle =
    phase === "failed" ? "Couldn’t play this track" : track.artist;
  const isPlaying = phase === "playing";

  return (
    <DismissibleCard onDismiss={stopMusic}>
      <View
        testID="music-mini-player"
        style={[
          dockCardStyle,
          styles.card,
          compact && [compactDockCardStyle, styles.compact],
          {
            backgroundColor: colors.secondary.background,
            borderColor: colors.primary.border
          }
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            phase === "failed"
              ? `Retry ${title}`
              : isPlaying
              ? `Pause ${title}`
              : phase === "loading"
              ? `Cancel ${title}`
              : `Play ${title}`
          }
          accessibilityActions={dismissCardAction}
          onAccessibilityAction={({ nativeEvent }) => {
            if (nativeEvent.actionName === "dismiss") stopMusic();
          }}
          onPress={phase === "loading" ? stopMusic : toggleMusic}
          testID="music-mini-player-control"
          style={styles.control}
        >
          <View
            style={[styles.circle, { backgroundColor: colors.primary.heading }]}
          >
            {phase === "loading" ? (
              <ActivityIndicator color={colors.primary.background} />
            ) : (
              <AppIcon
                name={
                  isPlaying ? "pause" : phase === "failed" ? "reload" : "play"
                }
                size={20}
                color={colors.primary.background}
              />
            )}
          </View>
        </Pressable>
        <View style={styles.text}>
          <Text
            numberOfLines={1}
            style={[styles.title, { color: colors.primary.heading }]}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              numberOfLines={1}
              style={{ color: colors.secondary.paragraph }}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        {compact || track.artworkSource ? (
          <TrackArtwork
            key={track.artworkSource?.uri}
            source={track.artworkSource}
          />
        ) : null}
      </View>
    </DismissibleCard>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 26 },
  compact: { flexDirection: "row-reverse", borderRadius: 13 },
  control: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  circle: {
    width: 35,
    height: 35,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center"
  },
  text: { flex: 1, minWidth: 0, gap: 1 },
  title: { fontWeight: "600", fontSize: 14 }
});
