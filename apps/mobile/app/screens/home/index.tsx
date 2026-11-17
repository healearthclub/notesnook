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

import { isFeatureAvailable } from "@notesnook/common";
import { strings } from "@notesnook/intl";
import React, { useState } from "react";
import { Platform } from "react-native";
import { FloatingButton } from "../../components/container/floating-button";
import DelayLayout from "../../components/delay-layout";
import { Header } from "../../components/header";
import { AddNotebookSheet } from "../../components/sheets/add-notebook";
import PaywallSheet from "../../components/sheets/paywall";
import { SideMenuNotebooks } from "../../components/side-menu/side-menu-notebooks";
import { NotesHomeTab, NotesHomeTabs } from "../../features/notes/home-tabs";
import { NotesListLayout } from "../../features/notes/list-layout";
import List from "../../components/list";
import SelectionHeader from "../../components/selection-header";
import { useNavigationFocus } from "../../hooks/use-navigation-focus";
import Navigation, { NavigationProps } from "../../services/navigation";
import SettingsService from "../../services/settings";
import useNavigationStore from "../../stores/use-navigation-store";
import { useNotes } from "../../stores/use-notes-store";
import { useSelectionStore } from "../../stores/use-selection-store";
import { openEditor } from "../notes/common";
import { MusicHome } from "../../features/notes/music-home";
import { db } from "../../common/database";

export const Home = ({ navigation, route }: NavigationProps<"Notes">) => {
  const [notes, loading] = useNotes();
  const isIOS = Platform.OS === "ios";
  const [tab, setTab] = useState<NotesHomeTab>("recents");
  const showFolders = isIOS && tab === "folders";

  const isFocused = useNavigationFocus(navigation, {
    onFocus: (prev) => {
      Navigation.routeNeedsUpdate(
        route.name,
        Navigation.routeUpdateFunctions[route.name]
      );
      useNavigationStore.getState().setFocusedRouteId(route.name);
      return !prev?.current;
    },
    onBlur: () => false,
    delay: SettingsService.get().homepage === route.name ? 1 : -1
  });

  const searchBar = (
    <Header
      renderedInRoute={route.name}
      title={showFolders ? strings.folders() : strings.routes[route.name]()}
      canGoBack={false}
      hasSearch={true}
      roundedSearch={isIOS}
      onSearch={() => {
        if (showFolders) {
          Navigation.push("Search", {
            placeholder: strings.searchInRoute(strings.folders()),
            type: "notebook",
            title: strings.folders(),
            route: route.name
          });
          return;
        }
        Navigation.push("Search", {
          placeholder: strings.searchInRoute(route.name),
          type: "note",
          title: route.name,
          route: route.name,
          items: db.notes.all
        });
      }}
      id={route.name}
      trailingAction={
        showFolders ? (
          <FloatingButton
            inline
            circular
            accessibilityLabel={strings.addFolder()}
            testID="notes-add-folder"
            alwaysVisible
            onPress={async () => {
              const feature = await isFeatureAvailable("notebooks");
              if (feature.isAllowed) AddNotebookSheet.present();
              else PaywallSheet.present(feature);
            }}
          />
        ) : isIOS && !loading && isFocused ? (
          <FloatingButton
            inline
            circular
            accessibilityLabel={strings.createNewNote()}
            onPress={openEditor}
            alwaysVisible
          />
        ) : undefined
      }
    />
  );

  const recents = (
    <DelayLayout wait={loading}>
      <List
        data={notes}
        dataType="note"
        groupType="home"
        renderedInRoute={route.name}
        loading={loading || !isFocused}
        headerTitle={strings.routes[route.name]()}
        placeholder={{
          title: route.name?.toLowerCase(),
          paragraph: strings.notesEmpty(),
          button: isIOS ? undefined : strings.createNewNote(),
          hideTip: isIOS,
          action: openEditor,
          loading: strings.loadingNotes()
        }}
      />
      {!isIOS && notes?.placeholders?.length ? (
        <FloatingButton onPress={openEditor} alwaysVisible />
      ) : null}
    </DelayLayout>
  );

  return (
    <>
      <NotesListLayout header={searchBar}>
        {isIOS ? (
          <NotesHomeTabs
            value={tab}
            onChange={(next) => {
              if (next === tab) return;
              useSelectionStore.getState().clearSelection();
              setTab(next);
            }}
            recents={recents}
            folders={<SideMenuNotebooks presentation="notes" />}
            music={<MusicHome active={tab === "music" && isFocused} />}
          />
        ) : (
          recents
        )}
      </NotesListLayout>
      {!showFolders && (
        <SelectionHeader id={route.name} items={notes} type="note" />
      )}
    </>
  );
};

export default Home;
