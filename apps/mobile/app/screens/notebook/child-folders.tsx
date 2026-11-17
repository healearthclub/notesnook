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
import { Notebook } from "@notesnook/core";
import { strings } from "@notesnook/intl";
import { useThemeColors } from "@notesnook/theme";
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import AppIcon from "../../components/ui/AppIcon";
import { Pressable } from "../../components/ui/pressable";
import Heading from "../../components/ui/typography/heading";
import Paragraph from "../../components/ui/typography/paragraph";
import { useTotalNotes } from "../../hooks/use-db-item";
import { useRelationStore } from "../../stores/use-relation-store";
import { AppFontSize } from "../../utils/size";
import { DefaultAppStyles } from "../../utils/styles";

export function ChildFolders({
  folders,
  onOpen
}: {
  folders: Notebook[];
  onOpen: (folder: Notebook) => void;
}) {
  const { colors } = useThemeColors();
  const [expanded, setExpanded] = useState(true);
  const { totalNotes, getTotalNotes } = useTotalNotes("notebook");
  const updater = useRelationStore((state) => state.updater);

  useEffect(() => {
    getTotalNotes(folders.map(({ id }) => id));
  }, [folders, getTotalNotes, updater]);

  return (
    <View style={styles.section}>
      <Pressable
        type="transparent"
        noborder
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        testID="child-folders-toggle"
        style={styles.heading}
      >
        <Heading size={AppFontSize.md}>{strings.folders()}</Heading>
        <AppIcon name={expanded ? "chevron-down" : "chevron-right"} size={20} />
      </Pressable>
      {expanded && (
        <View testID="child-folders-list" style={styles.folders}>
          {folders.map((folder) => (
            <Pressable
              key={folder.id}
              accessibilityRole="button"
              accessibilityLabel={folder.title}
              accessibilityHint={strings.notes(totalNotes(folder.id))}
              type="secondary"
              noborder
              onPress={() => onOpen(folder)}
              style={styles.row}
            >
              <AppIcon
                name="folder-outline"
                color={colors.primary.accent}
                size={23}
              />
              <Heading
                numberOfLines={2}
                size={AppFontSize.sm}
                style={styles.title}
              >
                {folder.title}
              </Heading>
              <Paragraph
                size={AppFontSize.sm}
                color={colors.secondary.paragraph}
              >
                {totalNotes(folder.id)}
              </Paragraph>
              <AppIcon name="chevron-right" size={20} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: DefaultAppStyles.GAP,
    paddingTop: DefaultAppStyles.GAP_VERTICAL,
    paddingBottom: DefaultAppStyles.GAP_VERTICAL_SMALL
  },
  heading: {
    minHeight: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: DefaultAppStyles.GAP_SMALL
  },
  folders: {
    gap: DefaultAppStyles.GAP_VERTICAL_SMALL
  },
  row: {
    minHeight: 48,
    flexDirection: "row",
    gap: DefaultAppStyles.GAP_SMALL,
    alignItems: "center",
    paddingHorizontal: DefaultAppStyles.GAP,
    borderRadius: 24
  },
  title: {
    flex: 1
  }
});
