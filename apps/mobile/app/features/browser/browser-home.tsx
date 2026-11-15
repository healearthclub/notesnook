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
import React, { useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import AppIcon from "../../components/ui/AppIcon";

import { faviconForAddress } from "./browser-metadata";

export type BrowserTab = {
  id: number;
  address: string;
  title?: string;
  favicon?: string;
};

function tabLabel(tab: BrowserTab) {
  return tab.title || (tab.address ? "Untitled page" : "New tab");
}

type BrowserHomeProps = {
  tabs: BrowserTab[];
  selectedId: number;
  keyboardAvoidanceEnabled: boolean;
  onSubmitAddress: (input: string) => void;
  onNew: () => void;
  onOpen: (id: number) => void;
  onClose: (id: number) => void;
};

export function BrowserHome({
  tabs,
  selectedId,
  keyboardAvoidanceEnabled,
  onSubmitAddress,
  onNew,
  onOpen,
  onClose
}: BrowserHomeProps) {
  const { colors } = useThemeColors();
  const [input, setInput] = useState("");
  const pages = tabs.filter((tab) => tab.address || tabs.length > 1);
  const current = pages.find((tab) => tab.id === selectedId && tab.address);

  return (
    <KeyboardAvoidingView
      behavior="padding"
      enabled={keyboardAvoidanceEnabled}
      style={styles.home}
      testID="browser-home"
    >
      <View style={styles.header}>
        <Text
          accessibilityRole="header"
          style={[styles.heading, { color: colors.primary.heading }]}
        >
          Browser
        </Text>
      </View>
      {pages.length ? (
        <ScrollView
          style={styles.home}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        >
          {pages.map((tab) => (
            <View
              key={tab.id}
              style={[styles.row, { borderBottomColor: colors.primary.border }]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tabLabel(tab)}
                accessibilityState={{ selected: tab.id === selectedId }}
                testID={`browser-home-tab-${tab.id}`}
                onPress={() => onOpen(tab.id)}
                style={styles.rowButton}
              >
                <TabSummary tab={tab} selected={tab.id === selectedId} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Close ${tabLabel(tab)}`}
                testID={`browser-close-tab-${tab.id}`}
                onPress={() => onClose(tab.id)}
                style={styles.control}
              >
                <AppIcon
                  name="close"
                  color={colors.primary.paragraph}
                  size={19}
                />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.empty}>
          <Text style={{ color: colors.primary.paragraph }}>No open pages</Text>
        </View>
      )}
      {current ? (
        <BrowserTabCard
          tab={current}
          testID="browser-home-resume-tab"
          onPress={() => onOpen(current.id)}
        />
      ) : null}
      <View style={styles.addressRow}>
        <View
          style={[
            styles.addressBar,
            { backgroundColor: colors.secondary.background }
          ]}
        >
          <AppIcon name="magnify" color={colors.primary.paragraph} size={21} />
          <TextInput
            accessibilityLabel="Search or enter a website"
            testID="browser-home-address"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="web-search"
            placeholder="Search or address"
            placeholderTextColor={colors.primary.paragraph}
            returnKeyType="go"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={({ nativeEvent }) => {
              if (!nativeEvent.text.trim()) return;
              onSubmitAddress(nativeEvent.text);
              setInput("");
            }}
            style={[styles.addressInput, { color: colors.primary.heading }]}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New browser tab"
          testID="browser-add-tab"
          style={[
            styles.control,
            styles.add,
            { backgroundColor: colors.primary.shade }
          ]}
          onPress={onNew}
        >
          <AppIcon name="plus" color={colors.primary.accent} size={24} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

export function BrowserTabCard({
  tab,
  testID = "browser-resume-tab",
  onPress
}: {
  tab: BrowserTab;
  testID?: string;
  onPress: () => void;
}) {
  const { colors } = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Resume browser tab, ${tabLabel(tab)}`}
      testID={testID}
      onPress={onPress}
      style={[
        styles.card,
        {
          backgroundColor: colors.secondary.background,
          borderColor: colors.primary.border
        }
      ]}
    >
      <TabSummary tab={tab} selected />
      <AppIcon name="chevron-up" color={colors.primary.paragraph} size={24} />
    </Pressable>
  );
}

function SiteFavicon({
  preferred,
  fallback,
  color
}: {
  preferred?: string;
  fallback?: string;
  color: string;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<string>();
  const uri = preferred && failed.includes(preferred) ? fallback : preferred;
  const showImage = !!uri && !failed.includes(uri);
  return (
    <>
      {(!showImage || loaded !== uri) && (
        <AppIcon name="compass-outline" size={22} color={color} />
      )}
      {showImage && (
        <Image
          source={{ uri }}
          testID={loaded === uri ? "browser-site-favicon" : undefined}
          onLoad={() => setLoaded(uri)}
          onError={() => setFailed((previous) => [...previous, uri])}
          style={styles.favicon}
          resizeMode="contain"
          accessible={false}
        />
      )}
    </>
  );
}

function TabSummary({ tab, selected }: { tab: BrowserTab; selected: boolean }) {
  const { colors } = useThemeColors();
  const fallback = faviconForAddress(tab.address);
  const preferred =
    faviconForAddress(
      tab.address,
      typeof tab.favicon === "string" ? tab.favicon : undefined
    ) ?? fallback;
  return (
    <>
      <View style={[styles.icon, { backgroundColor: colors.primary.hover }]}>
        <SiteFavicon
          key={preferred}
          preferred={preferred}
          fallback={fallback}
          color={selected ? colors.primary.accent : colors.primary.paragraph}
        />
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.title,
          { color: selected ? colors.primary.accent : colors.primary.heading }
        ]}
      >
        {tabLabel(tab)}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  home: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  heading: { fontSize: 28, fontWeight: "700" },
  control: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  add: { borderRadius: 16 },
  list: { paddingHorizontal: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  rowButton: {
    flex: 1,
    minHeight: 60,
    alignItems: "center",
    flexDirection: "row",
    gap: 10
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center"
  },
  favicon: { position: "absolute", width: 24, height: 24, borderRadius: 4 },
  title: { flex: 1, fontSize: 15, fontWeight: "600" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 12,
    marginVertical: 6
  },
  addressBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    borderRadius: 22
  },
  addressInput: {
    flex: 1,
    minHeight: 44,
    paddingLeft: 8,
    fontSize: 16
  },
  card: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth
  }
});
