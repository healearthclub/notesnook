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
import React, { useContext, useEffect, useState } from "react";
import { TextInput, View } from "react-native";
import {
  BrowserRecentFolder,
  RecentBrowserTabsContext,
  recentBrowserTabs
} from "../../features/browser/browser-home";
import { db } from "../../common/database";
import NotebookScreen from "../../screens/notebook";
import {
  createNotebookTreeStores,
  TreeItem
} from "../../stores/create-notebook-tree-stores";
import useNavigationStore from "../../stores/use-navigation-store";
import { useNotebooks } from "../../stores/use-notebook-store";
import { AppFontSize } from "../../utils/size";
import { appBodyFont, DefaultAppStyles } from "../../utils/styles";
import { Properties } from "../properties";
import { FOLDER_ROW_HEIGHT } from "../ui/folder-row";
import { NotebookItem } from "./notebook-item";
import { SideMenuHeader } from "./side-menu-header";
import { SideMenuListEmpty } from "./side-menu-list-empty";
import {
  useSideMenuNotebookExpandedStore,
  useSideMenuNotebookSelectionStore,
  useSideMenuNotebookTreeStore
} from "./stores";
import { LegendList } from "@legendapp/list";
import { useRelationStore } from "../../stores/use-relation-store";
import { useSideMenuDismiss } from "./sheet-dismiss";
useSideMenuNotebookSelectionStore.setState({
  multiSelect: true
});

type FolderPresentation = "sidebar" | "notes";

const sidebarStores = {
  useNotebookTreeStore: useSideMenuNotebookTreeStore,
  useNotebookExpandedStore: useSideMenuNotebookExpandedStore,
  useNotebookSelectionStore: useSideMenuNotebookSelectionStore
};
const notesStores = createNotebookTreeStores(
  false,
  false,
  "notes-folder-tree-expanded"
);

function storesFor(presentation: FolderPresentation) {
  return presentation === "notes" ? notesStores : sidebarStores;
}

export const SideMenuNotebooks = ({
  presentation = "sidebar"
}: {
  presentation?: FolderPresentation;
}) => {
  const inNotes = presentation === "notes";
  const browserSession = useContext(RecentBrowserTabsContext);
  const showBrowserFolder =
    inNotes &&
    !!browserSession &&
    recentBrowserTabs(browserSession.tabs).length > 0;
  const { useNotebookTreeStore, useNotebookSelectionStore } =
    storesFor(presentation);
  const tree = useNotebookTreeStore((state) => state.tree);
  const [notebooks, loading] = useNotebooks();
  const [isLoading, setIsLoading] = useState(true);
  const { colors } = useThemeColors();
  const [filteredNotebooks, setFilteredNotebooks] = React.useState(notebooks);
  const searchTimer = React.useRef<NodeJS.Timeout>(undefined);
  const lastQuery = React.useRef<string>(undefined);
  const updater = useRelationStore((state) => state.updater);
  const loadRootNotebooks = React.useCallback(async () => {
    if (!filteredNotebooks) return;
    const _notebooks: Notebook[] = [];
    for (let i = 0; i < filteredNotebooks.placeholders.length; i++) {
      const notebook = (await filteredNotebooks.item(i))?.item;
      if (notebook) _notebooks.push(notebook);
    }
    const items = await useNotebookTreeStore
      .getState()
      .addNotebooks("root", _notebooks, 0);
    useNotebookTreeStore.getState().setTree(items);
  }, [filteredNotebooks, useNotebookTreeStore]);

  const updateNotebooks = React.useCallback(() => {
    if (lastQuery.current) {
      db.lookup
        .notebooks(lastQuery.current)
        .sorted(db.settings.getGroupOptions("notebooks"))
        .then((filtered) => {
          setFilteredNotebooks(filtered);
        });
    } else {
      setFilteredNotebooks(notebooks);
    }
  }, [notebooks]);

  useEffect(() => {
    updateNotebooks();
  }, [updateNotebooks, updater]);

  useEffect(() => {
    (async () => {
      if (!loading) {
        loadRootNotebooks();
        setIsLoading(false);
      }
    })();
  }, [loadRootNotebooks, loading]);

  useEffect(() => {
    if (inNotes) return;
    useNotebookSelectionStore.setState({
      selectAll: async () => {
        const allNotebooks = await db.notebooks.all.items();
        const allSelected = allNotebooks.every((notebook) => {
          return (
            useNotebookSelectionStore.getState().selection[notebook.id] ===
            "selected"
          );
        });

        if (allSelected) {
          useNotebookSelectionStore.setState({
            selection: {}
          });
          return;
        }

        useNotebookSelectionStore.setState({
          selection: allNotebooks.reduce((acc: any, item) => {
            acc[item.id] = "selected";
            return acc;
          }, {})
        });
      }
    });
  }, [inNotes, useNotebookSelectionStore]);

  const renderItem = React.useCallback(
    (info: { item: TreeItem; index: number }) => {
      return (
        <NotebookItemWrapper
          index={info.index}
          item={info.item}
          presentation={presentation}
        />
      );
    },
    [presentation]
  );

  return (
    <View
      style={inNotes ? { flex: 1 } : { height: "100%" }}
      testID={inNotes ? "notes-folders-list" : undefined}
    >
      {!showBrowserFolder && !notebooks?.placeholders.length ? (
        <SideMenuListEmpty
          placeholder={strings.noFolders()}
          isLoading={isLoading}
          showHeader={!inNotes}
        />
      ) : (
        <>
          <LegendList
            data={tree}
            bounces={false}
            bouncesZoom={false}
            overScrollMode="never"
            estimatedItemSize={inNotes ? FOLDER_ROW_HEIGHT : 30}
            ListHeaderComponent={
              inNotes ? (
                <BrowserRecentFolder />
              ) : (
                <View
                  style={{
                    backgroundColor: colors.primary.background,
                    paddingTop: DefaultAppStyles.GAP_VERTICAL
                  }}
                >
                  <SideMenuHeader />
                </View>
              )
            }
            renderItem={renderItem}
          />
          {!inNotes && (
            <View
              style={{
                width: "100%",
                paddingHorizontal: DefaultAppStyles.GAP,
                backgroundColor: colors.primary.background,
                borderTopColor: colors.primary.border,
                borderTopWidth: 1,
                paddingVertical: DefaultAppStyles.GAP_VERTICAL
              }}
            >
              <TextInput
                placeholder={strings.filterFolders()}
                style={{
                  fontFamily: appBodyFont,
                  fontSize: AppFontSize.xs,
                  paddingTop: 0,
                  paddingBottom: 0
                }}
                cursorColor={colors.primary.accent}
                onChangeText={async (value: string) => {
                  searchTimer.current && clearTimeout(searchTimer.current);
                  searchTimer.current = setTimeout(async () => {
                    lastQuery.current = value;
                    updateNotebooks();
                  }, 500);
                }}
                placeholderTextColor={colors.primary.placeholder}
              />
            </View>
          )}
        </>
      )}
    </View>
  );
};

