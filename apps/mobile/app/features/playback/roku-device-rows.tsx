import React, { useEffect } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { useThemeColors } from "@notesnook/theme";
import AppIcon from "../../components/ui/AppIcon";
import { eligible } from "./connection-model";
import {
  cancelRokuConnection,
  detachRokuController,
  connectRoku,
  observeRokuPicker,
  refreshRokuConnection,
  returnToIPhone,
  rokuAction,
  useRokuConnection
} from "./connection";

export function RokuDeviceRows({
  kind,
  contentId,
  adapterKey,
  currentRemote = true
}: {
  kind: "music" | "video";
  contentId?: string;
  adapterKey?: string;
  currentRemote?: boolean;
}) {
  const { colors } = useThemeColors(),
    state = useRokuConnection();
  useEffect(() => {
    const stop = observeRokuPicker();
    void refreshRokuConnection();
    return stop;
  }, []);
  const text = { color: colors.primary.heading },
    secondary = { color: colors.secondary.paragraph };
  const button = {
    minHeight: 44,
    paddingVertical: 12,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12
  };
  // Saved sign-ins and stale service responses are not discoverable receivers.
  const receivers = state.receivers.filter((r) => r.online && r.enabled);
  const connection = state.connection,
    snapshot = connection?.snapshot;
  const uncertain = state.stage === "unknown";
  if (!state.enabled && !connection) return null;
  return (
    <View testID="roku-devices" style={{ gap: 8 }}>
      <Text
        accessibilityRole="header"
        style={[text, { fontWeight: "600", marginTop: 16 }]}
      >
        Roku devices
      </Text>
      {!receivers.length && (
        <Text style={secondary}>
          No Roku is available yet. Open Heal Earth Club on your TV, sign in to the same account, and enable phone control in Account.
        </Text>
      )}
      {kind === "video" && !contentId && !connection && (
        <Text style={secondary}>
          This browser item has no account media ID. Choose a compatible library
          item; Bluetooth remains available.
        </Text>
      )}
      {receivers.map((receiver) => {
        const displayName =
          receivers.filter((r) => r.name === receiver.name).length > 1
            ? `${receiver.name} · ${receiver.id.slice(-4)}`
            : receiver.name;
        const selected =
          currentRemote &&
          connection?.receiverId === receiver.id &&
          connection.phase === "active" &&
          state.stage === "active";
        const available =
          (kind === "music" || !!contentId) &&
          eligible(receiver, kind === "music" ? "music" : "videos");
        const reason = !receiver.online
          ? "Open the app on your TV"
          : !receiver.enabled
          ? "Allow phone control in Roku Account"
          : receiver.protocol !== 1
          ? "Update the Roku app"
          : !receiver.capabilities.silentPrepare
          ? "Update Heal Earth Club on your TV"
          : !available
          ? "This item cannot transfer to TV"
          : selected
          ? "Connected"
          : "Ready to connect";
        return (
          <Pressable
            key={receiver.id}
            accessibilityRole="button"
            accessibilityLabel={displayName + ". " + reason}
            disabled={!available || state.busy || selected}
            onPress={() =>
              void connectRoku(
                { ...receiver, name: displayName },
                kind === "video" && contentId
                  ? { contentId, adapterKey }
                  : undefined
              )
            }
            style={button}
          >
            <AppIcon
              name="television"
              size={25}
              color={selected ? colors.primary.accent : colors.primary.icon}
            />
            <View style={{ flex: 1 }}>
              <Text style={[text, { fontWeight: "600" }]}>{displayName}</Text>
              <Text style={secondary}>{reason}</Text>
            </View>
            {selected && (
              <AppIcon name="check" size={23} color={colors.primary.accent} />
            )}
          </Pressable>
        );
      })}
      {state.busy && (
        <View accessibilityLiveRegion="polite" style={button}>
          <ActivityIndicator color={colors.primary.accent} />
          <Text style={text}>
            {state.stage === "consent"
              ? "Waiting for TV approval"
              : state.stage === "returning"
              ? "Returning to this iPhone"
              : "Connecting…"}
          </Text>
        </View>
      )}
      {!!state.error && (
        <Text accessibilityRole="alert" style={text}>
          {state.error}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={() => void refreshRokuConnection()}
        style={button}
      >
        <Text style={text}>Refresh devices</Text>
      </Pressable>
      {connection && (
        <View style={{ gap: 8 }}>
          <Text style={secondary}>
            {uncertain
              ? "Connection interrupted"
              : connection.phase === "active"
              ? `Playing on ${state.name}`
              : state.stage === "consent"
              ? `Waiting for approval on ${state.name}`
              : `Connecting to ${state.name}`}
          </Text>
          {!!snapshot?.duration && (
            <Text style={secondary}>
              {Math.floor(snapshot.position ?? 0)} /{" "}
              {Math.floor(snapshot.duration)} seconds
            </Text>
          )}
          {connection.phase === "active" && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
              <Pressable
                disabled={state.busy}
                accessibilityRole="button"
                accessibilityLabel="Previous on TV"
                style={button}
                onPress={() =>
                  void rokuAction("advance", {
                    direction: -1,
                    generation: snapshot?.generation,
                    queueIndex: snapshot?.queueIndex
                  })
                }
              >
                <AppIcon name="skip-previous" size={25} />
              </Pressable>
              <Pressable
                disabled={state.busy}
                accessibilityRole="button"
                accessibilityLabel={
                  snapshot?.phase === "playing" ? "Pause on TV" : "Play on TV"
                }
                style={button}
                onPress={() =>
                  void rokuAction("setPaused", {
                    paused: snapshot?.phase === "playing",
                    generation: snapshot?.generation
                  })
                }
              >
                <AppIcon
                  name={snapshot?.phase === "playing" ? "pause" : "play"}
                  size={25}
                />
              </Pressable>
              <Pressable
                disabled={state.busy}
                accessibilityRole="button"
                accessibilityLabel="Next on TV"
                style={button}
                onPress={() =>
                  void rokuAction("advance", {
                    direction: 1,
                    generation: snapshot?.generation,
                    queueIndex: snapshot?.queueIndex
                  })
                }
              >
                <AppIcon name="skip-next" size={25} />
              </Pressable>
              <Pressable
                disabled={state.busy || !snapshot?.seekable}
                accessibilityRole="button"
                style={button}
                onPress={() =>
                  void rokuAction("seek", {
                    position: Math.max(0, (snapshot?.position ?? 0) - 15),
                    generation: snapshot?.generation
                  })
                }
              >
                <Text style={text}>−15s</Text>
              </Pressable>
              <Pressable
                disabled={state.busy || !snapshot?.seekable}
                accessibilityRole="button"
                style={button}
                onPress={() =>
                  void rokuAction("seek", {
                    position: Math.min(
                      snapshot?.duration ?? 0,
                      (snapshot?.position ?? 0) + 15
                    ),
                    generation: snapshot?.generation
                  })
                }
              >
                <Text style={text}>+15s</Text>
              </Pressable>
              <Pressable
                disabled={state.busy}
                accessibilityRole="button"
                style={button}
                onPress={() =>
                  void rokuAction("setRepeat", {
                    repeat:
                      snapshot?.repeat === "off"
                        ? "all"
                        : snapshot?.repeat === "all"
                        ? "one"
                        : "off"
                  })
                }
              >
                <Text style={text}>Repeat: {snapshot?.repeat ?? "off"}</Text>
              </Pressable>
            </View>
          )}
          <Pressable
            disabled={state.busy}
            accessibilityRole="button"
            style={button}
            onPress={() => void returnToIPhone()}
          >
            <Text style={text}>Play on this iPhone</Text>
          </Pressable>
          {uncertain && (
            <Pressable
              disabled={state.busy}
              accessibilityRole="button"
              style={button}
              onPress={() =>
                Alert.alert(
                  "Play here anyway?",
                  "The TV may still be playing.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Play here anyway",
                      onPress: () => void returnToIPhone(true)
                    }
                  ]
                )
              }
            >
              <Text style={text}>TV unreachable? Play here anyway…</Text>
            </Pressable>
          )}
          <Pressable
            disabled={connection.phase === "active" && state.busy}
            accessibilityRole="button"
            style={button}
            onPress={() =>
              void (connection.phase === "active"
                ? rokuAction("stop")
                : cancelRokuConnection())
            }
          >
            <Text style={text}>
              {connection.phase === "active"
                ? "Stop on TV"
                : "Cancel connection"}
            </Text>
          </Pressable>
          {connection.phase === "active" && (
            <Pressable
              disabled={state.busy}
              accessibilityRole="button"
              style={button}
              onPress={() => void detachRokuController()}
            >
              <Text style={text}>Disconnect controller · TV keeps playing</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
