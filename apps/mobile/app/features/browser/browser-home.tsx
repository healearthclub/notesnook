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
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import AppIcon from "../../components/ui/AppIcon";

export type BrowserTab = { id: number; address: string; title?: string };

function shortAddress(address: string) {
  return address.replace(/^https?:\/\/(?:www\.)?/i, "").replace(/\/$/, "");
}

export function tabLabel(tab: BrowserTab) {
  return tab.title || shortAddress(tab.address) || "New tab";
}

type BrowserHomeProps = {
  tabs: BrowserTab[];
  selectedId: number;
  onNew: () => void;
  onOpen: (id: number) => void;
  onClose: (id: number) => void;
};

export function BrowserHome({
  tabs,
  selectedId,
  onNew,
  onOpen,
  onClose
}: BrowserHomeProps) {
  const { colors } = useThemeColors();
  const pages = tabs.filter((tab) => tab.address || tabs.length > 1);
  const current = pages.find((tab) => tab.id === selectedId && tab.address);

  return (
    <View style={styles.home} testID="browser-home">
      <View style={styles.header}>
        <Text
          accessibilityRole="header"
          style={[styles.heading, { color: colors.primary.heading }]}
        >
          Browser
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New browser tab"
          testID="browser-add-tab"
          style={[
            styles.control,
            styles.add,
            { backgroundColor: colors.secondary.background }
          ]}
          onPress={onNew}
        >
          <AppIcon name="plus" color={colors.primary.accent} size={24} />
        </Pressable>
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
    </View>
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

function TabSummary({ tab, selected }: { tab: BrowserTab; selected: boolean }) {
  const { colors } = useThemeColors();
  return (
    <>
      <View style={[styles.icon, { backgroundColor: colors.primary.hover }]}>
        <AppIcon
          name="compass-outline"
          size={22}
          color={selected ? colors.primary.accent : colors.primary.paragraph}
        />
      </View>
      <View style={styles.summary}>
        <Text
          numberOfLines={1}
          style={[
            styles.title,
            {
              color: selected ? colors.primary.accent : colors.primary.heading
            }
          ]}
        >
          {tabLabel(tab)}
        </Text>
        {tab.title && tab.address ? (
          <Text numberOfLines={1} style={{ color: colors.primary.paragraph }}>
            {shortAddress(tab.address)}
          </Text>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  home: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
  summary: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: "600" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
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
