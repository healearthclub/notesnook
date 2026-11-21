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
import React, {
  PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { Keyboard, Platform, ScrollView, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { BottomTabBar } from "../DesignSystem/UIComponents/BottomTabBar";
import {
  BrowserControls,
  BrowserScreen,
  readBrowserMediaCards,
  readBrowserSession
} from "../features/browser";
import {
  BrowserTab,
  BrowserTabCard,
  RecentBrowserTabsContext
} from "../features/browser/browser-home";
import { CameraScreen } from "../features/camera";
import { PhotoLibrarySheet } from "../features/camera/photo-library-sheet";
import { YouTubeMiniPlayer } from "../features/browser/youtube-mini-player";
import {
  GoogleScreen,
  googleScreenBackground
} from "../features/login/google-screen";
import { useOhaiAccount } from "../features/login/google-session";
import { MusicDock } from "../features/notes/music-dock";
import { useMusicPlayback } from "../features/notes/music-player";
import { NotesScreen } from "../features/notes";
import { NotesToolbarAccessory } from "../features/notes/list-layout";
import { usesNotesTabLayout } from "../features/notes/list-route";
import useGlobalSafeAreaInsets, {
  BottomInsetOverride
} from "../hooks/use-global-safe-area-insets";
import { eSubscribeEvent, eUnSubscribeEvent } from "../services/event-manager";
import type { NavigationProps } from "../services/navigation";
import useNavigationStore from "../stores/use-navigation-store";
import { useSettingStore } from "../stores/use-setting-store";
import { eOnEnterEditor, eOnExitEditor, eOnLoadNote } from "../utils/events";

const tabs = [
  {
    id: "notes",
    label: "Notes",
    icon: "heal-earth-home"
  },
  {
    id: "browser",
    label: "Browser",
    icon: "compass-outline",
    selectedIcon: "compass"
  },
  {
    id: "camera",
    label: "Camera",
    icon: "camera-outline",
    selectedIcon: "camera"
  },
  {
    id: "profile",
    label: "Profile",
    icon: "account-outline",
    selectedIcon: "account-outline"
  }
] as const;

type Tab = (typeof tabs)[number]["id"];

const CAMERA_ROLL_SWIPE_FRACTION = 0.2;

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
  const notesRoute = useNavigationStore((state) => state.currentRoute);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [tabScreenHeight, setTabScreenHeight] = useState(0);
  const capturingPhoto = useRef(false);
  const [activeTab, setActiveTab] = useState<Tab>("notes");
  const [browserOpened, setBrowserOpened] = useState(false);
  const [notesEditorVisible, setNotesEditorVisible] = useState(false);
  const browserControls = useRef<BrowserControls>(null);
  const [browserPreview, setBrowserPreview] = useState<BrowserTab | null>(null);
  const [browserSession, setBrowserSession] = useState(readBrowserSession);
  const [pendingBrowserAction, setPendingBrowserAction] = useState<{
    kind: "openTab" | "closeTab" | "dismissCard";
    id: number;
  }>();
  const [browserMedia, setBrowserMedia] = useState(readBrowserMediaCards);
  const hasMusicCard = useMusicPlayback((state) => !!state.current);
  const [profileOpened, setProfileOpened] = useState(false);
  const ohaiEmail = useOhaiAccount((state) => state.email);
  const notesActive = activeTab === "notes";
  const browserActive = activeTab === "browser";
  const profileActive = activeTab === "profile";
  const cameraActive = activeTab === "camera";
  const showTabBar = !notesActive || !fullscreen;

  const openLibrary = useCallback(() => {
    if (capturingPhoto.current) return;
    Keyboard.dismiss();
    setLibraryOpen(true);
  }, []);
  const closeLibrary = useCallback(() => setLibraryOpen(false), []);
  const swipeForLibrary = useMemo(
    () =>
      Gesture.Pan()
        .enabled(showTabBar && !libraryOpen && tabScreenHeight > 0)
        .hitSlop({ top: -tabScreenHeight * (1 - CAMERA_ROLL_SWIPE_FRACTION) })
        .activeOffsetY(-4)
        .failOffsetY(10)
        .failOffsetX([-15, 15])
        .runOnJS(true)
        .onEnd(({ translationY, velocityY }) => {
          if (translationY + Math.min(0, velocityY) * 0.1 < -42) openLibrary();
        }),
    [libraryOpen, openLibrary, showTabBar, tabScreenHeight]
  );

  useEffect(() => {
    const openNotes = (event?: { refresh?: boolean }) => {
      if (!event?.refresh) setActiveTab("notes");
    };
    const showEditor = () => setNotesEditorVisible(true);
    const hideEditor = () => setNotesEditorVisible(false);
    eSubscribeEvent(eOnLoadNote, openNotes);
    eSubscribeEvent(eOnEnterEditor, showEditor);
    eSubscribeEvent(eOnExitEditor, hideEditor);
    return () => {
      eUnSubscribeEvent(eOnLoadNote, openNotes);
      eUnSubscribeEvent(eOnEnterEditor, showEditor);
      eUnSubscribeEvent(eOnExitEditor, hideEditor);
    };
  }, []);

  useEffect(() => {
    if (!pendingBrowserAction || !browserControls.current) return;
    browserControls.current[pendingBrowserAction.kind](pendingBrowserAction.id);
    setPendingBrowserAction(undefined);
  }, [browserOpened, pendingBrowserAction]);

  function selectTab(tab: Tab) {
    if (tab === activeTab) return;
    Keyboard.dismiss();
    if (tab === "browser") setBrowserOpened(true);
    if (tab === "profile") setProfileOpened(true);
    setActiveTab(tab);
  }

  function openBrowserTab(id: number) {
    if (browserControls.current) browserControls.current.openTab(id);
    else setPendingBrowserAction({ kind: "openTab", id });
    selectTab("browser");
  }

  function runBrowserAction(kind: "closeTab" | "dismissCard", id: number) {
    if (browserControls.current) browserControls.current[kind](id);
    else {
      setPendingBrowserAction({ kind, id });
      setBrowserOpened(true);
    }
  }

  const dismissedCards = new Set(
    browserSession.tabs.filter((tab) => tab.cardDismissed).map((tab) => tab.id)
  );
  const visibleMedia = browserMedia.filter(
    ({ tabId }) => !dismissedCards.has(tabId)
  );

  const stackAboveSearch =
    notesActive &&
    showTabBar &&
    !notesEditorVisible &&
    (visibleMedia.length > 0 || usesNotesTabLayout(notesRoute));
  const showBrowserCards =
    showTabBar && (stackAboveSearch || (!browserActive && !cameraActive));
  const preview =
    showBrowserCards &&
    browserPreview &&
    !dismissedCards.has(browserPreview.id) &&
    !browserMedia.some(({ tabId }) => tabId === browserPreview.id)
      ? browserPreview
      : null;
  const media = showBrowserCards ? visibleMedia : [];
  const showMusic = showTabBar && hasMusicCard;
  const compact = media.length + Number(!!preview) + Number(showMusic) > 1;

  const dockCards: React.ReactElement[] = media.map(({ tabId, playback }) => (
    <YouTubeMiniPlayer
      key={tabId}
      compact={compact}
      playback={playback}
      onDismiss={() => runBrowserAction("dismissCard", tabId)}
      onOpen={() => openBrowserTab(tabId)}
      onToggle={() => {
        if (!browserControls.current?.toggleYouTube(tabId, !playback.playing)) {
          openBrowserTab(tabId);
        }
      }}
    />
  ));
  if (preview) {
    dockCards.push(
      <BrowserTabCard
        key={preview.id}
        compact={compact}
        tab={preview}
        onDismiss={() => runBrowserAction("dismissCard", preview.id)}
        onPress={() => {
          browserControls.current?.openCurrent();
          selectTab("browser");
        }}
      />
    );
  }
  if (showMusic) dockCards.push(<MusicDock key="music" compact={compact} />);

  const dock = dockCards.length ? (
    <ScrollView
      testID="browser-media-stack"
      style={styles.mediaStack}
      contentContainerStyle={compact && styles.dockGrid}
      scrollEnabled={dockCards.length > 2}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {dockCards.map((card) => (
        <View key={card.key} style={compact && styles.dockCell}>
          {card}
        </View>
      ))}
    </ScrollView>
  ) : null;

  return (
    <GestureDetector gesture={swipeForLibrary}>
      <View
        collapsable={false}
        onLayout={({ nativeEvent }) =>
          setTabScreenHeight(nativeEvent.layout.height)
        }
        style={[styles.fill, { backgroundColor: colors.primary.background }]}
      >
        <View style={styles.fill}>
          <View
            style={styles.fill}
            pointerEvents={notesActive ? "auto" : "none"}
            accessibilityElementsHidden={!notesActive}
          >
            <BottomInsetOverride.Provider value={showTabBar ? 0 : undefined}>
              <NotesToolbarAccessory.Provider value={stackAboveSearch ? dock : null}>
                <RecentBrowserTabsContext.Provider
                  value={{
                    ...browserSession,
                    onOpen: openBrowserTab,
                    onClose: (id) => runBrowserAction("closeTab", id)
                  }}
                >
                  {children}
                </RecentBrowserTabsContext.Provider>
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
                active={browserActive}
                onPreviewChange={setBrowserPreview}
                onMediaChange={setBrowserMedia}
                onSessionChange={setBrowserSession}
              />
            </View>
          ) : null}
          {cameraActive && (
            <View style={StyleSheet.absoluteFill}>
              <CameraScreen
                libraryOpen={libraryOpen}
                onOpenLibrary={openLibrary}
                capturingRef={capturingPhoto}
              />
            </View>
          )}
          {profileOpened ? (
            <View
              testID="profile-screen"
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: ohaiEmail
                    ? colors.primary.background
                    : googleScreenBackground,
                  paddingTop: insets.top,
                  paddingLeft: insets.left,
                  paddingRight: insets.right
                },
                !profileActive && styles.hidden
              ]}
              pointerEvents={profileActive ? "auto" : "none"}
              accessibilityElementsHidden={!profileActive}
            >
              <GoogleScreen active={profileActive} profile />
            </View>
          ) : null}
        </View>
        {!stackAboveSearch && dock}
        {showTabBar ? (
          <BottomTabBar
            tabs={tabs}
            selectedTab={activeTab}
            onSelectTab={selectTab}
            bottomInset={insets.bottom}
          />
        ) : null}
        <PhotoLibrarySheet visible={libraryOpen} onClose={closeLibrary} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  mediaStack: { flexGrow: 0, maxHeight: 174 },
  dockGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 8,
    paddingBottom: 6,
    rowGap: 6
  },
  dockCell: { width: "50%", paddingHorizontal: 4, overflow: "hidden" },
  hidden: { opacity: 0 }
});
