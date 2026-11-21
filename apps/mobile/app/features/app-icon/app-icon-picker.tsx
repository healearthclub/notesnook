import { useThemeColors } from "@notesnook/theme";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { create } from "zustand";
import { BottomSheet } from "../../components/bottom-sheet";
import AppIcon from "../../components/ui/AppIcon";
import {
  AppIconChoice,
  AppIconStatus,
  changeAppIcon,
  getAppIconStatus
} from "./app-icon";

const useIconPicker = create<{ visible: boolean }>(() => ({ visible: false }));
export function presentAppIconPicker() {
  useIconPicker.setState({ visible: true });
}

const choices = [
  {
    id: "black",
    title: "Black",
    image: require("../../assets/images/app-icons/black.png")
  },
  {
    id: "cream",
    title: "Cream",
    image: require("../../assets/images/app-icons/cream.png")
  },
  {
    id: "purple",
    title: "Purple gradient",
    image: require("../../assets/images/app-icons/purple.png")
  }
] as const;

export function AppIconPickerSheet() {
  const { colors } = useThemeColors();
  const visible = useIconPicker((state) => state.visible);
  const [status, setStatus] = useState<AppIconStatus>();
  const [pending, setPending] = useState<AppIconChoice>();
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const revision = useRef(0);
  const changing = useRef(false);
  const refreshStatus = useRef<(() => Promise<void>) | undefined>(undefined);
  const closePicker = () => useIconPicker.setState({ visible: false });

  useEffect(() => {
    if (!visible) return;
    const current = ++generation.current;
    setStatus(undefined);
    setPending(undefined);
    setError(undefined);
    const load = async () => {
      if (changing.current) return;
      const request = ++revision.current;
      try {
        const result = await getAppIconStatus();
        if (generation.current === current && request === revision.current)
          setStatus(result);
      } catch {
        if (generation.current === current && request === revision.current)
          setError(
            "Couldn’t load your app icon. Close this sheet and try again."
          );
      }
    };
    refreshStatus.current = load;
    void load();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => {
      generation.current++;
      refreshStatus.current = undefined;
      subscription.remove();
    };
  }, [visible]);

  async function select(choice: AppIconChoice) {
    if (changing.current || !status?.supported || status.selected === choice)
      return;
    changing.current = true;
    revision.current++;
    const current = generation.current;
    setPending(choice);
    setError(undefined);
    try {
      const result = await changeAppIcon(choice);
      if (generation.current === current) setStatus(result);
    } catch {
      if (generation.current === current)
        setError("Couldn’t change the app icon. Please try again.");
    } finally {
      changing.current = false;
      if (generation.current === current) setPending(undefined);
      else void refreshStatus.current?.();
    }
  }

  if (Platform.OS !== "ios") return null;
  return (
    <Modal
      visible={visible}
      transparent
      presentationStyle="overFullScreen"
      animationType="none"
      onRequestClose={closePicker}
    >
      {visible && (
        <BottomSheet
          label="App Icon"
          heightFraction={0.44}
          expandable
          onClose={closePicker}
        >
          {({ close, bottomInset }) => (
            <View style={styles.fill}>
              <View style={styles.header}>
                <Text
                  accessibilityRole="header"
                  style={[styles.heading, { color: colors.primary.heading }]}
                >
                  App Icon
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close app icon picker"
                  onPress={close}
                  style={styles.close}
                >
                  <AppIcon name="close" size={24} />
                </Pressable>
              </View>
              <ScrollView
                contentContainerStyle={[
                  styles.content,
                  { paddingBottom: bottomInset + 16 }
                ]}
              >
                <Text style={{ color: colors.secondary.paragraph }}>
                  Three looks. All included with Free.
                </Text>
                {!status && !error && (
                  <ActivityIndicator
                    accessibilityLabel="Loading app icon"
                    color={colors.primary.accent}
                  />
                )}
                {status && !status.supported && (
                  <Text style={{ color: colors.secondary.paragraph }}>
                    Changing app icons is unavailable in this build.
                  </Text>
                )}
                <View
                  style={styles.options}
                  accessibilityRole="radiogroup"
                  accessibilityLabel="Free app icons"
                >
                  {choices.map((choice) => {
                    const selected = status?.selected === choice.id;
                    return (
                      <Pressable
                        key={choice.id}
                        testID={`app-icon-${choice.id}`}
                        accessibilityRole="radio"
                        accessibilityLabel={`${choice.title}, free app icon`}
                        accessibilityState={{
                          checked: selected,
                          selected,
                          disabled: !status?.supported || !!pending,
                          busy: pending === choice.id
                        }}
                        disabled={!status?.supported || !!pending}
                        onPress={() => void select(choice.id)}
                        style={styles.option}
                      >
                        <View
                          style={[
                            styles.preview,
                            {
                              borderColor: selected
                                ? colors.primary.accent
                                : colors.primary.border
                            }
                          ]}
                        >
                          <Image
                            source={choice.image}
                            style={styles.image}
                            accessible={false}
                          />
                        </View>
                        <Text
                          style={[
                            styles.label,
                            { color: colors.primary.heading }
                          ]}
                        >
                          {choice.title}
                        </Text>
                        <View style={styles.indicator}>
                          {pending === choice.id ? (
                            <ActivityIndicator color={colors.primary.accent} />
                          ) : selected ? (
                            <AppIcon
                              testID={`app-icon-${choice.id}-selected`}
                              name="check-circle"
                              size={22}
                              color={colors.primary.accent}
                            />
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                {error && (
                  <Text
                    accessibilityRole="alert"
                    style={{ color: colors.primary.heading }}
                  >
                    {error}
                  </Text>
                )}
                {status?.selected === "original" ? (
                  <Text style={{ color: colors.secondary.paragraph }}>
                    Currently using the original icon.
                  </Text>
                ) : (
                  status?.supported && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Restore original app icon"
                      disabled={!!pending}
                      onPress={() => void select("original")}
                      style={styles.restore}
                    >
                      <Text style={{ color: colors.primary.accent }}>
                        Use original icon
                      </Text>
                    </Pressable>
                  )
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
  header: {
    paddingLeft: 20,
    paddingRight: 8,
    flexDirection: "row",
    alignItems: "center"
  },
  heading: { flex: 1, fontSize: 22, fontWeight: "700" },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  content: { paddingHorizontal: 20, gap: 16 },
  options: { flexDirection: "row", gap: 12, paddingTop: 4 },
  option: { flex: 1, minWidth: 0, alignItems: "center", gap: 9 },
  preview: {
    width: "100%",
    maxWidth: 94,
    aspectRatio: 1,
    padding: 3,
    borderRadius: 24,
    borderWidth: 2
  },
  image: { width: "100%", height: "100%", borderRadius: 19 },
  label: { fontSize: 14, fontWeight: "600", textAlign: "center" },
  indicator: { height: 24, justifyContent: "center" },
  restore: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }
});
