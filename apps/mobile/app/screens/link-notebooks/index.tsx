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

import { getId, Notebook } from "@notesnook/core";
import { strings } from "@notesnook/intl";
import { useThemeColors } from "@notesnook/theme";
import React, { useCallback, useEffect, useRef } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { FlatList } from "react-native-actions-sheet";
import { SafeAreaView } from "react-native-safe-area-context";
import { db } from "../../common/database";
import { bookmarkContent } from "../../features/browser/bookmarks";
import Navigation, { NavigationProps } from "../../services/navigation";
import {
  createNotebookTreeStores,
  TreeItem
} from "../../stores/create-notebook-tree-stores";
import { ItemSelection } from "../../stores/item-selection-store";
import { useNotebooks } from "../../stores/use-notebook-store";
import { useRelationStore } from "../../stores/use-relation-store";
import { updateNotebook } from "../../utils/notebooks";
import { AppFontSize } from "../../utils/size";
import { DefaultAppStyles } from "../../utils/styles";
import { BottomSheet } from "../../components/bottom-sheet";
import { FloatingButton } from "../../components/container/floating-button";
import { Header } from "../../components/header";
import { NotebookItem } from "../../components/side-menu/notebook-item";
import Input from "../../components/ui/input";
import Paragraph from "../../components/ui/typography/paragraph";
import { AddNotebookSheet } from "../../components/sheets/add-notebook";
import { Notice } from "../../components/ui/notice";
import { useNavigationFocus } from "../../hooks/use-navigation-focus";
import { isFeatureAvailable } from "@notesnook/common";
import {
  sendItemUpdateEvent,
  ToastManager
} from "../../services/event-manager";
import PaywallSheet from "../../components/sheets/paywall";

const {
  useNotebookExpandedStore,
  useNotebookSelectionStore,
  useNotebookTreeStore
} = createNotebookTreeStores(true, true, "link-notebooks-expanded-store");

async function updateInitialSelectionState(items: string[]) {
  const relations = await db.relations
    .to(
      {
        type: "note",
        ids: items
      },
      "notebook"
    )
    .get();

  const initialSelectionState: ItemSelection = {};
  const notebookIds = [
    ...new Set(relations.map((relation) => relation.fromId))
  ];

  for (const id of notebookIds) {
    const all = items.every((noteId) => {
      return (
        relations.findIndex(
          (relation) => relation.fromId === id && relation.toId === noteId
        ) > -1
      );
    });
    if (all) {
      initialSelectionState[id] = "selected";
    } else {
      initialSelectionState[id] = "intermediate";
    }
  }
  useNotebookSelectionStore.setState({
    initialState: initialSelectionState,
    selection: { ...initialSelectionState },
    multiSelect: relations.length > 1
  });
}

function LinkNotebooks(props: NavigationProps<"LinkNotebooks">) {
  if (Platform.OS !== "ios" || !props.route.params.website) {
    return <NotebookPicker {...props} />;
  }

  return (
    <BottomSheet
      label="bookmark picker"
      handleTestID="bookmark-sheet-grabber"
      onClose={props.navigation.goBack}
      heightFraction={0.5}
      avoidKeyboard
    >
      {({ close }) => <NotebookPicker {...props} dismissSheet={close} />}
    </BottomSheet>
  );
}

