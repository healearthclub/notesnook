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
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import AppIcon from "../../components/ui/AppIcon";

type TabItem<Id extends string> = {
  id: Id;
  label: string;
} & (
  | { icon: "heal-earth-home"; selectedIcon?: never }
  | { icon: string; selectedIcon: string }
);

type BottomTabBarProps<Id extends string> = {
  tabs: readonly TabItem<Id>[];
  selectedTab: Id;
  onSelectTab: (id: Id) => void;
  bottomInset: number;
};

export function BottomTabBar<Id extends string>({
  tabs,
  selectedTab,
  onSelectTab,
  bottomInset
}: BottomTabBarProps<Id>) {
  const { colors, isDark } = useThemeColors();

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        {
          backgroundColor: colors.primary.background,
          paddingBottom: bottomInset + 4
        }
      ]}
    >
      {tabs.map(({ id, label, icon, selectedIcon }) => {
        const selected = id === selectedTab;
        const color = selected
          ? colors.primary.heading
          : colors.primary.paragraph;
        return (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            testID={`main-tab-${id}`}
            onPress={() => onSelectTab(id)}
            style={[
              styles.tab,
              tabs.length > 3 && styles.compactTab,
              {
                backgroundColor: colors.secondary.background,
                borderColor: selected ? colors.primary.accent : "transparent"
              },
              isDark && styles.darkGlow,
              isDark && selected && styles.selectedDarkGlow
            ]}
          >
            {icon === "heal-earth-home" ? (
              <HomeSmileIcon
                color={color}
                selected={selected}
                background={colors.secondary.background}
              />
            ) : (
              <AppIcon
                name={(selected && selectedIcon) || icon}
                size={21}
                color={color}
              />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

// The home mark used in Heal Earth Club's navigation.
function HomeSmileIcon({
  color,
  selected,
  background
}: {
  color: string;
  selected: boolean;
  background: string;
}) {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" accessible={false}>
      <Path
        d="M10.1 2.5a2.8 2.8 0 0 1 3.8 0l6.7 6.1A4.4 4.4 0 0 1 22 11.9V19a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-7.1a4.4 4.4 0 0 1 1.4-3.3z"
        fill={selected ? color : "none"}
        stroke={selected ? "none" : color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Path
        d="M9 16.1c1.7 1.3 4.3 1.3 6 0"
        fill="none"
        stroke={selected ? background : color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 8
  },
  darkGlow: {
    shadowColor: "#42FF83",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 5
  },
  selectedDarkGlow: {
    shadowOpacity: 0.32
  },
  compactTab: { flex: 1, minWidth: 44, maxWidth: 72 },
  tab: {
    minWidth: 72,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center"
  }
});
