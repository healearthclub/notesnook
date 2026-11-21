import { RokuDeviceRows } from "./roku-device-rows";
import { useRokuConnection } from "./connection";
import { useThemeColors } from "@notesnook/theme";
import React from "react";
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  requireNativeComponent,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ViewProps,
  ColorValue
} from "react-native";
import { create } from "zustand";
import { BottomSheet } from "../../components/bottom-sheet";
import AppIcon from "../../components/ui/AppIcon";
import { useMusicPlayback } from "../notes/music-player";
import { audioOutputName, useAudioOutput } from "./audio-output";

type Media = {
  title: string;
  artist?: string;
  kind: "music" | "video";
  contentId?: string;
  adapterKey?: string;
};
const useDeviceSheet = create<{ media?: Media }>(() => ({}));
const RoutePicker =
  Platform.OS === "ios"
    ? requireNativeComponent<
        ViewProps & {
          tintColor: ColorValue;
          activeTintColor: ColorValue;
          prioritizesVideoDevices?: boolean;
        }
      >("OhaiAudioRoutePicker")
    : undefined;

export function PlayOnDeviceButton({
  title,
  artist,
  kind,
  compact = false,
  contentId,
  adapterKey
}: Media & { compact?: boolean }) {
  const { colors } = useThemeColors();
  const outputs = useAudioOutput((state) => state.outputs);
  const remote = useRokuConnection();
  if (Platform.OS !== "ios") return null;
  const remoteActive =
    !!remote.connection &&
    (remote.connection.phase === "active" ||
      (remote.localSuspended && remote.stage === "unknown")) &&
    (kind === "music"
      ? remote.connection.intent.kind === "music"
      : !!contentId &&
        remote.connection.intent.kind === "videos" &&
        remote.connection.snapshot.contentId === contentId);
  const destination = remoteActive
    ? remote.stage === "unknown"
      ? "TV connection interrupted"
      : remote.name
    : audioOutputName(outputs);
  const external =
    remoteActive || outputs.some((output) => output.kind !== "iphone");
  // AirPlay is a system route, independent of the optional account-based Roku
  // receiver. One tap opens Apple's real device list even when that service is off.
  if (RoutePicker && !remote.enabled && !remote.connection) {
    return (
      <View
        testID="play-on-device"
        style={[styles.trigger, compact && styles.compactTrigger]}
      >
        <RoutePicker
          testID="system-audio-route-picker"
          accessibilityLabel={`Play on device. Choose AirPlay TV or Bluetooth output. Current output: ${destination}`}
          onTouchStart={() => Keyboard.dismiss()}
          prioritizesVideoDevices={kind === "video"}
          tintColor={external ? colors.primary.accent : colors.primary.icon}
          activeTintColor={colors.primary.accent}
          style={styles.iconButton}
        />
        {!compact && (
          <View pointerEvents="none" style={styles.text}>
            <Text style={{ color: colors.primary.heading, fontWeight: "600" }}>
              AirPlay &amp; Bluetooth
            </Text>
            <Text
              numberOfLines={1}
              style={{ color: colors.secondary.paragraph, fontSize: 12 }}
            >
              {destination}
            </Text>
          </View>
        )}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Play on device. Current output: ${destination}`}
      testID="play-on-device"
      onPress={() => {
        Keyboard.dismiss();
        useDeviceSheet.setState({
          media: { title, artist, kind, contentId, adapterKey }
        });
      }}
      style={[styles.trigger, compact && styles.compactTrigger]}
    >
      <AppIcon
        name="cast-audio"
        size={21}
        color={external ? colors.primary.accent : colors.primary.icon}
      />
      {!compact && (
        <View style={styles.text}>
          <Text style={{ color: colors.primary.heading, fontWeight: "600" }}>
            Play on device
          </Text>
          <Text
            numberOfLines={1}
            style={{ color: colors.secondary.paragraph, fontSize: 12 }}
          >
            {destination}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function AudioDestination() {
  const remote = useRokuConnection();
  const { colors } = useThemeColors();
  const outputs = useAudioOutput((state) => state.outputs);
  return (
    <Text
      numberOfLines={1}
      style={{ fontSize: 12, color: colors.secondary.paragraph }}
    >
      {!!remote.connection &&
      (remote.connection.phase === "active" ||
        (remote.localSuspended && remote.stage === "unknown")) &&
      remote.connection.intent.kind === "music"
        ? remote.stage === "unknown"
          ? "TV connection interrupted"
          : `Playing on ${remote.name}`
        : audioOutputName(outputs)}
    </Text>
  );
}

export function PlaybackDeviceSheet() {
  const remote = useRokuConnection();
  const { colors } = useThemeColors();
  const media = useDeviceSheet((state) => state.media);
  const music = useMusicPlayback((state) => state.current?.track);
  const remoteActive =
    !!remote.connection &&
    (remote.connection.phase === "active" ||
      (remote.localSuspended && remote.stage === "unknown")) &&
    (media?.kind === "music"
      ? remote.connection.intent.kind === "music" &&
        remote.connection.snapshot.contentId === music?.id
      : !!media?.contentId &&
        remote.connection.intent.kind === "videos" &&
        remote.connection.snapshot.contentId === media.contentId);
  const liveMedia =
    media?.kind === "music" && music
      ? { ...media, title: music.title, artist: music.artist }
      : media;
  const { outputs, available } = useAudioOutput();
  const onClose = () => useDeviceSheet.setState({ media: undefined });
  if (Platform.OS !== "ios") return null;
  return (
    <Modal
      visible={!!media}
      transparent
      presentationStyle="overFullScreen"
      animationType="none"
      onRequestClose={onClose}
    >
      {media && (
        <BottomSheet
          label="Play on device"
          handleTestID="playback-device-grabber"
          heightFraction={0.5}
          expandable
          onClose={onClose}
        >
          {({ bottomInset, close }) => (
            <View style={styles.fill}>
              <View style={styles.header}>
                <Text
                  accessibilityRole="header"
                  style={[styles.heading, { color: colors.primary.heading }]}
                >
                  Connect
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close device picker"
                  onPress={close}
                  style={styles.iconButton}
                >
                  <AppIcon name="close" size={23} />
                </Pressable>
              </View>
              <ScrollView
                contentContainerStyle={[
                  styles.content,
                  { paddingBottom: bottomInset + 16 }
                ]}
              >
                <View style={[styles.nowPlaying, { backgroundColor: colors.secondary.background }]} accessibilityLiveRegion="polite">
                  <View style={styles.text}>
                    <Text numberOfLines={2} style={[styles.deviceTitle, { color: colors.primary.heading }]}>
                      {remoteActive ? remote.name : audioOutputName(outputs)}
                    </Text>
                    <Text numberOfLines={1} style={{ color: colors.primary.accent, fontWeight: "600" }}>
                      {liveMedia?.title || "Current media"}
                    </Text>
                    {!!liveMedia?.artist && <Text numberOfLines={1} style={{ color: colors.secondary.paragraph }}>{liveMedia.artist}</Text>}
                  </View>
                  <AppIcon name={remoteActive ? "television" : "cellphone"} size={38} color={colors.primary.accent} />
                </View>
                <RokuDeviceRows kind={media.kind} contentId={media.contentId} adapterKey={media.adapterKey} currentRemote={remoteActive} />
                <View
                  style={[
                    styles.row,
                    {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderColor: colors.primary.border
                    }
                  ]}
                >
                  <AppIcon name="bluetooth" size={25} />
                  <View style={styles.text}>
                    <Text
                      style={[styles.title, { color: colors.primary.heading }]}
                    >
                      Bluetooth &amp; AirPlay
                    </Text>
                    <Text style={{ color: colors.secondary.paragraph }}>
                      Choose a TV, speaker or headphones
                    </Text>
                  </View>
                  {available && RoutePicker ? (
                    <RoutePicker
                      testID="system-audio-route-picker"
                      style={styles.iconButton}
                      tintColor={colors.primary.icon}
                      activeTintColor={colors.primary.accent}
                      prioritizesVideoDevices={media.kind === "video"}
                    />
                  ) : (
                    <Text style={{ color: colors.secondary.paragraph }}>
                      Unavailable
                    </Text>
                  )}
                </View>
                {media.kind === "video" && (
                  <Text style={{ color: colors.secondary.paragraph }}>
                    With Bluetooth, sound plays on the speaker and video stays
                    on your iPhone.
                  </Text>
                )}

              </ScrollView>
            </View>
          )}
        </BottomSheet>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  trigger: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 12,
    maxWidth: "100%"
  },
  compactTrigger: { width: 44, paddingHorizontal: 0, justifyContent: "center" },
  text: { flex: 1, minWidth: 0, gap: 2 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 20,
    paddingRight: 8
  },
  heading: { fontSize: 22, fontWeight: "700", flex: 1 },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  content: { paddingHorizontal: 20, gap: 12 },
  nowPlaying: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    padding: 18,
    marginTop: 10
  },
  deviceTitle: { fontSize: 22, fontWeight: "700", marginBottom: 5 },
  title: { fontSize: 15, fontWeight: "600" },
  row: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8
  }
});