const NotebookPicker = (
  props: NavigationProps<"LinkNotebooks"> & { dismissSheet?: () => void }
) => {
  const { noteIds, website } = props.route.params;
  const { colors } = useThemeColors();
  const [notebooks, loading] = useNotebooks();
  const tree = useNotebookTreeStore((state) => state.tree);
  const searchQuery = useRef("");
  const searchTimer = useRef<NodeJS.Timeout>(undefined);
  const savedWebsiteId = useRef<string>(undefined);
  const savingWebsite = useRef(false);
  const [filteredNotebooks, setFilteredNotebooks] = React.useState(notebooks);

  useNavigationFocus(props.navigation, { focusOnInit: true });
  const loadRootNotebooks = React.useCallback(async () => {
    if (!filteredNotebooks) return;
    const _notebooks: Notebook[] = [];
    for (let i = 0; i < filteredNotebooks.placeholders.length; i++) {
      _notebooks[i] = (await filteredNotebooks?.item(i))?.item as Notebook;
    }
    const items = await useNotebookTreeStore
      .getState()
      .addNotebooks("root", _notebooks, 0);
    useNotebookTreeStore.getState().setTree(items);
  }, [filteredNotebooks]);

  const updateNotebooks = React.useCallback(() => {
    if (searchQuery.current) {
      db.lookup
        .notebooks(searchQuery.current)
        .sorted()
        .then((filtered) => {
          setFilteredNotebooks(filtered);
        });
    } else {
      setFilteredNotebooks(notebooks);
    }
  }, [notebooks]);

  useEffect(() => {
    updateNotebooks();
  }, [updateNotebooks]);

  useEffect(() => {
    (async () => {
      if (!loading) {
        loadRootNotebooks();
      }
    })();
  }, [loadRootNotebooks, loading]);

  const multiSelect = useNotebookSelectionStore((state) => state.multiSelect);

  const hasSelection = useNotebookSelectionStore((state) =>
    Object.keys(state.selection).some(
      (key) =>
        state.selection[key] && state.selection[key] !== state.initialState[key]
    )
  );

  useEffect(() => {
    if (noteIds) updateInitialSelectionState(noteIds);
    return () => {
      useNotebookSelectionStore.setState({
        initialState: {},
        selection: {},
        multiSelect: false,
        canEnableMultiSelectMode: true
      });
    };
  }, [noteIds]);

  const saveWebsite = async (folderIds: string[]) => {
    if (!website || !folderIds.length || savingWebsite.current) return;
    savingWebsite.current = true;
    try {
      for (const folderId of folderIds) {
        if (!(await db.notebooks.notebook(folderId))) {
          throw new Error("A selected folder is no longer available.");
        }
      }
      const id = savedWebsiteId.current ?? (savedWebsiteId.current = getId());
      if (!(await db.notes.note(id))) {
        await db.notes.add({
          id,
          title: website.title,
          content: {
            type: "tiptap",
            data: bookmarkContent(website.url)
          }
        });
      }
      for (const folderId of folderIds) {
        await db.notes.addToNotebook(folderId, id);
        updateNotebook(folderId);
        sendItemUpdateEvent(folderId, "notebook");
      }
      Navigation.queueRoutesForUpdate();
      useRelationStore.getState().update();
      if (props.navigation.isFocused()) {
        if (props.dismissSheet) props.dismissSheet();
        else props.navigation.goBack();
      }
      ToastManager.show({
        heading: "Website saved",
        type: "success",
        context: "global"
      });
    } catch (error) {
      ToastManager.error(error as Error);
    } finally {
      savingWebsite.current = false;
    }
  };

  const onSave = async () => {
    const selectionState = useNotebookSelectionStore.getState();
    const changedNotebooks = { ...selectionState.selection };

    if (website) {
      await saveWebsite(
        Object.keys(changedNotebooks).filter(
          (id) => changedNotebooks[id] === "selected"
        )
      );
      return;
    }
    if (!noteIds) return;

    if (!selectionState.multiSelect) {
      for (const id in selectionState.initialState) {
        if (
          selectionState.initialState[id] === "selected" &&
          changedNotebooks[id] !== "selected"
        ) {
          changedNotebooks[id] = "deselected";
        }
      }
    }

    for (const id in changedNotebooks) {
      const item = await db.notebooks.notebook(id);
      if (!item) continue;
      if (changedNotebooks[id] === "selected") {
        for (const id of noteIds) {
          await db.relations.add(item, { id: id, type: "note" });
          updateNotebook(item.id);
        }
      } else if (changedNotebooks[id] === "deselected") {
        for (const id of noteIds) {
          await db.relations.unlink(item, { id: id, type: "note" });
          updateNotebook(item.id);
        }
      }
      sendItemUpdateEvent(id, "notebook");
    }

    Navigation.queueRoutesForUpdate();
    useRelationStore.getState().update();
    Navigation.goBack();
  };

  const renderNotebook = useCallback(
    ({ item, index }: { item: TreeItem; index: number }) => (
      <NotebookItemWrapper item={item} index={index} />
    ),
    []
  );

  return (
    <SafeAreaView
      testID={props.dismissSheet ? "bookmark-folder-picker" : undefined}
      edges={props.dismissSheet ? ["bottom", "left", "right"] : undefined}
      style={{
        gap: DefaultAppStyles.GAP_VERTICAL,
        flex: 1,
        backgroundColor: colors.primary.background
      }}
    >
      <Header
        title={website ? "Save website to folder" : strings.addToFolder()}
        canGoBack
        onLeftMenuButtonPress={props.dismissSheet}
        rightButton={
          noteIds && hasSelection
            ? {
                name: "restore",
                onPress: () => {
                  updateInitialSelectionState(noteIds);
                }
              }
            : undefined
        }
      />
      <FlatList
        data={tree}
        windowSize={3}
        style={{
          width: "100%"
        }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View
            style={{
              paddingHorizontal: DefaultAppStyles.GAP,
              width: "100%",
              paddingVertical: DefaultAppStyles.GAP_VERTICAL
            }}
          >
            <Input
              placeholder={strings.searchFolders()}
              onChangeText={(value) => {
                searchQuery.current = value;
                searchTimer.current = setTimeout(() => {
                  updateNotebooks();
                }, 300);
              }}
              button={{
                icon: "plus",
                onPress: async () => {
                  const notebooksFeature = await isFeatureAvailable(
                    "notebooks"
                  );
                  if (!notebooksFeature.isAllowed) {
                    ToastManager.show({
                      message: notebooksFeature.error,
                      type: "info",
                      context: "local",
                      actionText: strings.upgrade(),
                      func: () => {
                        ToastManager.hide();
                        PaywallSheet.present(notebooksFeature);
                      }
                    });
                    return;
                  }
                  AddNotebookSheet.present(
                    undefined,
                    undefined,
                    "global",
                    undefined,
                    false,
                    searchQuery.current
                  );
                },
                color: colors.primary.icon
              }}
            />

            {!website && !multiSelect ? (
              <Notice
                text={strings.enableMultiSelect()}
                type="information"
                size="small"
              />
            ) : null}
          </View>
        }
        renderItem={renderNotebook}
        ListEmptyComponent={
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              alignItems: "center",
              height: 200,
              paddingHorizontal: DefaultAppStyles.GAP
            }}
          >
            {loading ? (
              <ActivityIndicator
                size={AppFontSize.lg}
                color={colors.primary.accent}
              />
            ) : (
              <Paragraph
                color={colors.primary.icon}
                style={{ textAlign: "center" }}
              >
                {strings.noFolders()}
              </Paragraph>
            )}
          </View>
        }
      />

      {hasSelection ? (
        <FloatingButton
          accessibilityLabel={website ? "Save website" : strings.save()}
          testID="floating-save-button"
          icon="check"
          alwaysVisible
          onPress={() => onSave()}
        />
      ) : null}
    </SafeAreaView>
  );
};

