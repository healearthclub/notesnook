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
  Alert,
  Keyboard,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import WebView, { WebViewMessageEvent } from "react-native-webview";
import AppIcon from "../../components/ui/AppIcon";

import { blockedBrowserHost, isYouTubeLookalike } from "./browser-guard";
import {
  observeBrowserMetadata,
  readBrowserMetadata
} from "./browser-metadata";
import { inlineVideoScript } from "./video-playback";
import {
  getYouTubeVideoId,
  observeYouTubePlayback,
  readYouTubePlayback,
  toggleYouTubePlayback,
  YouTubeSession
} from "./youtube-playback";
import { resumeYouTubeAddress, YouTubeResume } from "./youtube-resume";

function isWebAddress(url: string) {
  return /^https?:\/\//i.test(url);
}

function isXGoogleSignIn(source: string, target: string) {
  try {
    const sourceOrigin = new URL(source).origin;
    return (
      (sourceOrigin === "https://x.com" || sourceOrigin === "https://twitter.com") &&
      new URL(target).origin === "https://accounts.google.com"
    );
  } catch {
    return false;
  }
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

export { addressFromInput, isWebAddress };

export type BrowserPageControls = {
  navigate: (address: string) => void;
  toggleYouTube: (shouldPlay: boolean) => boolean;
  stop: () => void;
};

type BrowserPageProps = {
  ref?: Ref<BrowserPageControls>;
  selected: boolean;
  initialAddress: string;
  initialPlayback?: YouTubeResume;
  onNavigate: (address: string, title?: string, favicon?: string) => void;
  onBlocked: () => void;
  onClose: () => void;
  onOpenWindow: (address: string) => void;
  onYouTubePlaybackChange: (playback: YouTubeResume | null) => void;
};

export function BrowserPage({
  ref,
  selected,
  initialAddress,
  initialPlayback,
  onNavigate,
  onBlocked,
  onClose,
  onOpenWindow,
  onYouTubePlaybackChange
}: BrowserPageProps) {
  const { colors } = useThemeColors();
  const webView = useRef<WebView>(null);
  const editingAddress = useRef(false);
  const currentAddress = useRef(initialAddress);
  const xSignInPromptOpen = useRef(false);
  const youtubeSession = useRef<YouTubeSession>(undefined);
  const nextYouTubeSession = useRef(0);
  const checkpoint = useRef(initialPlayback);
  const livePlayback = useRef<YouTubeResume>(undefined);
  const [address, setAddress] = useState(initialAddress);
  const blockedHost = useRef(blockedBrowserHost(initialAddress));
  const [blocked, setBlocked] = useState(blockedHost.current);
  const [source, setSource] = useState<{ uri: string } | undefined>(
    initialAddress && !blockedHost.current ? { uri: initialAddress } : undefined
  );
  const [webViewKey, setWebViewKey] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useImperativeHandle(ref, () => ({
    navigate: openAddress,
    stop() {
      webView.current?.stopLoading();
      setLoading(false);
    },
    toggleYouTube(shouldPlay) {
      const session = youtubeSession.current;
      if (!session || !livePlayback.current || !webView.current) return false;
      webView.current.injectJavaScript(
        toggleYouTubePlayback(session, shouldPlay)
      );
      return true;
    }
  }));

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

    const previous = livePlayback.current;
    const next = { ...playback, videoId: session.videoId };
    livePlayback.current = next;
    checkpoint.current = next;
    if (
      previous?.playing !== next.playing ||
      previous.title !== next.title ||
      previous.progress !== next.progress ||
      previous.position !== next.position
    ) {
      onYouTubePlaybackChange(next);
    }
  }

  function restoreAfterProcessExit() {
    resetYouTubeSession();
    const uri = checkpoint.current
      ? resumeYouTubeAddress(checkpoint.current)
      : currentAddress.current;
    if (!isWebAddress(uri) || blockedHost.current || blockedBrowserHost(uri))
      return;
    setCanGoBack(false);
    setSource({ uri });
    setWebViewKey((key) => key + 1);
  }

  function blockPage(host: string) {
    if (blockedHost.current === host) return;
    blockedHost.current = host;
    webView.current?.stopLoading();
    checkpoint.current = undefined;
    resetYouTubeSession();
    currentAddress.current = "";
    setSource(undefined);
    setCanGoBack(false);
    setLoading(false);
    setFailed(false);
    setBlocked(host);
    onBlocked();
  }

  function openAddress(uri: string) {
    if (!isWebAddress(uri)) return;
    setAddress(uri);
    const host = blockedBrowserHost(uri);
    if (host) {
      blockPage(host);
      return;
    }
    blockedHost.current = undefined;
    setBlocked(undefined);
    resetYouTubeSession();
    setFailed(false);
    if (currentAddress.current === uri && webView.current) {
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
    <View style={styles.screen}>
      {blocked ? (
        <View style={styles.empty} testID="browser-blocked-page">
          <AppIcon
            name="shield-alert-outline"
            color={colors.primary.accent}
            size={40}
          />
          <Text
            accessibilityRole="header"
            style={[styles.blockedTitle, { color: colors.primary.heading }]}
          >
            Page blocked
          </Text>
          <Text
            style={[styles.blockedMessage, { color: colors.primary.paragraph }]}
          >
            {isYouTubeLookalike(blocked)
              ? `${blocked} looks like a misspelling of youtube.com.`
              : `${blocked} is on the Browser block list.`}
          </Text>
          {isYouTubeLookalike(blocked) ? (
            <Pressable
              accessibilityRole="button"
              testID="browser-open-official-youtube"
              onPress={() => openAddress("https://www.youtube.com/")}
              style={styles.blockedAction}
            >
              <Text style={{ color: colors.primary.accent }}>Open YouTube</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            testID="browser-blocked-close-tab"
            onPress={onClose}
            style={styles.blockedAction}
          >
            <Text style={{ color: colors.primary.heading }}>Close tab</Text>
          </Pressable>
        </View>
      ) : source ? (
        <View style={styles.screen}>
          <WebView
            key={webViewKey}
            ref={webView}
            testID={selected ? "browser-webview" : undefined}
            source={source}
            // X redirects embedded iOS agents without a Safari token to a custom scheme.
            applicationNameForUserAgent="Safari/604.1"
            allowsInlineMediaPlayback
            disableJavaScriptDialogs
            fraudulentWebsiteWarningEnabled
            javaScriptCanOpenWindowsAutomatically={false}
            injectedJavaScriptBeforeContentLoaded={inlineVideoScript}
            injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
            allowsBackForwardNavigationGestures
            originWhitelist={["*"]}
            onShouldStartLoadWithRequest={({ url, isTopFrame }) => {
              if (blockedHost.current) return false;
              const host = blockedBrowserHost(url);
              if (host) {
                if (isTopFrame) blockPage(host);
                return false;
              }
              if (isWebAddress(url)) return true;
              if (isTopFrame && loading) {
                setLoading(false);
                setFailed(true);
              }
              return false;
            }}
            onOpenWindow={({ nativeEvent }) => {
              const url = nativeEvent.targetUrl;
              if (
                blockedHost.current ||
                blockedBrowserHost(url) ||
                !isWebAddress(url)
              )
                return;

              if (isXGoogleSignIn(currentAddress.current, url)) {
                if (!selected || xSignInPromptOpen.current) return;
                xSignInPromptOpen.current = true;
                const dismissPrompt = () => {
                  xSignInPromptOpen.current = false;
                };
                // Restart at X so Google can return to its opener in the system browser.
                Alert.alert(
                  "Sign in to X in your browser",
                  "Open X and choose Continue with Google again. You’ll stay signed in to X in that browser.",
                  [
                    { text: "Cancel", style: "cancel", onPress: dismissPrompt },
                    {
                      text: "Open browser",
                      onPress: () => {
                        dismissPrompt();
                        Linking.openURL("https://x.com/i/flow/login").catch(() => {
                          Alert.alert(
                            "Couldn’t open X",
                            "Open x.com in your browser to sign in with Google."
                          );
                        });
                      }
                    }
                  ],
                  { cancelable: true, onDismiss: dismissPrompt }
                );
                return;
              }
              onOpenWindow(url);
            }}
            onLoadStart={() => {
              if (blockedHost.current) return;
              resetYouTubeSession();
              setFailed(false);
              setLoading(true);
            }}
            onLoad={({ nativeEvent }) => {
              if (blockedHost.current) return;
              const host = blockedBrowserHost(nativeEvent.url);
              if (host) {
                blockPage(host);
                return;
              }
              observeYouTubePage(nativeEvent.url);
              if (isWebAddress(nativeEvent.url)) {
                onNavigate(nativeEvent.url, nativeEvent.title);
                webView.current?.injectJavaScript(observeBrowserMetadata);
              }
            }}
            onLoadEnd={() => setLoading(false)}
            onMessage={(event) => {
              if (blockedHost.current) return;
              const address = currentAddress.current;
              const metadata = readBrowserMetadata(
                event.nativeEvent.data,
                address
              );
              if (metadata)
                onNavigate(address, metadata.title, metadata.favicon);
              else receivePlaybackMessage(event);
            }}
            onError={() => {
              if (blockedHost.current) return;
              resetYouTubeSession();
              setFailed(true);
            }}
            onContentProcessDidTerminate={restoreAfterProcessExit}
            onNavigationStateChange={({ url, canGoBack }) => {
              if (blockedHost.current) return;
              const host = blockedBrowserHost(url);
              if (host) {
                blockPage(host);
                return;
              }
              setCanGoBack(canGoBack);
              if (!isWebAddress(url)) return;
              currentAddress.current = url;
              onNavigate(url);
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
          testID={selected ? "browser-address" : undefined}
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop loading page"
            testID="browser-stop-loading"
            onPress={() => {
              webView.current?.stopLoading();
              setLoading(false);
            }}
            style={styles.control}
          >
            <AppIcon name="close" color={colors.primary.accent} size={20} />
          </Pressable>
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
    </View>
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
  blockedTitle: { fontSize: 21, fontWeight: "600" },
  blockedMessage: { textAlign: "center" },
  blockedAction: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 14
  },
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
