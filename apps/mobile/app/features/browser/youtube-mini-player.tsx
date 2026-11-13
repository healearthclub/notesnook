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
import { useThemeColors } from "@notesnook/theme";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import AppIcon from "../../components/ui/AppIcon";
import type { YouTubePlayback } from "./youtube-playback";

type YouTubeMiniPlayerProps = {
  playback: YouTubePlayback;
  onOpen: () => void;
  onToggle: () => void;
};

export function YouTubeMiniPlayer({
  playback,
  onOpen,
  onToggle
}: YouTubeMiniPlayerProps) {
  const { colors } = useThemeColors();

  return (
    <View
      testID="youtube-mini-player"
      style={[
        styles.player,
        {
          backgroundColor: colors.secondary.background,
          borderColor: colors.primary.border
        }
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open YouTube in Browser, ${playback.title}`}
        testID="youtube-mini-player-open"
        onPress={onOpen}
        style={styles.track}
      >
        <View style={styles.artwork}>
          <AppIcon name="play" color="#fff" size={23} />
        </View>
        <View style={styles.text}>
          <Text
            numberOfLines={1}
            style={[styles.title, { color: colors.primary.heading }]}
          >
            {playback.title}
          </Text>
          <Text numberOfLines={1} style={{ color: colors.primary.paragraph }}>
            YouTube
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          playback.playing ? "Pause YouTube video" : "Play YouTube video"
        }
        testID="youtube-mini-player-toggle"
        onPress={onToggle}
        style={styles.toggle}
      >
        <AppIcon
          name={playback.playing ? "pause" : "play"}
          color={colors.primary.heading}
          size={24}
        />
      </Pressable>
      <View
        style={[
          styles.progressTrack,
          { backgroundColor: colors.primary.border }
        ]}
      >
        <View
          style={{
            width: `${playback.progress * 100}%`,
            height: "100%",
            backgroundColor: colors.primary.accent
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  player: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    marginBottom: 6,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden"
  },
  track: {
    flex: 1,
    minHeight: 52,
    paddingLeft: 7,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 9
  },
  artwork: {
    width: 36,
    height: 36,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#c90000"
  },
  text: { flex: 1 },
  title: { fontWeight: "600" },
  toggle: {
    width: 52,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center"
  },
  progressTrack: {
    position: "absolute",
    bottom: 0,
    left: 7,
    right: 7,
    height: 2
  }
});
