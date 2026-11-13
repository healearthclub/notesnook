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

import { strings } from "@notesnook/intl";
import { useThemeColors } from "@notesnook/theme";
import React, { useRef, useState } from "react";
import { Keyboard, StyleSheet, View } from "react-native";
import { TextInput } from "react-native-gesture-handler";
import AppIcon from "../../components/ui/AppIcon";
import { IconButton } from "../../components/ui/icon-button";
import Navigation from "../../services/navigation";
import useNavigationStore from "../../stores/use-navigation-store";
import { useSelectionStore } from "../../stores/use-selection-store";
import { AppFontSize } from "../../utils/size";
import { DefaultAppStyles } from "../../utils/styles";
export const SearchBar = ({
  onChangeText,
  rounded = false
}: {
  onChangeText: (value: string) => void;
  rounded?: boolean;
}) => {
  const [clearButton, setClearButton] = useState(false);
  const selectionMode = useSelectionStore((state) => state.selectionMode);
  const isFocused = useNavigationStore(
    (state) => state.focusedRouteId === "Search"
  );
  const { colors } = useThemeColors();
  const inputRef = useRef<TextInput>(null);
  const _onChangeText = (value: string) => {
    onChangeText(value);
    setClearButton(!!value);
  };

  return selectionMode && isFocused ? null : (
    <View
      style={{
        width: "100%",
        paddingHorizontal: DefaultAppStyles.GAP,
        ...(rounded ? styles.roundedRow : undefined)
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          width: rounded ? undefined : "100%",
          flex: rounded ? 1 : undefined,
          paddingHorizontal: DefaultAppStyles.GAP_SMALL,
          borderRadius: rounded ? 28 : 10,
          minHeight: rounded ? 48 : undefined,
          backgroundColor: rounded ? colors.primary.background : undefined,
          borderColor: colors.primary.border,
          borderWidth: 1,
          paddingVertical: 3
        }}
      >
        {rounded ? (
          <AppIcon name="magnify" size={23} color={colors.primary.heading} />
        ) : (
          <IconButton
            name="arrow-left"
            size={AppFontSize.xxl}
            top={10}
            bottom={10}
            onPress={() => {
              Navigation.goBack();
            }}
            color={colors.primary.paragraph}
            type="plain"
          />
        )}

        <TextInput
          ref={inputRef}
          testID="search-input"
          style={{
            fontSize: rounded ? AppFontSize.md : AppFontSize.sm,
            marginLeft: rounded ? 8 : undefined,
            fontFamily: "Inter-Regular",
            flex: 1,
            color: colors.primary.paragraph,
            paddingTop: 0,
            paddingBottom: 0
          }}
          autoFocus
          onChangeText={_onChangeText}
          accessibilityLabel={rounded ? strings.search() : undefined}
          placeholder={rounded ? strings.search() : strings.typeAKeyword()}
          textContentType="none"
          returnKeyLabel={strings.search()}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor={colors.primary.placeholder}
        />

        {clearButton ? (
          <IconButton
            name="close"
            size={AppFontSize.xxl}
            top={10}
            testID="clear-search"
            accessibilityLabel={strings.clear()}
            bottom={10}
            onPress={() => {
              inputRef.current?.clear();
              onChangeText("");
              setClearButton(false);
            }}
            color={colors.primary.paragraph}
            type="plain"
          />
        ) : null}
      </View>
      {rounded ? (
        <IconButton
          name="close"
          accessibilityRole="button"
          accessibilityLabel={strings.close()}
          testID="close-notes-search"
          color={colors.primary.heading}
          onPress={() => {
            Keyboard.dismiss();
            Navigation.goBack();
          }}
          style={{
            ...styles.close,
            borderColor: colors.primary.border,
            backgroundColor: colors.primary.background
          }}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  roundedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8
  },
  close: { width: 48, height: 48, borderRadius: 24, borderWidth: 1 }
});
