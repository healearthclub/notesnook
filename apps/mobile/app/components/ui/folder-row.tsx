import { useThemeColors } from "@notesnook/theme";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import AppIcon from "./AppIcon";

export const FOLDER_ROW_HEIGHT = 58;

export function FolderRow({
  title,
  count,
  onPress,
  onLongPress,
  testID,
  accessibilityLabel,
  depth = 0,
  selected,
  expanded,
  onToggleExpanded,
  expandTestID
}: {
  title: string;
  count: number;
  onPress?: () => void;
  onLongPress?: () => void;
  testID?: string;
  accessibilityLabel?: string;
  depth?: number;
  selected?: boolean;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  expandTestID?: string;
}) {
  const { colors } = useThemeColors();
  const chevron = (
    <AppIcon name={expanded ? "chevron-down" : "chevron-right"} size={20} />
  );

  return (
    <View
      style={[
        styles.row,
        {
          borderBottomColor: colors.primary.border,
          backgroundColor: selected ? colors.selected.background : undefined,
          paddingStart: 16 + Math.min(depth, 5) * 15
        }
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{
          selected,
          expanded: onToggleExpanded ? undefined : expanded
        }}
        testID={testID}
        onPress={onPress}
        onLongPress={onLongPress}
        style={[styles.button, onToggleExpanded && styles.withExpand]}
      >
        <AppIcon
          name="folder-outline"
          color={colors.primary.accent}
          size={23}
        />
        <Text
          style={[
            styles.title,
            {
              color: selected
                ? colors.selected.paragraph
                : colors.primary.heading
            }
          ]}
          numberOfLines={2}
        >
          {title}
        </Text>
        <Text style={{ color: colors.secondary.paragraph }}>{count}</Text>
        {!onToggleExpanded && chevron}
      </Pressable>
      {onToggleExpanded && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ expanded }}
          testID={expandTestID}
          onPress={onToggleExpanded}
          style={styles.expand}
        >
          {chevron}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    minHeight: FOLDER_ROW_HEIGHT,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  button: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    paddingEnd: 16
  },
  withExpand: { paddingEnd: 12 },
  title: { flex: 1, fontSize: 16, fontWeight: "600" },
  expand: {
    width: 36,
    justifyContent: "center",
    alignItems: "flex-start"
  }
});
