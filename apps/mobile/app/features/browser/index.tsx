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
  LayoutRectangle,
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
import { BrowserHome, BrowserTab } from "./browser-home";
import {
  addressFromInput,
  BrowserPage,
  BrowserPageControls,
  isWebAddress
} from "./browser-page";
import { faviconForAddress } from "./browser-metadata";
import { getYouTubeVideoId } from "./youtube-playback";
import {
  clearYouTubeResume,
  parseYouTubeResume,
  readYouTubeResume,
  resumeYouTubeAddress,
  YouTubeResume
} from "./youtube-resume";

const storageKey = "nn::browserTabs";
type SessionTab = BrowserTab & {
  youtube?: YouTubeResume;
  cardDismissed?: boolean;
};
type TabSession = { tabs: SessionTab[]; selectedId: number };

export type BrowserMediaCard = { tabId: number; playback: YouTubeResume };

function browserMediaCards(tabs: SessionTab[]): BrowserMediaCard[] {
  return tabs.flatMap(({ id, address, youtube }) =>
    youtube && getYouTubeVideoId(address) === youtube.videoId
      ? [{ tabId: id, playback: youtube }]
      : []
  );
}

export function readBrowserMediaCards() {
  return browserMediaCards(restoreSession(readYouTubeResume()).tabs);
}

export function readBrowserSession() {
  return restoreSession(readYouTubeResume());
}

export type BrowserControls = {
  openCurrent: () => void;
  openTab: (tabId: number) => void;
  closeTab: (tabId: number) => void;
  dismissCard: (tabId: number) => void;
  toggleYouTube: (tabId: number, shouldPlay: boolean) => boolean;
};

type BrowserScreenProps = {
  ref?: Ref<BrowserControls>;
  active: boolean;
  onPreviewChange: (preview: BrowserTab | null) => void;
  onMediaChange: (media: BrowserMediaCard[]) => void;
  onSessionChange: (session: TabSession) => void;
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
      const legacyTab =
        playback &&
        tabs.find(
          ({ address }) => getYouTubeVideoId(address) === playback.videoId
        );
      return {
        tabs: tabs.map((tab) => {
          const youtube = parseYouTubeResume(tab.youtube);
          return {
            ...tab,
            youtube:
              youtube?.videoId === getYouTubeVideoId(tab.address)
                ? youtube
                : legacyTab && legacyTab.id === tab.id
                  ? playback
                  : undefined
          };
        }),
        selectedId: ids.has(saved.selectedId) ? saved.selectedId : tabs[0].id
      };
    }
  }
  return {
    tabs: [
      {
        id: 1,
        address: playback ? resumeYouTubeAddress(playback) : "",
        youtube: playback
      }
    ],
    selectedId: 1
  };
}

const tabSites = new Map([
  ["healearth.club", { label: "Heal Earth Club", icon: "compass-outline" }],
  ["youtube.com", { label: "YouTube", icon: "play" }],
  ["youtu.be", { label: "YouTube", icon: "play" }],
  ["github.com", { label: "GitHub", icon: "github" }],
  ["x.com", { label: "X", icon: "compass-outline" }]
]);

function tabSite(address: string) {
  if (!address) return { label: "New tab", icon: "compass-outline" };
  try {
    const host = new URL(address).hostname.replace(/^(www|m)\./, "");
    return tabSites.get(host) ?? { label: host, icon: "compass-outline" };
  } catch {
    return { label: "Website", icon: "compass-outline" };
  }
}

