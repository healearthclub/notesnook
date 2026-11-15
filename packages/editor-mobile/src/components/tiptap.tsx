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
import { Editor, TiptapOptions, Toolbar, useTiptap } from "@notesnook/editor";
import { useEffect } from "react";
import { useTabContext } from "../hooks/useTabStore";
import { EmotionEditorToolbarTheme } from "../theme-factory";
import { post, Settings } from "../utils";
import { EditorEvents } from "../utils/editor-events";
import styles from "./styles.module.css";
export default function TiptapEditorWrapper(props: {
  options: Partial<TiptapOptions>;
  onEditorUpdate: (editor: Editor) => void;
  settings: Settings;
}) {
  const tab = useTabContext();
  const { colors } = useThemeColors("editorToolbar");
  const editor = useTiptap(props.options, [props.options]);
  globalThis.editors[tab.id] = editor;

  useEffect(() => {
    props.onEditorUpdate(editor);
  }, [editor, props]);

  const ios = globalThis.__PLATFORM__ === "ios";
  const toolbar = !tab.session?.locked && (
    <EmotionEditorToolbarTheme>
      <Toolbar
        className={`theme-scope-editorToolbar ${ios ? styles.keyboardTools : ""}`}
        sx={{
          display: props.settings.noToolbar ? "none" : "flex",
          overflowY: "hidden",
          minHeight: "45px"
        }}
        editor={editor}
        location="bottom"
        tools={
          Array.isArray(props.settings.tools) ? [...props.settings.tools] : []
        }
        defaultFontFamily={props.settings.fontFamily}
        defaultFontSize={props.settings.fontSize}
      />
    </EmotionEditorToolbarTheme>
  );

  if (!ios) return <>{toolbar}</>;

  const showActions =
    !tab.session?.locked && !tab.session?.readonly && !props.settings.readonly;

  return (
    <div className={styles.keyboardControls}>
      <div className={styles.formattingRow}>
        {toolbar}
        {showActions && (
          <button
            id="editor-send-note"
            className={styles.keyboardAction}
            type="button"
            aria-label="Send note"
            style={{
              backgroundColor: colors.primary.accent,
              color: colors.primary.accentForeground
            }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (!editor) return;
              const title =
                globalThis.editorTitles[tab.id]?.current?.value.trim();
              const body = editor.getText({ blockSeparator: "\n\n" }).trim();
              post(
                EditorEvents.sendNote,
                [title, body].filter(Boolean).join("\n\n"),
                tab.id
              );
            }}
          >
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 20V4m-7 7 7-7 7 7" />
            </svg>
          </button>
        )}
      </div>
      {showActions && (
        <div className={styles.keyboardAccessory}>
          <button
            id="editor-keyboard-done"
            className={styles.keyboardAction}
            type="button"
            aria-label={strings.done()}
            style={{
              backgroundColor: colors.secondary.background,
              color: colors.primary.accent
            }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => globalThis.commands.blur(tab.id)}
          >
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m5 12 4 4L19 6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
