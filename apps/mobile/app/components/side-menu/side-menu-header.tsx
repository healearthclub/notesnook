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
import React from "react";
import { Image, View } from "react-native";
import { NOTESNOOK_LOGO_SVG } from "../../assets/images/assets";
import SettingsService from "../../services/settings";
import { useThemeStore } from "../../stores/use-theme-store";
import { useUserStore } from "../../stores/use-user-store";
import { AppFontSize } from "../../utils/size";
import { DefaultAppStyles } from "../../utils/styles";
import { UserSheet } from "../sheets/user";
import AppIcon from "../ui/AppIcon";
import { IconButton, IconButtonProps } from "../ui/icon-button";
import { Pressable } from "../ui/pressable";
import { SvgView } from "../ui/svg";
import Heading from "../ui/typography/heading";
import { useSideBarDraggingStore } from "./dragging-store";
import { useSideMenuSheetDismiss } from "./sheet-dismiss";
import SyncStatusButton from "./sync-status-button";

const SettingsIcon = () => {
  const { colors } = useThemeColors();
  const userProfile = useUserStore((state) => state.profile);

  return (
    <Pressable
      onPress={() => {
        if (useSideBarDraggingStore.getState().dragging) return;
        UserSheet.present();
      }}
      testID="sidemenu-settings-icon"
      style={{
        width: 40,
        height: 40
      }}
    >
      {userProfile?.profilePicture ? (
        <Image
          source={{
            uri: userProfile?.profilePicture
          }}
          style={{
            width: 25,
            height: 25,
            borderRadius: 100
          }}
        />
      ) : (
        <AppIcon
          name="cog-outline"
          color={colors.primary.icon}
          size={AppFontSize.lg}
        />
      )}
    </Pressable>
  );
};

export function SideMenuThemeButton({ inHeader = false }) {
  const { colors, isDark } = useThemeColors();
  const size = inHeader ? 40 : 28;

  return (
    <IconButton
      onPress={() => {
        SettingsService.set({ useSystemTheme: false });
        useThemeStore.getState().setColorScheme();
      }}
      style={{ width: size, height: size }}
      top={10}
      testID="sidebar-theme-button"
      accessibilityRole="switch"
      accessibilityLabel={strings.darkMode()}
      accessibilityState={{ checked: isDark }}
      color={colors.primary.icon}
      name={isDark ? "weather-night" : "weather-sunny"}
      size={inHeader ? AppFontSize.lg : AppFontSize.lg - 2}
    />
  );
}

export const SideMenuHeader = (props: { rightButtons?: IconButtonProps[] }) => {
  const { colors } = useThemeColors();
  const inSheet = Boolean(useSideMenuSheetDismiss());
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: inSheet ? "flex-end" : "space-between",
        alignItems: "center",
        borderBottomWidth: 1,
        borderBottomColor: colors.primary.border,
        paddingBottom: DefaultAppStyles.GAP,
        paddingHorizontal: DefaultAppStyles.GAP
      }}
    >
      {inSheet ? null : (
        <View
          style={{
            flexDirection: "row",
            gap: DefaultAppStyles.GAP_SMALL,
            alignItems: "center"
          }}
        >
          <View
            style={{
              backgroundColor: "black",
              width: 28,
              height: 28,
              borderRadius: 10
            }}
          >
            <SvgView width={28} height={28} src={NOTESNOOK_LOGO_SVG} />
          </View>

          <Heading size={AppFontSize.lg}>Notesnook</Heading>
        </View>
      )}

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: DefaultAppStyles.GAP_SMALL
        }}
      >
        {props.rightButtons?.map((button, index) => (
          <IconButton
            key={index}
            {...button}
            style={{
              width: 28,
              height: 28
            }}
            color={colors.primary.icon}
            size={AppFontSize.lg}
          />
        ))}
        <SyncStatusButton />
        {inSheet ? <SideMenuThemeButton inHeader /> : null}
        <SettingsIcon />
      </View>
    </View>
  );
};