const NotebookItemWrapper = React.memo(
  ({
    item,
    index,
    presentation
  }: {
    item: TreeItem;
    index: number;
    presentation: FolderPresentation;
  }) => {
    const inNotes = presentation === "notes";
    const {
      useNotebookTreeStore,
      useNotebookExpandedStore,
      useNotebookSelectionStore
    } = storesFor(presentation);
    const dismissMenu = useSideMenuDismiss();
    const expanded = useNotebookExpandedStore(
      (state) => state.expanded[item.notebook.id]
    );
    const disableExpand = useNotebookTreeStore((state) => state.isSearching);
    const selectionEnabled = useNotebookSelectionStore(
      (state) => state.enabled
    );
    const selected = useNotebookSelectionStore(
      (state) => state.selection[item.notebook.id] === "selected"
    );
    const focused = useNavigationStore(
      (state) => state.focusedRouteId === item.notebook.id
    );

    const onItemUpdate = React.useCallback(async () => {
      const notebook = await db.notebooks.notebook(item.notebook.id);
      if (notebook) {
        useNotebookTreeStore.getState().updateItem(item.notebook.id, notebook);
        if (expanded) {
          useNotebookTreeStore
            .getState()
            .setTree(
              await useNotebookTreeStore
                .getState()
                .fetchAndAdd(item.notebook.id, item.depth + 1)
            );
        }
      } else {
        useNotebookTreeStore.getState().removeItem(item.notebook.id);
      }
    }, [expanded, item.depth, item.notebook.id, useNotebookTreeStore]);

    return (
      <View
        style={
          inNotes
            ? undefined
            : {
                paddingHorizontal: DefaultAppStyles.GAP,
                marginTop: index === 0 ? DefaultAppStyles.GAP_VERTICAL : 0
              }
        }
      >
        <NotebookItem
          showFolderRow={inNotes}
          item={item}
          index={index}
          expanded={expanded}
          onToggleExpanded={async () => {
            useNotebookExpandedStore.getState().setExpanded(item.notebook.id);
            if (!expanded) {
              useNotebookTreeStore
                .getState()
                .setTree(
                  await useNotebookTreeStore
                    .getState()
                    .fetchAndAdd(item.notebook.id, item.depth + 1)
                );
            } else {
              useNotebookTreeStore.getState().removeChildren(item.notebook.id);
            }
          }}
          disableExpand={disableExpand}
          selected={selected}
          selectionEnabled={selectionEnabled}
          selectionStore={useNotebookSelectionStore}
          onItemUpdate={onItemUpdate}
          focused={focused}
          onPress={() => {
            NotebookScreen.navigate(item.notebook, inNotes);
            if (!inNotes) dismissMenu();
          }}
          onLongPress={() => {
            if (inNotes) {
              Properties.present(item.notebook);
              return;
            }
            Properties.present(item.notebook, false, [
              {
                id: "select",
                title: strings.selectFolder(),
                icon: "checkbox-outline",
                onPress: () => {
                  const store = useNotebookSelectionStore;
                  store.setState({
                    enabled: true,
                    selection: {}
                  });
                  store.getState().markAs(item.notebook, "selected");
                }
              }
            ]);
          }}
        />
      </View>
    );
  },
  (prev, next) => {
    return (
      prev.item.notebook.id === next.item.notebook.id &&
      prev.item.notebook.dateModified === next.item.notebook.dateModified &&
      prev.item.notebook.dateEdited === next.item.notebook.dateEdited &&
      prev.item.hasChildren === next.item.hasChildren &&
      prev.presentation === next.presentation &&
      prev.index === next.index &&
      prev.item.parentId === next.item.parentId
    );
  }
);
NotebookItemWrapper.displayName = "NotebookItemWrapper";
