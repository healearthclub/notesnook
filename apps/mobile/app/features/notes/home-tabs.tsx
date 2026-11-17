import { strings } from "@notesnook/intl";
import { useThemeColors } from "@notesnook/theme";
import React, { ReactNode, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const tabs = [
  { id: "recents", label: strings.recents },
  { id: "folders", label: strings.folders },
  { id: "music", label: () => "Music" }
] as const;

export type NotesHomeTab = (typeof tabs)[number]["id"];
export function NotesHomeTabs({
  value,
  onChange,
  recents,
  folders,
  music
}: {
  value: NotesHomeTab;
  onChange: (tab: NotesHomeTab) => void;
  recents: ReactNode;
  folders: ReactNode;
  music: ReactNode;
}) {
  const { colors } = useThemeColors();
  const pager = useRef<ScrollView>(null);
  const [pageWidth, setPageWidth] = useState(0);
  const previousContentWidth = useRef(0);
  const pages = { recents, folders, music };

  return (
    <>
      <View accessibilityRole="tablist" style={styles.row}>
        {tabs.map(({ id, label }, index) => {
          const selected = value === id;
          return (
            <Pressable
              key={id}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => {
                onChange(id);
                pager.current?.scrollTo({
                  x: index * pageWidth,
                  animated: true
                });
              }}
              style={[
                styles.tab,
                {
                  borderBottomColor: selected
                    ? colors.primary.accent
                    : "transparent"
                }
              ]}
              testID={`notes-header-${id}`}
            >
              <Text
                style={[
                  styles.label,
                  {
                    color: selected
                      ? colors.primary.accent
                      : colors.secondary.paragraph
                  }
                ]}
              >
                {label()}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <ScrollView
        ref={pager}
        testID="notes-home-pager"
        style={styles.pager}
        horizontal
        pagingEnabled
        directionalLockEnabled
        bounces={false}
        scrollsToTop={false}
        showsHorizontalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        onLayout={({ nativeEvent }) => setPageWidth(nativeEvent.layout.width)}
        onContentSizeChange={(width) => {
          if (width === previousContentWidth.current || !pageWidth) return;
          previousContentWidth.current = width;
          pager.current?.scrollTo({
            x: tabs.findIndex(({ id }) => id === value) * pageWidth,
            animated: false
          });
        }}
        onScrollEndDrag={({ nativeEvent }) => {
          const x =
            nativeEvent.targetContentOffset?.x ?? nativeEvent.contentOffset.x;
          if (!pageWidth) return;
          const index = Math.max(
            0,
            Math.min(tabs.length - 1, Math.round(x / pageWidth))
          );
          onChange(tabs[index].id);
        }}
      >
        {pageWidth > 0 &&
          tabs.map(({ id }) => (
            <View
              key={id}
              style={{ width: pageWidth }}
              accessibilityElementsHidden={id !== value}
            >
              {pages[id]}
            </View>
          ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  pager: { flex: 1 },
  row: {
    flexDirection: "row",
    gap: 20,
    paddingHorizontal: 16,
    marginBottom: 6
  },
  tab: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2
  },
  label: { fontSize: 17, fontWeight: "600" }
});
