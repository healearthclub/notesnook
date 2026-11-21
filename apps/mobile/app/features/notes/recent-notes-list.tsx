import type { Note } from "@notesnook/core";
import { strings } from "@notesnook/intl";
import { useThemeColors } from "@notesnook/theme";
import { decode, EntityLevel } from "entities";
import React, { useEffect, useState } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { DatabaseLogger, db } from "../../common/database";
import { openNote } from "../../components/list-items/note/wrapper";
import AppIcon from "../../components/ui/AppIcon";
import { ToastManager } from "../../services/event-manager";
import { getRecentNoteIds } from "./recent-notes";

type RecentNote = { note: Note; locked: boolean };
const visibleLimit = 5;

export function RecentNotesList() {
  const { colors } = useThemeColors();
  const [recent, setRecent] = useState<RecentNote[]>([]);

  useEffect(() => {
    let active = true;

    async function load() {
      const entries: RecentNote[] = [];
      for (const id of getRecentNoteIds()) {
        const note = await db.notes.note(id);
        if (!active) return;
        if (!note || note.archived) continue;
        const locked = await db.vaults.itemExists(note);
        entries.push({ note, locked });
        if (entries.length === visibleLimit) break;
      }
      if (active) setRecent(entries);
    }

    load().catch((error: Error) => DatabaseLogger.error(error));
    return () => {
      active = false;
    };
  }, []);

  return (
    <ScrollView
      style={styles.list}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      testID="recent-notes-list"
    >
      {recent.length ? (
        <Text
          accessibilityRole="header"
          style={[styles.heading, { color: colors.primary.heading }]}
        >
          Last opened
        </Text>
      ) : null}
      {recent.map(({ note, locked }) => (
        <Pressable
          key={note.id}
          accessibilityRole="button"
          onPress={() => {
            Keyboard.dismiss();
            openNote(note).catch((error: Error) => ToastManager.error(error));
          }}
          style={styles.row}
        >
          <View style={[styles.icon, { borderColor: colors.primary.border }]}>
            <AppIcon name={locked ? "lock" : "note-text-outline"} size={21} />
          </View>
          <View style={styles.copy}>
            <Text
              numberOfLines={1}
              style={[styles.title, { color: colors.primary.heading }]}
            >
              {note.title || strings.untitledNote()}
            </Text>
            {!locked && note.headline ? (
              <Text
                numberOfLines={1}
                style={[styles.preview, { color: colors.primary.paragraph }]}
              >
                {decode(note.headline, { level: EntityLevel.HTML })}
              </Text>
            ) : null}
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 16, gap: 16 },
  heading: { fontSize: 17, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 50 },
  icon: {
    width: 42,
    height: 42,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center"
  },
  copy: { flex: 1 },
  title: { fontSize: 17, fontWeight: "600" },
  preview: { fontSize: 14, marginTop: 2 }
});
