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
import AppIcon from "../../components/ui/AppIcon";

type TabItem<Id extends string> = {
  id: Id;
  label: string;
  icon: string;
  selectedIcon: string;
};

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
  const { colors } = useThemeColors();

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
              {
                backgroundColor: colors.secondary.background,
                borderColor: selected ? colors.primary.accent : "transparent"
              }
            ]}
          >
            <AppIcon
              name={selected ? selectedIcon : icon}
              size={21}
              color={color}
            />
          </Pressable>
        );
      })}
    </View>
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