const NotebookItemWrapper = React.memo(
  ({
    item,
    index,
    onPress
  }: {
    item: TreeItem;
    index: number;
    onPress?: () => void;
  }) => {
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
    }, [expanded, item.depth, item.notebook.id]);

    return (
      <View
        style={{
          paddingHorizontal: DefaultAppStyles.GAP
        }}
      >
        <NotebookItem
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
          onLongPress={() => {
            useNotebookSelectionStore.setState({
              multiSelect: !useNotebookSelectionStore.getState().multiSelect
            });

            const state = useNotebookSelectionStore.getState();
            useNotebookSelectionStore
              .getState()
              .markAs(
                item.notebook,
                !selected
                  ? "selected"
                  : !state.initialState[item.notebook.id]
                  ? undefined
                  : "deselected"
              );
          }}
          canDisableSelectionMode={false}
          selected={selected}
          selectionEnabled={selectionEnabled}
          selectionStore={useNotebookSelectionStore}
          onItemUpdate={onItemUpdate}
          disableExpand={disableExpand}
          focused={false}
          onPress={onPress}
          onAddNotebook={async () => {
            const notebooksFeature = await isFeatureAvailable("notebooks");
            if (!notebooksFeature.isAllowed) {
              ToastManager.show({
                message: notebooksFeature.error,
                type: "info",
                context: "local",
                actionText: strings.upgrade(),
                func: () => {
                  ToastManager.hide();
                  PaywallSheet.present(notebooksFeature);
                }
              });
              return;
            }
            AddNotebookSheet.present(
              undefined,
              item.notebook,
              "global",
              undefined,
              false
            );
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
      prev.index === next.index &&
      prev.item.parentId === next.item.parentId
    );
  }
);
NotebookItemWrapper.displayName = "NotebookItemWrapper";
export default LinkNotebooks;