export function BrowserScreen({
  ref,
  active,
  onPreviewChange,
  onMediaChange,
  onSessionChange
}: BrowserScreenProps) {
  const { colors } = useThemeColors();
  const insets = useGlobalSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  const [videoTabs, setVideoTabs] = useState<Set<number>>(() => new Set());
  const [videoLayout, setVideoLayout] = useState<LayoutRectangle>();
  const sheetOffset = useRef(new Animated.Value(height)).current;
  const [savedPlayback] = useState(readYouTubeResume);
  const [{ tabs, selectedId }, setSession] = useState(() =>
    restoreSession(savedPlayback)
  );
  const nextId = useRef(Math.max(...tabs.map((tab) => tab.id)) + 1);
  const [initialResumes] = useState(
    () =>
      new Map(
        tabs.flatMap(({ id, youtube }) =>
          youtube ? [[id, youtube] as const] : []
        )
      )
  );
  const [opened, setOpened] = useState(
    () => new Set(active ? [selectedId] : [])
  );
  const blockedTabAddresses = useRef(new Map<number, string>());
  const players = useRef(new Map<number, BrowserPageControls>());
  const strip = useRef<ScrollView>(null);
  const tabPositions = useRef(new Map<number, number>());
  const selectedIndex = tabs.findIndex((tab) => tab.id === selectedId);
  const selectedTab = tabs[selectedIndex];
  const showVideoCard =
    active &&
    !expanded &&
    !!selectedTab?.address &&
    !selectedTab.cardDismissed &&
    videoTabs.has(selectedId);
  const videoPreview = showVideoCard ? videoLayout : undefined;

  function updateVideoAvailability(id: number, available: boolean) {
    setVideoTabs((current) => {
      if (current.has(id) === available) return current;
      const next = new Set(current);
      if (available) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  useEffect(() => {
    onPreviewChange(selectedTab?.address ? selectedTab : null);
  }, [onPreviewChange, selectedTab]);

  useEffect(() => {
    if (active) {
      setOpened((current) =>
        current.has(selectedId) ? current : new Set(current).add(selectedId)
      );
    } else {
      setExpanded(false);
    }
  }, [active, selectedId]);

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
    onSessionChange({ tabs, selectedId });
  }, [onSessionChange, tabs, selectedId]);

  useEffect(() => {
    if (savedPlayback) clearYouTubeResume();
  }, [savedPlayback]);

  useEffect(
    () => onMediaChange(browserMediaCards(tabs)),
    [onMediaChange, tabs]
  );

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

  function setCardDismissed(id: number, dismissed: boolean) {
    setSession((current) => {
      const tab = current.tabs.find((item) => item.id === id);
      if (!tab || Boolean(tab.cardDismissed) === dismissed) return current;
      return {
        ...current,
        tabs: current.tabs.map((item) =>
          item.id === id ? { ...item, cardDismissed: dismissed } : item
        )
      };
    });
  }

  function openTab(id: number) {
    setCardDismissed(id, false);
    selectTab(id);
    setExpanded(true);
  }

  function minimize() {
    Keyboard.dismiss();
    setExpanded(false);
  }

  function addTab(address = "", fromHome = false) {
    if (address && !isWebAddress(address)) return;
    const blocked = !!blockedBrowserHost(address);
    if (blocked && !fromHome) return;
    const emptyTab =
      tabs.length === 1 && !selectedTab?.address ? selectedTab : undefined;
    const page = emptyTab && players.current.get(emptyTab.id);
    if (fromHome && emptyTab && page) {
      openTab(emptyTab.id);
      page.navigate(address);
      return;
    }

    const id = fromHome && emptyTab ? emptyTab.id : nextId.current++;
    if (blocked) blockedTabAddresses.current.set(id, address);
    Keyboard.dismiss();
    setExpanded(true);
    setOpened((current) => new Set(current).add(id));
    setSession((current) => ({
      tabs: [
        ...current.tabs.filter((tab) => tab.id !== id),
        { id, address: blocked ? "" : address }
      ],
      selectedId: id
    }));
  }

  function submitHomeAddress(input: string) {
    const address = addressFromInput(input);
    if (address) addTab(address, true);
  }

  function closeTab(id: number) {
    if (!tabs.some((tab) => tab.id === id)) return;
    players.current.get(id)?.stop();
    updateVideoAvailability(id, false);
    setOpened((current) => {
      const remaining = new Set(current);
      remaining.delete(id);
      return remaining;
    });
    tabPositions.current.delete(id);
    blockedTabAddresses.current.delete(id);
    initialResumes.delete(id);
    const emptyTab = { id: nextId.current++, address: "" };
    setSession((current) => {
      const index = current.tabs.findIndex((tab) => tab.id === id);
      if (index === -1) return current;
      const adjacent = current.tabs[index + 1] ?? current.tabs[index - 1];
      return {
        tabs: adjacent
          ? current.tabs.filter((tab) => tab.id !== id)
          : [emptyTab],
        selectedId:
          current.selectedId === id
            ? (adjacent ?? emptyTab).id
            : current.selectedId
      };
    });
  }

  function updateAddress(
    id: number,
    address: string,
    title?: string,
    favicon?: string
  ) {
    if (blockedBrowserHost(address)) return;
    setSession((current) => {
      const tab = current.tabs.find((tab) => tab.id === id);
      if (!tab) return current;
      const nextTitle =
        title?.trim() || (tab.address === address ? tab.title : undefined);
      const nextFavicon =
        (favicon && faviconForAddress(address, favicon)) ||
        (tab.address === address ? tab.favicon : undefined);
      if (
        tab.address === address &&
        tab.title === nextTitle &&
        tab.favicon === nextFavicon
      )
        return current;
      return {
        ...current,
        tabs: current.tabs.map((tab) =>
          tab.id === id
            ? {
                ...tab,
                address,
                title: nextTitle,
                favicon: nextFavicon,
                youtube:
                  tab.youtube?.videoId === getYouTubeVideoId(address)
                    ? tab.youtube
                    : undefined
              }
            : tab
        )
      };
    });
  }

  function closeOpenPage(id: number) {
    if (id === selectedId) minimize();
    closeTab(id);
  }

  function updatePlayback(id: number, playback: YouTubeResume | null) {
    setSession((current) => {
      const tab = current.tabs.find((item) => item.id === id);
      if (!tab || (!tab.youtube && !playback)) return current;
      if (
        !tab.youtube &&
        (id !== current.selectedId || !active || !playback?.playing)
      ) {
        return current;
      }
      if (playback && getYouTubeVideoId(tab.address) !== playback.videoId)
        return current;
      const previous = tab.youtube;
      if (
        previous?.videoId === playback?.videoId &&
        previous?.title === playback?.title &&
        previous?.playing === playback?.playing &&
        previous?.position === playback?.position &&
        previous?.progress === playback?.progress
      )
        return current;
      return {
        ...current,
        tabs: current.tabs.map((item) =>
          item.id === id ? { ...item, youtube: playback ?? undefined } : item
        )
      };
    });
  }

  useImperativeHandle(ref, () => ({
    openCurrent() {
      openTab(selectedId);
    },
    openTab(tabId) {
      if (tabs.some(({ id }) => id === tabId)) openTab(tabId);
    },
    closeTab,
    dismissCard(tabId) {
      setCardDismissed(tabId, true);
    },
    toggleYouTube(tabId, shouldPlay) {
      return players.current.get(tabId)?.toggleYouTube(shouldPlay) ?? false;
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
          keyboardAvoidanceEnabled={active && !expanded}
          onVideoLayout={showVideoCard ? setVideoLayout : undefined}
          onSubmitAddress={submitHomeAddress}
          tabs={tabs}
          selectedId={selectedId}
          cardDismissed={!!selectedTab?.cardDismissed}
          onDismissCard={() => setCardDismissed(selectedId, true)}
          onOpen={openTab}
          onNew={() => {
            if (tabs.length === 1 && !selectedTab?.address) openTab(selectedId);
            else addTab();
          }}
        />
      </View>
      <Animated.View
        testID={videoPreview ? "browser-minimized-video" : "browser-sheet"}
        style={
          videoPreview
            ? [
                styles.videoPreview,
                {
                  left: insets.left + videoPreview.x,
                  top: insets.top + videoPreview.y,
                  width: videoPreview.width,
                  height: videoPreview.height
                }
              ]
            : [
                StyleSheet.absoluteFill,
                { transform: [{ translateY: sheetOffset }] }
              ]
        }
        pointerEvents={expanded || videoPreview ? "auto" : "none"}
        accessibilityElementsHidden={!expanded && !videoPreview}
      >
        <KeyboardAvoidingView
          behavior="padding"
          enabled={active && expanded}
          style={[
            styles.screen,
            {
              backgroundColor: colors.primary.background,
              paddingTop: videoPreview ? 0 : insets.top,
              paddingLeft: videoPreview ? 0 : insets.left,
              paddingRight: videoPreview ? 0 : insets.right
            }
          ]}
        >
          <GestureDetector gesture={dismissSwipe}>
            <View
              collapsable={false}
              style={[
                styles.strip,
                { borderBottomColor: colors.primary.border },
                videoPreview && styles.hideChrome
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Minimize browser page"
                testID="browser-minimize-tab"
                onPress={minimize}
                style={styles.control}
              >
                <AppIcon
                  name="chevron-down"
                  color={colors.primary.heading}
                  size={25}
                />
              </Pressable>
              <ScrollView
                ref={strip}
                horizontal
                keyboardShouldPersistTaps="handled"
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.stripContent}
              >
                {tabs.map((tab, index) => {
                  const selected = tab.id === selectedId;
                  const { label, icon } = tabSite(tab.address);
                  const color = selected
                    ? colors.primary.heading
                    : colors.primary.paragraph;
                  return (
                    <Pressable
                      key={tab.id}
                      accessibilityRole="tab"
                      accessibilityLabel={`${label}, tab ${index + 1} of ${
                        tabs.length
                      }`}
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
                      <AppIcon name={icon} color={color} size={17} />
                      <Text
                        numberOfLines={1}
                        style={{
                          flexShrink: 1,
                          color,
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
          </GestureDetector>
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
                  const resume = initialResumes.get(tab.id);
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
                        pageTitle={tab.title}
                        pageAddress={tab.address}
                        selected={selected && expanded && active}
                        videoPreview={selected && !!videoPreview}
                        onVideoAvailabilityChange={(available) =>
                          updateVideoAvailability(tab.id, available)
                        }
                        onClose={() => closeOpenPage(tab.id)}
                        onBlocked={() => updateAddress(tab.id, "")}
                        ref={(page) => {
                          if (page) players.current.set(tab.id, page);
                          else players.current.delete(tab.id);
                        }}
                        initialAddress={
                          resume
                            ? resumeYouTubeAddress(resume)
                            : (blockedTabAddresses.current.get(tab.id) ??
                              tab.address)
                        }
                        initialPlayback={resume}
                        onNavigate={(address, title, favicon) =>
                          updateAddress(tab.id, address, title, favicon)
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
  hidden: { opacity: 0 },
  hideChrome: { display: "none" },
  videoPreview: {
    position: "absolute",
    backgroundColor: "black",
    overflow: "hidden",
    borderTopLeftRadius: 13,
    borderTopRightRadius: 13
  },
  strip: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  stripContent: { paddingHorizontal: 4, gap: 14 },
  tab: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
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
