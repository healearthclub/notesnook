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
  Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from "react";
import {
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { MMKV } from "../../common/database/mmkv";
import AppIcon from "../../components/ui/AppIcon";
import useGlobalSafeAreaInsets from "../../hooks/use-global-safe-area-insets";
import { blockedBrowserHost } from "./browser-guard";
import { BrowserHome, BrowserTab, tabLabel } from "./browser-home";
import { BrowserPage, BrowserPageControls, isWebAddress } from "./browser-page";
import { getYouTubeVideoId, YouTubePlayback } from "./youtube-playback";
import {
  readYouTubeResume,
  resumeYouTubeAddress,
  saveYouTubeResume,
  YouTubeResume
} from "./youtube-resume";

const storageKey = "nn::browserTabs";
type TabSession = { tabs: BrowserTab[]; selectedId: number };

export type BrowserControls = {
  openCurrent: () => void;
  openYouTube: () => void;
  toggleYouTube: (shouldPlay: boolean) => boolean;
};

type BrowserScreenProps = {
  ref?: Ref<BrowserControls>;
  active: boolean;
  onPreviewChange: (preview: BrowserTab | null) => void;
  onYouTubePlaybackChange: (playback: YouTubePlayback | null) => void;
};

function restoreSession(playback?: YouTubeResume): TabSession {
  const saved = MMKV.getMap<TabSession>(storageKey);
  if (Array.isArray(saved?.tabs)) {
    const ids = new Set<number>();
    const tabs = saved.tabs.filter((tab) => {
      if (
        !tab ||
        !Number.isSafeInteger(tab.id) ||
        tab.id < 1 ||
        ids.has(tab.id) ||
        typeof tab.address !== "string" ||
        (tab.title !== undefined && typeof tab.title !== "string") ||
        (tab.address &&
          (!isWebAddress(tab.address) || blockedBrowserHost(tab.address)))
      )
        return false;
      ids.add(tab.id);
      return true;
    });
    if (tabs.length) {
      return {
        tabs,
        selectedId: ids.has(saved.selectedId) ? saved.selectedId : tabs[0].id
      };
    }
  }
  return {
    tabs: [{ id: 1, address: playback ? resumeYouTubeAddress(playback) : "" }],
    selectedId: 1
  };
}

export function BrowserScreen({
  ref,
  active,
  onPreviewChange,
  onYouTubePlaybackChange
}: BrowserScreenProps) {
  const { colors } = useThemeColors();
  const insets = useGlobalSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  const sheetOffset = useRef(new Animated.Value(height)).current;
  const [savedPlayback] = useState(readYouTubeResume);
  const [{ tabs, selectedId }, setSession] = useState(() =>
    restoreSession(savedPlayback)
  );
  const nextId = useRef(Math.max(...tabs.map((tab) => tab.id)) + 1);
  const [resumeTabId] = useState(() =>
    savedPlayback
      ? tabs.find(
          (tab) => getYouTubeVideoId(tab.address) === savedPlayback.videoId
        )?.id
      : undefined
  );
  const [opened, setOpened] = useState(
    () => new Set([selectedId, ...(resumeTabId ? [resumeTabId] : [])])
  );
  const players = useRef(new Map<number, BrowserPageControls>());
  const playbackOwner = useRef(resumeTabId);
  const strip = useRef<ScrollView>(null);
  const tabPositions = useRef(new Map<number, number>());
  const selectedIndex = tabs.findIndex((tab) => tab.id === selectedId);
  const selectedTab = tabs[selectedIndex];

  useEffect(() => {
    onPreviewChange(selectedTab?.address ? selectedTab : null);
  }, [onPreviewChange, selectedTab]);

  useEffect(() => {
    if (!active) setExpanded(false);
  }, [active]);

  useEffect(() => {
    const animation = Animated.timing(sheetOffset, {
      toValue: expanded ? 0 : height,
      duration: expanded ? 260 : 220,
      useNativeDriver: true
    });
    animation.start();
    return () => animation.stop();
  }, [expanded, height, sheetOffset]);

  useEffect(() => {
    MMKV.setMap(storageKey, { tabs, selectedId });
  }, [tabs, selectedId]);

  useEffect(() => {
    if (savedPlayback && resumeTabId === undefined) {
      saveYouTubeResume();
      onYouTubePlaybackChange(null);
    }
  }, [onYouTubePlaybackChange, resumeTabId, savedPlayback]);

  function revealTab(id: number) {
    const x = tabPositions.current.get(id);
    if (x !== undefined) strip.current?.scrollTo({ x: Math.max(0, x - 12) });
  }

  function selectTab(id: number) {
    Keyboard.dismiss();
    setOpened((current) =>
      current.has(id) ? current : new Set(current).add(id)
    );
    setSession((current) =>
      current.selectedId === id ? current : { ...current, selectedId: id }
    );
  }

  useEffect(() => {
    revealTab(selectedId);
  }, [selectedId]);

  function openTab(id: number) {
    selectTab(id);
    setExpanded(true);
  }

  function minimize() {
    Keyboard.dismiss();
    setExpanded(false);
  }

  function addTab(address = "") {
    if (address && (!isWebAddress(address) || blockedBrowserHost(address)))
      return;
    const id = nextId.current++;
    Keyboard.dismiss();
    setExpanded(true);
    setOpened((current) => new Set(current).add(id));
    setSession((current) => ({
      tabs: [...current.tabs, { id, address }],
      selectedId: id
    }));
  }

  function closeTab(id: number) {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    players.current.get(id)?.stop();
    const fallback = tabs[index + 1] ?? tabs[index - 1];
    if (playbackOwner.current === id) {
      playbackOwner.current = undefined;
      saveYouTubeResume();
      onYouTubePlaybackChange(null);
    }
    setOpened((current) => {
      const remaining = new Set(current);
      remaining.delete(id);
      return remaining;
    });
    tabPositions.current.delete(id);
    const replacement = fallback ?? { id: nextId.current++, address: "" };
    setSession({
      tabs: fallback ? tabs.filter((tab) => tab.id !== id) : [replacement],
      selectedId: id === selectedId ? replacement.id : selectedId
    });
  }

  function updateAddress(id: number, address: string, title?: string) {
    if (blockedBrowserHost(address)) return;
    setSession((current) => {
      const tab = current.tabs.find((tab) => tab.id === id);
      if (!tab) return current;
      const nextTitle =
        title?.trim() || (tab.address === address ? tab.title : undefined);
      if (tab.address === address && tab.title === nextTitle) return current;
      return {
        ...current,
        tabs: current.tabs.map((tab) =>
          tab.id === id ? { id, address, title: nextTitle } : tab
        )
      };
    });
  }

  function closeOpenPage(id: number) {
    if (id === selectedId) minimize();
    closeTab(id);
  }

  function updatePlayback(id: number, playback: YouTubeResume | null) {
    const owner = playbackOwner.current;
    if (owner !== id) {
      if (!playback || id !== selectedId || !active) return;
      if (owner !== undefined && !playback.playing) return;
      playbackOwner.current = id;
      if (owner !== undefined) players.current.get(owner)?.toggleYouTube(false);
    }
    if (!playback) playbackOwner.current = undefined;
    saveYouTubeResume(playback ?? undefined);
    onYouTubePlaybackChange(playback);
  }

  useImperativeHandle(ref, () => ({
    openCurrent() {
      openTab(selectedId);
    },
    openYouTube() {
      const id = playbackOwner.current;
      if (id !== undefined) openTab(id);
    },
    toggleYouTube(shouldPlay) {
      const id = playbackOwner.current;
      return (
        id !== undefined &&
        (players.current.get(id)?.toggleYouTube(shouldPlay) ?? false)
      );
    }
  }));

  const swipe = Gesture.Pan()
    .enabled(active && expanded && tabs.length > 1)
    .maxPointers(1)
    .hitSlop({ left: -24, right: -24 })
    .activeOffsetX([-36, 36])
    .failOffsetY([-24, 24])
    .runOnJS(true)
    .onEnd(({ translationX, translationY }) => {
      if (
        Math.abs(translationX) < 55 ||
        Math.abs(translationY) > Math.abs(translationX) / 2
      )
        return;
      const next = tabs[selectedIndex + (translationX < 0 ? 1 : -1)];
      if (next) selectTab(next.id);
    });

  const dismissSwipe = Gesture.Pan()
    .enabled(active && expanded)
    .maxPointers(1)
    .activeOffsetY(10)
    .failOffsetX([-24, 24])
    .runOnJS(true)
    .onUpdate(({ translationY }) => {
      sheetOffset.setValue(Math.max(0, translationY));
    })
    .onEnd(({ translationY, velocityY }) => {
      if (translationY > 70 || (translationY > 22 && velocityY > 550)) {
        minimize();
        return;
      }
      Animated.spring(sheetOffset, {
        toValue: 0,
        useNativeDriver: true
      }).start();
    });

  return (
    <View
      style={[
        styles.screen,
        styles.viewport,
        { backgroundColor: colors.primary.background }
      ]}
    >
      <View
        style={[
          styles.screen,
          {
            paddingTop: insets.top,
            paddingLeft: insets.left,
            paddingRight: insets.right
          }
        ]}
        pointerEvents={expanded ? "none" : "auto"}
        accessibilityElementsHidden={expanded}
      >
        <BrowserHome
          tabs={tabs}
          selectedId={selectedId}
          onOpen={openTab}
          onNew={() => {
            if (tabs.length === 1 && !selectedTab?.address) openTab(selectedId);
            else addTab();
          }}
          onClose={closeTab}
        />
      </View>
      <Animated.View
        testID="browser-sheet"
        style={[
          StyleSheet.absoluteFill,
          { transform: [{ translateY: sheetOffset }] }
        ]}
        pointerEvents={expanded ? "auto" : "none"}
        accessibilityElementsHidden={!expanded}
      >
        <KeyboardAvoidingView
          behavior="padding"
          enabled={active && expanded}
          style={[
            styles.screen,
            {
              backgroundColor: colors.primary.background,
              paddingTop: insets.top,
              paddingLeft: insets.left,
              paddingRight: insets.right
            }
          ]}
        >
          <View>
            <GestureDetector gesture={dismissSwipe}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Minimize browser page"
                testID="browser-minimize-tab"
                onPress={minimize}
                style={styles.sheetHeader}
              >
                <AppIcon
                  name="chevron-down"
                  color={colors.primary.heading}
                  size={25}
                />
                <View
                  pointerEvents="none"
                  style={[
                    styles.grabber,
                    { backgroundColor: colors.primary.border }
                  ]}
                />
              </Pressable>
            </GestureDetector>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close browser page"
              testID="browser-page-close-tab"
              onPress={() => closeOpenPage(selectedId)}
              style={[styles.control, styles.closePage]}
            >
              <AppIcon name="close" color={colors.primary.heading} size={22} />
            </Pressable>
          </View>
          <View
            style={[styles.strip, { borderBottomColor: colors.primary.border }]}
          >
            <ScrollView
              ref={strip}
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.stripContent}
            >
              {tabs.map((tab, index) => {
                const selected = tab.id === selectedId;
                const label = tabLabel(tab);
                return (
                  <Pressable
                    key={tab.id}
                    accessibilityRole="tab"
                    accessibilityLabel={`${label}, tab ${index + 1} of ${tabs.length}`}
                    accessibilityState={{ selected }}
                    testID={`browser-tab-${tab.id}`}
                    onLayout={({ nativeEvent }) => {
                      tabPositions.current.set(tab.id, nativeEvent.layout.x);
                      if (selected) revealTab(tab.id);
                    }}
                    onPress={() => selectTab(tab.id)}
                    style={[
                      styles.tab,
                      {
                        maxWidth: width * 0.55,
                        borderBottomColor: selected
                          ? colors.primary.heading
                          : "transparent"
                      }
                    ]}
                  >
                    <Text
                      numberOfLines={1}
                      style={{
                        color: selected
                          ? colors.primary.heading
                          : colors.primary.paragraph,
                        fontWeight: selected ? "600" : "400"
                      }}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New browser tab"
              testID="browser-page-add-tab"
              onPress={() => addTab()}
              style={styles.control}
            >
              <AppIcon name="plus" size={22} />
            </Pressable>
          </View>
          <GestureDetector gesture={swipe}>
            <View
              style={styles.screen}
              collapsable={false}
              testID="browser-page-swipe"
            >
              {tabs
                .filter((tab) => opened.has(tab.id))
                .map((tab) => {
                  const selected = tab.id === selectedId;
                  const resume =
                    tab.id === resumeTabId ? savedPlayback : undefined;
                  return (
                    <View
                      key={tab.id}
                      style={[
                        StyleSheet.absoluteFill,
                        !selected && styles.hidden
                      ]}
                      pointerEvents={selected ? "auto" : "none"}
                      accessibilityElementsHidden={!selected}
                    >
                      <BrowserPage
                        selected={selected && expanded && active}
                        onClose={() => closeOpenPage(tab.id)}
                        onBlocked={() => updateAddress(tab.id, "")}
                        ref={(page) => {
                          if (page) players.current.set(tab.id, page);
                          else players.current.delete(tab.id);
                        }}
                        initialAddress={
                          resume ? resumeYouTubeAddress(resume) : tab.address
                        }
                        initialPlayback={resume}
                        onNavigate={(address, title) =>
                          updateAddress(tab.id, address, title)
                        }
                        onOpenWindow={(address) => {
                          if (active && expanded && selected && address)
                            addTab(address);
                        }}
                        onYouTubePlaybackChange={(playback) =>
                          updatePlayback(tab.id, playback)
                        }
                      />
                    </View>
                  );
                })}
            </View>
          </GestureDetector>
        </KeyboardAvoidingView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  viewport: { overflow: "hidden" },
  sheetHeader: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 10
  },
  closePage: { position: "absolute", top: 0, right: 0 },
  grabber: {
    position: "absolute",
    top: 9,
    alignSelf: "center",
    height: 4,
    width: 36,
    borderRadius: 2
  },
  hidden: { opacity: 0 },
  strip: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  stripContent: { paddingHorizontal: 12, gap: 14 },
  tab: {
    minHeight: 44,
    justifyContent: "center",
    borderBottomWidth: 2,
    paddingHorizontal: 4
  },
  control: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center"
  }
});
