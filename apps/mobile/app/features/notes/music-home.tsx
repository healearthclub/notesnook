import { useThemeColors } from "@notesnook/theme";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";
import {
  AudioDestination,
  PlayOnDeviceButton
} from "../playback/play-on-device";
import { AuthMode } from "../../components/auth/common";
import AppIcon from "../../components/ui/AppIcon";
import Navigation from "../../services/navigation";
import {
  fetchOhaiMusic,
  loadOhaiAccount,
  MusicTrack,
  useOhaiAccount
} from "../login/google-session";

import {
  advanceMusic,
  playMusic,
  togglePlaylistLoop,
  useMusicPlayback
} from "./music-player";

type MusicResult =
  | { kind: "ready"; tracks: MusicTrack[] }
  | { kind: "signed-out" }
  | { kind: "error" };

export function MusicHome({ active }: { active: boolean }) {
  const { colors } = useThemeColors();
  const currentTrack = useMusicPlayback((state) => state.current?.track);
  const selectedTrack = currentTrack?.id;
  const loop = useMusicPlayback((state) => state.loop);
  const hasQueue = useMusicPlayback((state) => state.queue.length > 0);
  const userId = useOhaiAccount((state) => state.userId);
  const [result, setResult] = useState<{
    userId: string | null;
    value: MusicResult;
  }>();
  const [revision, setRevision] = useState(0);
  const state = result?.userId === userId ? result?.value : undefined;

  useEffect(() => {
    if (!active) return;
    let current = true;
    setResult(undefined);

    async function load(): Promise<MusicResult> {
      if (!userId) {
        await loadOhaiAccount();
        return { kind: "signed-out" };
      }
      const tracks = await fetchOhaiMusic(userId);
      return tracks ? { kind: "ready", tracks } : { kind: "signed-out" };
    }

    void load()
      .catch((): MusicResult => ({ kind: "error" }))
      .then((value) => {
        if (current) setResult({ userId, value });
      });
    return () => {
      current = false;
    };
  }, [active, revision, userId]);

  if (!state) {
    return (
      <View style={styles.message}>
        <ActivityIndicator
          accessibilityLabel="Loading music"
          color={colors.primary.accent}
        />
      </View>
    );
  }

  if (state.kind !== "ready") {
    const signedOut = state.kind === "signed-out";
    return (
      <View style={styles.message}>
        <AppIcon name="music-note" size={30} color={colors.primary.accent} />
        <Text style={[styles.title, { color: colors.primary.heading }]}>
          {signedOut ? "Sign in to see your music" : "Couldn’t load your music"}
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.action}
          onPress={() =>
            signedOut
              ? Navigation.navigate("Auth", { mode: AuthMode.login })
              : setRevision((value) => value + 1)
          }
        >
          <Text style={{ color: colors.primary.accent, fontWeight: "600" }}>
            {signedOut ? "Sign in with Google" : "Try again"}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      testID="home-music-library"
      data={state.tracks}
      keyExtractor={(track) => track.id}
      refreshing={false}
      onRefresh={() => setRevision((value) => value + 1)}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        state.tracks.some((track) => !!track.playback) ? (
          <View style={styles.playlistControls}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: colors.secondary.paragraph }}>
                {loop ? "Playlist loops" : "Play in order"}
              </Text>
              {currentTrack && <AudioDestination />}
            </View>
            {currentTrack && (
              <PlayOnDeviceButton
                title={currentTrack.title}
                artist={currentTrack.artist}
                kind="music"
                compact
              />
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous song"
              disabled={!hasQueue}
              onPress={() => void advanceMusic(-1)}
              testID="music-previous"
              style={[styles.transport, !hasQueue && { opacity: 0.4 }]}
            >
              <AppIcon name="skip-previous" size={24} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next song"
              disabled={!hasQueue}
              onPress={() => void advanceMusic(1)}
              testID="music-next"
              style={[styles.transport, !hasQueue && { opacity: 0.4 }]}
            >
              <AppIcon name="skip-next" size={24} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Loop playlist"
              accessibilityState={{ selected: loop }}
              onPress={togglePlaylistLoop}
              testID="music-loop"
              style={styles.transport}
            >
              <AppIcon
                name="repeat"
                size={22}
                color={
                  loop ? colors.primary.accent : colors.secondary.paragraph
                }
              />
            </Pressable>
          </View>
        ) : null
      }
      ListEmptyComponent={
        <View style={styles.message}>
          <AppIcon name="music-note" size={30} color={colors.primary.accent} />
          <Text style={[styles.title, { color: colors.primary.heading }]}>
            No music in your library yet
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole={item.playback ? "button" : undefined}
          accessibilityLabel={
            item.playback ? `Play ${item.title || "untitled track"}` : undefined
          }
          accessibilityState={
            item.playback ? { selected: item.id === selectedTrack } : undefined
          }
          disabled={!item.playback}
          onPress={() => void playMusic(item, state.tracks)}
          style={[styles.track, { borderBottomColor: colors.primary.border }]}
        >
          <TrackArtwork
            key={item.artworkSource?.uri}
            source={item.artworkSource}
          />
          <View style={styles.details}>
            <Text
              numberOfLines={1}
              style={[
                styles.title,
                {
                  color:
                    item.id === selectedTrack
                      ? colors.primary.accent
                      : colors.primary.heading
                }
              ]}
            >
              {item.title || "Untitled track"}
            </Text>
            {item.artist ? (
              <Text
                numberOfLines={1}
                style={{ color: colors.secondary.paragraph }}
              >
                {item.artist}
              </Text>
            ) : null}
          </View>
        </Pressable>
      )}
    />
  );
}

export function TrackArtwork({
  source
}: {
  source: MusicTrack["artworkSource"];
}) {
  const { colors } = useThemeColors();
  const [failed, setFailed] = useState(false);
  return (
    <View
      style={[styles.artwork, { backgroundColor: colors.secondary.background }]}
    >
      <AppIcon name="music-note" size={22} color={colors.primary.accent} />
      {source && !failed ? (
        <Image
          source={source}
          testID="home-music-cover"
          accessible={false}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
          onError={() => setFailed(true)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  playlistControls: { flexDirection: "row", alignItems: "center" },
  transport: {
    width: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  list: { flexGrow: 1, paddingHorizontal: 16 },
  message: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 20
  },
  title: { fontSize: 16, fontWeight: "600", textAlign: "center" },
  action: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12 },
  track: {
    minHeight: 62,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  artwork: {
    width: 42,
    height: 42,
    overflow: "hidden",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center"
  },
  details: { flex: 1, alignItems: "flex-start", gap: 3 }
});
