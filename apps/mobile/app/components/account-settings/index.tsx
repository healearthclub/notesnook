import { strings } from "@notesnook/intl";
import { useThemeColors } from "@notesnook/theme";
import Clipboard from "@react-native-clipboard/clipboard";
import React from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { ToastManager } from "../../services/event-manager";
import Navigation from "../../services/navigation";
import { AuthMode } from "../auth/common";
import AppIcon from "../ui/AppIcon";

export function getAccountSettingsActions(beforeSettings?: () => void) {
  return [
    {
      icon: "cog-outline",
      title: strings.settings(),
      onPress: () => {
        beforeSettings?.();
        Navigation.navigate("Settings");
      }
    },
    {
      icon: "email",
      title: strings.emailSupport(),
      onPress: () => {
        const address = "support@streetwriters.co";
        Clipboard.setString(address);
        ToastManager.show({
          heading: strings.emailCopied(),
          type: "success",
          icon: "content-copy"
        });
        setTimeout(() => {
          void Linking.openURL(`mailto:${address}`).catch(() => {
            // The address is available on the clipboard if Mail is unavailable.
          });
        }, 1000);
      }
    },
    {
      icon: "file-document",
      title: strings.documentation(),
      onPress: () => {
        void Linking.openURL("https://docs.notesnook.com");
      }
    }
  ];
}

export function ProfileAccount({ email }: { email: string }) {
  const { colors } = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Manage ohai account, ${email}`}
      testID="profile-manage-account"
      style={[styles.row, { backgroundColor: colors.secondary.background }]}
      onPress={() => Navigation.navigate("Auth", { mode: AuthMode.login })}
    >
      <AppIcon name="account-outline" color={colors.primary.accent} size={23} />
      <View style={styles.copy}>
        <Text style={[styles.label, { color: colors.primary.heading }]}>
          Manage ohai account
        </Text>
        <Text style={[styles.email, { color: colors.secondary.paragraph }]}>
          {email}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    borderRadius: 16,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  label: { flexShrink: 1, fontSize: 16, fontWeight: "600" },
  email: { fontSize: 14 }
});
