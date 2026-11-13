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
import React, { Ref, useImperativeHandle, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import WebView, { WebViewMessageEvent } from "react-native-webview";
import AppIcon from "../../components/ui/AppIcon";
import useGlobalSafeAreaInsets from "../../hooks/use-global-safe-area-insets";

import { inlineVideoScript } from "./video-playback";
import {
  getYouTubeVideoId,
  observeYouTubePlayback,
  readYouTubePlayback,
  toggleYouTubePlayback,
  YouTubePlayback,
  YouTubeSession
} from "./youtube-playback";
import {
  readYouTubeResume,
  resumeYouTubeAddress,
  saveYouTubeResume
} from "./youtube-resume";

function isWebAddress(url: string) {
  return /^https?:\/\//i.test(url);
}

function addressFromInput(input: string) {
  const value = input.trim();
  if (!value) return;
  if (isWebAddress(value)) return value;
  if (!/\s/.test(value) && /^[^/:]+\.[^/:]+/.test(value)) {
    return `https://${value}`;
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
}

export type BrowserControls = {
  toggleYouTube: (shouldPlay: boolean) => boolean;
};

type BrowserScreenProps = {
  ref?: Ref<BrowserControls>;
  onYouTubePlaybackChange: (playback: YouTubePlayback | null) => void;
};

export function BrowserScreen({
  ref,
  onYouTubePlaybackChange
}: BrowserScreenProps) {
  const { colors } = useThemeColors();
  const insets = useGlobalSafeAreaInsets();
  const webView = useRef<WebView>(null);
  const editingAddress = useRef(false);
  const currentAddress = useRef("");
  const youtubeSession = useRef<YouTubeSession>(undefined);
  const nextYouTubeSession = useRef(0);
  const [savedOnMount] = useState(readYouTubeResume);
  const checkpoint = useRef(savedOnMount);
  const livePlayback = useRef<YouTubePlayback>(undefined);
  const initialAddress = savedOnMount ? resumeYouTubeAddress(savedOnMount) : "";
  const [address, setAddress] = useState(initialAddress);
  const [source, setSource] = useState<{ uri: string } | undefined>(
    initialAddress ? { uri: initialAddress } : undefined
  );
  const [webViewKey, setWebViewKey] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      toggleYouTube(shouldPlay) {
        const session = youtubeSession.current;
        if (!session || !livePlayback.current || !webView.current) return false;
        webView.current.injectJavaScript(
          toggleYouTubePlayback(session, shouldPlay)
        );
        return true;
      }
    }),
    []
  );

  function resetYouTubeSession() {
    youtubeSession.current = undefined;
    livePlayback.current = undefined;
    onYouTubePlaybackChange(
      checkpoint.current ? { ...checkpoint.current, playing: false } : null
    );
  }

  function observeYouTubePage(url: string) {
    const videoId = getYouTubeVideoId(url);
    if (checkpoint.current && videoId !== checkpoint.current.videoId) {
      checkpoint.current = undefined;
      saveYouTubeResume();
    }
    if (videoId && videoId === youtubeSession.current?.videoId) return;

    resetYouTubeSession();
    if (!videoId) return;
    const session = { id: ++nextYouTubeSession.current, videoId };
    youtubeSession.current = session;
    webView.current?.injectJavaScript(
      observeYouTubePlayback(session, checkpoint.current?.position)
    );
  }

  function receivePlaybackMessage({ nativeEvent }: WebViewMessageEvent) {
    const session = youtubeSession.current;
    if (!session) return;
    const playback = readYouTubePlayback(
      nativeEvent.data,
      nativeEvent.url,
      session
    );
    if (playback === undefined) return;
    if (playback === "ended") {
      checkpoint.current = undefined;
      saveYouTubeResume();
      livePlayback.current = undefined;
      onYouTubePlaybackChange(null);
      return;
    }
    if (!playback) {
      livePlayback.current = undefined;
      onYouTubePlaybackChange(
        checkpoint.current ? { ...checkpoint.current, playing: false } : null
      );
      return;
    }

    const previous = checkpoint.current;
    const previousLive = livePlayback.current;
    const next = { ...playback, videoId: session.videoId };
    livePlayback.current = playback;
    checkpoint.current = next;
    if (
      previous?.videoId !== next.videoId ||
      previous.position !== next.position ||
      previous.playing !== next.playing
    ) {
      saveYouTubeResume(next);
    }
    if (
      previousLive?.playing !== next.playing ||
      previousLive.title !== next.title ||
      previousLive.progress !== next.progress
    ) {
      onYouTubePlaybackChange(playback);
    }
  }

  function restoreAfterProcessExit() {
    resetYouTubeSession();
    if (checkpoint.current) {
      setSource({ uri: resumeYouTubeAddress(checkpoint.current) });
      setWebViewKey((key) => key + 1);
    }
  }

  function openAddress(uri: string) {
    if (!isWebAddress(uri)) return;
    resetYouTubeSession();
    setFailed(false);
    setAddress(uri);
    if (currentAddress.current === uri) {
      webView.current?.reload();
    } else if (source?.uri === uri) {
      webView.current?.injectJavaScript(
        `window.location.assign(${JSON.stringify(uri)}); true;`
      );
    } else {
      setSource({ uri });
    }
  }

  function submitAddress() {
    const uri = addressFromInput(address);
    if (!uri) return;
    editingAddress.current = false;
    Keyboard.dismiss();
    openAddress(uri);
  }

  return (
    <KeyboardAvoidingView
      behavior="padding"
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
      {source ? (
        <View style={styles.screen}>
          <WebView
            key={webViewKey}
            ref={webView}
            testID="browser-webview"
            source={source}
            allowsInlineMediaPlayback
            injectedJavaScriptBeforeContentLoaded={inlineVideoScript}
            injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
            allowsBackForwardNavigationGestures
            originWhitelist={["*"]}
            onShouldStartLoadWithRequest={({ url }) => isWebAddress(url)}
            onOpenWindow={({ nativeEvent }) =>
              openAddress(nativeEvent.targetUrl)
            }
            onLoadStart={() => {
              resetYouTubeSession();
              setFailed(false);
              setLoading(true);
            }}
            onLoad={({ nativeEvent }) => observeYouTubePage(nativeEvent.url)}
            onLoadEnd={() => setLoading(false)}
            onMessage={receivePlaybackMessage}
            onError={() => {
              resetYouTubeSession();
              setFailed(true);
            }}
            onContentProcessDidTerminate={restoreAfterProcessExit}
            onNavigationStateChange={({ url, canGoBack }) => {
              setCanGoBack(canGoBack);
              if (!isWebAddress(url)) return;
              currentAddress.current = url;
              if (!editingAddress.current) setAddress(url);
            }}
          />
          {failed ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                styles.empty,
                { backgroundColor: colors.primary.background }
              ]}
            >
              <Text style={{ color: colors.primary.heading }}>
                Couldn’t load this page. Check the address or try reloading.
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.empty}>
          <AppIcon
            name="compass-outline"
            color={colors.primary.accent}
            size={42}
          />
          <Text style={{ color: colors.primary.paragraph }}>
            Search the web or enter a website.
          </Text>
        </View>
      )}
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityState={{ disabled: !canGoBack }}
          disabled={!canGoBack}
          onPress={() => webView.current?.goBack()}
          style={[styles.control, !canGoBack && styles.disabled]}
        >
          <AppIcon name="chevron-left" size={23} />
        </Pressable>
        <TextInput
          accessibilityLabel="Search or enter a website"
          testID="browser-address"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="web-search"
          returnKeyType="go"
          placeholder="Search or address"
          placeholderTextColor={colors.primary.paragraph}
          value={address}
          onFocus={() => {
            editingAddress.current = true;
          }}
          onBlur={() => {
            editingAddress.current = false;
          }}
          onChangeText={setAddress}
          onSubmitEditing={submitAddress}
          style={[
            styles.address,
            {
              backgroundColor: colors.secondary.background,
              color: colors.primary.heading
            }
          ]}
        />
        {loading ? (
          <View style={styles.control}>
            <ActivityIndicator color={colors.primary.accent} />
          </View>
        ) : source ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reload page"
            onPress={() => {
              resetYouTubeSession();
              setFailed(false);
              webView.current?.reload();
            }}
            style={styles.control}
          >
            <AppIcon name="reload" size={20} />
          </Pressable>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingRight: 12
  },
  control: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  disabled: { opacity: 0.35 },
  address: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: 14,
    fontSize: 16
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 24
  }
});
