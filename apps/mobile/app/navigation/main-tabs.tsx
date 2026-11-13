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
import React, { PropsWithChildren, useEffect, useRef, useState } from "react";
import { Keyboard, Platform, StyleSheet, View } from "react-native";
import { BottomTabBar } from "../DesignSystem/UIComponents/BottomTabBar";
import { BrowserControls, BrowserScreen } from "../features/browser";
import { YouTubeMiniPlayer } from "../features/browser/youtube-mini-player";
import { readYouTubeResume } from "../features/browser/youtube-resume";
import type { YouTubePlayback } from "../features/browser/youtube-playback";
import {
  GoogleScreen,
  googleScreenBackground
} from "../features/login/google-screen";
import { NotesScreen } from "../features/notes";
import { NotesToolbarAccessory } from "../features/notes/list-layout";
import useGlobalSafeAreaInsets, {
  BottomInsetOverride
} from "../hooks/use-global-safe-area-insets";
import { eSubscribeEvent, eUnSubscribeEvent } from "../services/event-manager";
import type { NavigationProps } from "../services/navigation";
import { useSettingStore } from "../stores/use-setting-store";
import { eOnLoadNote } from "../utils/events";

const tabs = [
  {
    id: "notes",
    label: "Notes",
    icon: "note-text-outline",
    selectedIcon: "note-text"
  },
  {
    id: "browser",
    label: "Browser",
    icon: "compass-outline",
    selectedIcon: "compass"
  },
  {
    id: "profile",
    label: "Profile",
    icon: "account-outline",
    selectedIcon: "account-outline"
  }
] as const;

type Tab = (typeof tabs)[number]["id"];

export default function MainScreen(props: NavigationProps<"FluidPanelsView">) {
  return Platform.OS === "ios" ? (
    <MainTabs>
      <NotesScreen {...props} />
    </MainTabs>
  ) : (
    <NotesScreen {...props} />
  );
}

function MainTabs({ children }: PropsWithChildren) {
  const { colors } = useThemeColors();
  const insets = useGlobalSafeAreaInsets();
  const fullscreen = useSettingStore((state) => state.fullscreen);
  const [activeTab, setActiveTab] = useState<Tab>("notes");
  const [browserOpened, setBrowserOpened] = useState(false);
  const browserControls = useRef<BrowserControls>(null);
  const [youtubePlayback, setYouTubePlayback] =
    useState<YouTubePlayback | null>(() => readYouTubeResume() ?? null);
  const [profileOpened, setProfileOpened] = useState(false);
  const notesActive = activeTab === "notes";
  const browserActive = activeTab === "browser";
  const profileActive = activeTab === "profile";
  const showTabBar = !notesActive || !fullscreen;

  useEffect(() => {
    const openNotes = (event?: { refresh?: boolean }) => {
      if (!event?.refresh) setActiveTab("notes");
    };
    eSubscribeEvent(eOnLoadNote, openNotes);
    return () => eUnSubscribeEvent(eOnLoadNote, openNotes);
  }, []);

  function selectTab(tab: Tab) {
    if (tab === activeTab) return;
    Keyboard.dismiss();
    if (tab === "browser") setBrowserOpened(true);
    if (tab === "profile") setProfileOpened(true);
    setActiveTab(tab);
  }

  const toolbarAccessory =
    notesActive && showTabBar && youtubePlayback ? (
      <YouTubeMiniPlayer
        playback={youtubePlayback}
        onOpen={() => selectTab("browser")}
        onToggle={() => {
          if (
            !browserControls.current?.toggleYouTube(!youtubePlayback.playing)
          ) {
            selectTab("browser");
          }
        }}
      />
    ) : null;

  return (
    <View style={[styles.fill, { backgroundColor: colors.primary.background }]}>
      <View style={styles.fill}>
        <View
          style={styles.fill}
          pointerEvents={notesActive ? "auto" : "none"}
          accessibilityElementsHidden={!notesActive}
        >
          <BottomInsetOverride.Provider value={showTabBar ? 0 : undefined}>
            <NotesToolbarAccessory.Provider value={toolbarAccessory}>
              {children}
            </NotesToolbarAccessory.Provider>
          </BottomInsetOverride.Provider>
        </View>
        {browserOpened ? (
          <View
            style={[StyleSheet.absoluteFill, !browserActive && styles.hidden]}
            pointerEvents={browserActive ? "auto" : "none"}
            accessibilityElementsHidden={!browserActive}
          >
            <BrowserScreen
              ref={browserControls}
              onYouTubePlaybackChange={setYouTubePlayback}
            />
          </View>
        ) : null}
        {profileOpened ? (
          <View
            testID="profile-screen"
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: googleScreenBackground,
                paddingTop: insets.top,
                paddingLeft: insets.left,
                paddingRight: insets.right
              },
              !profileActive && styles.hidden
            ]}
            pointerEvents={profileActive ? "auto" : "none"}
            accessibilityElementsHidden={!profileActive}
          >
            <GoogleScreen active={profileActive} />
          </View>
        ) : null}
      </View>
      {showTabBar ? (
        <BottomTabBar
          tabs={tabs}
          selectedTab={activeTab}
          onSelectTab={selectTab}
          bottomInset={insets.bottom}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hidden: { opacity: 0 }
});
