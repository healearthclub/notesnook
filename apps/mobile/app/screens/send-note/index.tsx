import { strings } from "@notesnook/intl";
import { useThemeColors } from "@notesnook/theme";
import React, { useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import AppIcon from "../../components/ui/AppIcon";
import useGlobalSafeAreaInsets from "../../hooks/use-global-safe-area-insets";
import { ToastManager } from "../../services/event-manager";
import type { NavigationProps } from "../../services/navigation";

type Destination = {
  name: string;
  detail?: string;
  icon: string;
  available: boolean;
};

const groups: {
  title: string;
  detail?: string;
  destinations: Destination[];
}[] = [
  {
    title: "Post to",
    destinations: [
      {
        name: "My Blog",
        detail: "Publishing unavailable",
        icon: "notebook-outline",
        available: false
      },
      {
        name: "My Story",
        detail: "Publishing unavailable",
        icon: "star-outline",
        available: false
      }
    ]
  },
  {
    title: "Send to",
    destinations: [
      {
        name: "My friends",
        detail: "Choose a person or app in iOS",
        icon: "account-outline",
        available: true
      }
    ]
  },
  {
    title: "Social media",
    detail: "Publishing unavailable",
    destinations: [
      "Instagram",
      "TikTok",
      "Twitter",
      "YouTube",
      "LinkedIn",
      "Rumble",
      "VSCO"
    ].map((name) => ({
      name,
      icon: "share-variant",
      available: false
    }))
  }
];

export default function SendNoteScreen({
  navigation,
  route
}: NavigationProps<"SendNote">) {
  const { colors } = useThemeColors();
  const insets = useGlobalSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(false);
  const sharing = useRef(false);
  const search = query.trim().toLowerCase();
  const matchingGroups = groups
    .map((group) => ({
      ...group,
      destinations: group.destinations.filter(({ name }) =>
        name.toLowerCase().includes(search)
      )
    }))
    .filter(({ destinations }) => destinations.length);

  const send = async () => {
    if (!selected || sharing.current) return;
    sharing.current = true;
    Keyboard.dismiss();
    try {
      const result = await Share.share({ message: route.params.message });
      if (result.action === Share.sharedAction) navigation.goBack();
    } catch (error) {
      ToastManager.error(error as Error);
    } finally {
      sharing.current = false;
    }
  };

  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: colors.primary.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right
        }
      ]}
      testID="send-note-screen"
    >
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.cancel()}
            onPress={() => navigation.goBack()}
            style={styles.back}
            testID="send-note-back"
          >
            <AppIcon
              name="chevron-down"
              size={27}
              color={colors.primary.icon}
            />
          </Pressable>
          <Text
            accessibilityRole="header"
            style={[styles.heading, { color: colors.primary.heading }]}
          >
            Send note
          </Text>
        </View>
        <View
          style={[
            styles.search,
            { backgroundColor: colors.secondary.background }
          ]}
        >
          <AppIcon name="magnify" size={20} color={colors.primary.icon} />
          <TextInput
            accessibilityLabel="Search recipients"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            onChangeText={setQuery}
            placeholder="Search recipients"
            placeholderTextColor={colors.primary.paragraph}
            returnKeyType="search"
            style={[styles.searchInput, { color: colors.primary.paragraph }]}
            testID="send-note-search"
            value={query}
          />
        </View>
        <ScrollView
          style={styles.screen}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          {matchingGroups.map(({ title, detail, destinations }) => (
            <View key={title} style={styles.group}>
              <Text
                accessibilityRole="header"
                style={[styles.groupTitle, { color: colors.primary.heading }]}
              >
                {title}
              </Text>
              {detail && (
                <Text
                  style={[
                    styles.detail,
                    styles.groupDetail,
                    { color: colors.primary.paragraph }
                  ]}
                >
                  {detail}
                </Text>
              )}
              {destinations.map((destination) => {
                const checked = destination.available && selected;
                return (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityLabel={destination.name}
                    accessibilityHint={destination.detail || detail}
                    accessibilityState={{
                      checked,
                      disabled: !destination.available
                    }}
                    disabled={!destination.available}
                    key={destination.name}
                    onPress={() => {
                      Keyboard.dismiss();
                      setSelected((value) => !value);
                    }}
                    style={[
                      styles.row,
                      { borderBottomColor: colors.primary.border }
                    ]}
                    testID={
                      destination.available ? "send-note-friends" : undefined
                    }
                  >
                    <View
                      style={[
                        styles.icon,
                        { backgroundColor: colors.secondary.background }
                      ]}
                    >
                      <AppIcon
                        name={destination.icon}
                        size={22}
                        color={colors.primary.icon}
                      />
                    </View>
                    <View style={styles.screen}>
                      <Text
                        style={[styles.name, { color: colors.primary.heading }]}
                      >
                        {destination.name}
                      </Text>
                      {destination.detail && (
                        <Text
                          style={[
                            styles.detail,
                            { color: colors.primary.paragraph }
                          ]}
                        >
                          {destination.detail}
                        </Text>
                      )}
                    </View>
                    <AppIcon
                      name={
                        checked
                          ? "radiobox-marked"
                          : "checkbox-blank-circle-outline"
                      }
                      size={25}
                      color={
                        checked ? colors.primary.accent : colors.primary.icon
                      }
                    />
                  </Pressable>
                );
              })}
            </View>
          ))}
          {matchingGroups.length === 0 && (
            <Text style={[styles.empty, { color: colors.primary.paragraph }]}>
              No matching recipients
            </Text>
          )}
        </ScrollView>
        {selected && (
          <View
            style={[styles.footer, { borderTopColor: colors.primary.border }]}
          >
            <Text
              style={[
                styles.name,
                styles.screen,
                { color: colors.primary.heading }
              ]}
            >
              My friends
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.send()}
              onPress={send}
              style={[styles.send, { backgroundColor: colors.primary.accent }]}
              testID="send-note-confirm"
            >
              <Text
                style={[
                  styles.name,
                  { color: colors.primary.accentForeground }
                ]}
              >
                {strings.send()}
              </Text>
              <AppIcon
                name="arrow-right"
                size={20}
                color={colors.primary.accentForeground}
              />
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    marginBottom: 8
  },
  back: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  heading: { fontSize: 22, fontWeight: "700" },
  search: {
    minHeight: 44,
    marginHorizontal: 16,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    paddingHorizontal: 14,
    borderRadius: 22
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 10 },
  group: { marginTop: 22 },
  groupTitle: {
    fontSize: 14,
    fontWeight: "700",
    marginHorizontal: 16,
    marginBottom: 6
  },
  groupDetail: { marginHorizontal: 16, marginBottom: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 9,
    minHeight: 60,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center"
  },
  name: { fontSize: 16, fontWeight: "600" },
  detail: { fontSize: 13, marginTop: 2, opacity: 0.72 },
  empty: { textAlign: "center", marginTop: 32 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  send: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: 18
  }
});
