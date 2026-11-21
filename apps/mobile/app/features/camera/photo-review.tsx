import { useThemeColors } from "@notesnook/theme";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  LayoutRectangle,
  PanResponder,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import Share from "react-native-share";
import Svg, { Path } from "react-native-svg";
import { captureRef, releaseCapture } from "react-native-view-shot";
import AppIcon from "../../components/ui/AppIcon";
import { camera } from "./native";

const looks = [
  { name: "Original", tint: "transparent" },
  { name: "Warm", tint: "#ff7b1638" },
  { name: "Cool", tint: "#3679ff35" },
  { name: "Rose", tint: "#fa548935" },
  { name: "Fade", tint: "#e9d1b240" },
  { name: "Night", tint: "#15133063" }
];
const stickers = ["❤️", "✨", "🔥", "😂", "🌎", "⭐"];
const inkColors = ["#ffffff", "#ff435a", "#ffda48", "#78e4a4", "#6a9bff"];

type Tool = "text" | "draw" | "stickers" | "link" | "looks";
type Stroke = { color: string; path: string };

export function PhotoReview({
  uri,
  onClose
}: {
  uri: string;
  onClose: () => void;
}) {
  const { colors } = useThemeColors();
  const [bounds, setBounds] = useState<LayoutRectangle>();
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [tool, setTool] = useState<Tool>();
  const [caption, setCaption] = useState("");
  const [sticker, setSticker] = useState("");
  const [link, setLink] = useState("");
  const [look, setLook] = useState(0);
  const [cropped, setCropped] = useState(false);
  const [ink, setInk] = useState(0);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [activeStroke, setActiveStroke] = useState<Stroke>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const canvas = useRef<View>(null);
  const operation = useRef(false);
  const currentStroke = useRef<Stroke | undefined>(undefined);
  const ratio = size ? (cropped ? 1 : size.width / size.height) : 1;
  const width = bounds ? Math.min(bounds.width, bounds.height * ratio) : 0;
  const height = width / ratio;

  useEffect(() => {
    let active = true;
    Image.getSize(
      uri,
      (width, height) => {
        if (active) setSize({ width, height });
      },
      () => {
        if (active) setMessage("Could not open the photo.");
      }
    );
    return () => {
      active = false;
    };
  }, [uri]);

  const draw = useMemo(() => {
    function point(x: number, y: number) {
      return `${Math.round(
        Math.max(0, Math.min(1000, (x * 1000) / width))
      )} ${Math.round(Math.max(0, Math.min(1000, (y * 1000) / height)))}`;
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => tool === "draw",
      onMoveShouldSetPanResponder: () => tool === "draw",
      onPanResponderGrant: ({ nativeEvent }) => {
        const position = point(nativeEvent.locationX, nativeEvent.locationY);
        const stroke = {
          color: inkColors[ink],
          path: `M${position} L${position}`
        };
        currentStroke.current = stroke;
        setActiveStroke(stroke);
      },
      onPanResponderMove: ({ nativeEvent }) => {
        const stroke = currentStroke.current;
        if (!stroke) return;
        const next = {
          ...stroke,
          path: `${stroke.path} L${point(
            nativeEvent.locationX,
            nativeEvent.locationY
          )}`
        };
        currentStroke.current = next;
        setActiveStroke(next);
      },
      onPanResponderRelease: () => {
        const stroke = currentStroke.current;
        if (stroke) setStrokes((previous) => [...previous, stroke]);
        currentStroke.current = undefined;
        setActiveStroke(undefined);
      },
      onPanResponderTerminate: () => {
        currentStroke.current = undefined;
        setActiveStroke(undefined);
      }
    });
  }, [height, ink, tool, width]);

  function selectTool(next: Tool) {
    Keyboard.dismiss();
    setTool((current) => (current === next ? undefined : next));
  }

  async function exportPhoto(action: "save" | "share") {
    if (operation.current || !size || !canvas.current || !width) return;
    operation.current = true;
    setBusy(true);
    setMessage("");
    Keyboard.dismiss();
    let exportUri = uri;
    try {
      if (cropped || look || caption.trim() || sticker || strokes.length) {
        const scale = Math.min(
          2048 / Math.max(width, height),
          size.width / width,
          size.height / height
        );
        const result = await captureRef(canvas, {
          format: "jpg",
          quality: 0.95,
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
          result: "tmpfile"
        });
        exportUri = result.startsWith("file://") ? result : `file://${result}`;
      }
      if (action === "save") {
        await camera.savePhoto(exportUri);
        setMessage("Saved to Photos");
      } else {
        const url = link.trim();
        if (url && !/^https?:\/\/[^\s]+$/i.test(url)) {
          setTool("link");
          setMessage("Enter a link starting with https://");
          return;
        }
        await Share.open({
          url: exportUri,
          type: "image/jpeg",
          message: url || undefined,
          failOnCancel: false
        });
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not export the photo."
      );
    } finally {
      if (exportUri !== uri) releaseCapture(exportUri);
      operation.current = false;
      setBusy(false);
    }
  }

  const tools: { name: Tool; icon: string; label: string }[] = [
    { name: "text", icon: "format-text", label: "Text" },
    { name: "draw", icon: "pencil", label: "Draw" },
    { name: "stickers", icon: "sticker-outline", label: "Stickers" },
    { name: "looks", icon: "palette-outline", label: "Filters" },
    { name: "link", icon: "attachment", label: "Link" }
  ];

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={styles.review}
      testID="camera-photo-review"
    >
      <StatusBar barStyle="light-content" />
      <View
        style={styles.stage}
        onLayout={({ nativeEvent }) => setBounds(nativeEvent.layout)}
      >
        {size && (
          <Image
            source={{ uri }}
            blurRadius={22}
            resizeMode="cover"
            style={[StyleSheet.absoluteFill, { opacity: 0.4 }]}
          />
        )}
        {size && width > 0 ? (
          <View
            ref={canvas}
            collapsable={false}
            style={[styles.canvas, { width, height }]}
          >
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <Image
                source={{ uri }}
                resizeMode="cover"
                style={StyleSheet.absoluteFill}
              />
              <View
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: looks[look].tint }
                ]}
              />
              {caption.trim() ? (
                <View style={styles.caption}>
                  <Text style={styles.captionText}>{caption.trim()}</Text>
                </View>
              ) : null}
              {sticker ? <Text style={styles.sticker}>{sticker}</Text> : null}
              <Svg
                width="100%"
                height="100%"
                viewBox="0 0 1000 1000"
                preserveAspectRatio="none"
              >
                {strokes.map(({ color, path }, index) => (
                  <Path
                    key={index}
                    d={path}
                    stroke={color}
                    strokeWidth={9}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                ))}
                {activeStroke && (
                  <Path
                    d={activeStroke.path}
                    stroke={activeStroke.color}
                    strokeWidth={9}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                )}
              </Svg>
            </View>
            {tool === "draw" && (
              <View {...draw.panHandlers} style={StyleSheet.absoluteFill} />
            )}
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close photo review"
          disabled={busy}
          onPress={onClose}
          style={[styles.icon, styles.close]}
        >
          <AppIcon name="close" size={25} color="white" />
        </Pressable>
        <View style={styles.tools}>
          {tools.map(({ name, icon, label }) => (
            <Pressable
              key={name}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: tool === name }}
              testID={`camera-review-${name}`}
              disabled={busy}
              onPress={() => selectTool(name)}
              style={[styles.icon, tool === name && styles.selected]}
            >
              <AppIcon name={icon} size={22} color="white" />
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Square crop"
            accessibilityState={{ selected: cropped }}
            disabled={busy}
            style={[styles.icon, cropped && styles.selected]}
            onPress={() => {
              setTool(undefined);
              Keyboard.dismiss();
              setCropped((value) => !value);
            }}
          >
            <AppIcon name="crop" size={23} color="white" />
          </Pressable>
        </View>
        {(tool === "text" || tool === "link") && (
          <View style={styles.inputBar}>
            <TextInput
              autoFocus
              autoCapitalize={tool === "link" ? "none" : "sentences"}
              autoCorrect={tool === "text"}
              keyboardType={tool === "link" ? "url" : "default"}
              placeholder={tool === "text" ? "Add text" : "Add a link to share"}
              placeholderTextColor="#bdbdbd"
              value={tool === "text" ? caption : link}
              onChangeText={tool === "text" ? setCaption : setLink}
              testID="camera-review-input"
              returnKeyType="done"
              onSubmitEditing={() => setTool(undefined)}
              maxLength={tool === "text" ? 180 : 2048}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                Keyboard.dismiss();
                setTool(undefined);
              }}
              style={styles.icon}
            >
              <Text style={styles.label}>Done</Text>
            </Pressable>
          </View>
        )}
        {(tool === "looks" || tool === "stickers" || tool === "draw") && (
          <ScrollView
            horizontal
            style={styles.choices}
            contentContainerStyle={styles.choicesContent}
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
          >
            {tool === "looks" &&
              looks.map(({ name, tint }, index) => (
                <Pressable
                  key={name}
                  accessibilityRole="button"
                  accessibilityState={{ selected: look === index }}
                  onPress={() => setLook(index)}
                  style={[styles.option, look === index && styles.selected]}
                >
                  <View style={[styles.swatch, { backgroundColor: tint }]} />
                  <Text style={styles.label}>{name}</Text>
                </Pressable>
              ))}
            {tool === "stickers" &&
              stickers.map((item) => (
                <Pressable
                  key={item}
                  accessibilityRole="button"
                  accessibilityState={{ selected: sticker === item }}
                  onPress={() => setSticker(sticker === item ? "" : item)}
                  style={[styles.icon, sticker === item && styles.selected]}
                >
                  <Text style={styles.emoji}>{item}</Text>
                </Pressable>
              ))}
            {tool === "draw" && (
              <>
                {inkColors.map((color, index) => (
                  <Pressable
                    key={color}
                    accessibilityRole="button"
                    accessibilityLabel={`Ink color ${index + 1}`}
                    accessibilityState={{ selected: ink === index }}
                    onPress={() => setInk(index)}
                    style={[styles.icon, ink === index && styles.selected]}
                  >
                    <View style={[styles.swatch, { backgroundColor: color }]} />
                  </Pressable>
                ))}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Undo stroke"
                  onPress={() =>
                    setStrokes((previous) => previous.slice(0, -1))
                  }
                  style={styles.icon}
                >
                  <AppIcon name="undo" size={22} color="white" />
                </Pressable>
              </>
            )}
          </ScrollView>
        )}
      </View>
      {message ? (
        <Text accessibilityLiveRegion="polite" style={styles.message}>
          {message}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={busy || !size}
          onPress={() => void exportPhoto("save")}
          testID="camera-review-save"
          style={styles.action}
        >
          <AppIcon name="download" size={21} color="white" />
          <Text style={styles.label}>Save</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Story publishing is unavailable"
          disabled
          style={[styles.action, styles.disabled]}
        >
          <Text style={styles.label}>Story</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy || !size}
          onPress={() => void exportPhoto("share")}
          testID="camera-review-send"
          style={[
            styles.action,
            styles.send,
            { backgroundColor: colors.primary.accent }
          ]}
        >
          <Text
            style={[
              styles.sendText,
              { color: colors.primary.accentForeground }
            ]}
          >
            Send To
          </Text>
          <AppIcon
            name="share"
            size={22}
            color={colors.primary.accentForeground}
          />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  review: { flex: 1, backgroundColor: "#000" },
  stage: {
    flex: 1,
    backgroundColor: "#171717",
    borderRadius: 18,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center"
  },
  canvas: { backgroundColor: "#000", overflow: "hidden" },
  icon: {
    minWidth: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 7,
    backgroundColor: "#18181888",
    borderRadius: 22
  },
  close: { position: "absolute", left: 8, top: 7 },
  tools: { position: "absolute", right: 7, top: 7, gap: 2 },
  selected: { backgroundColor: "#ffffff48" },
  caption: {
    position: "absolute",
    left: "8%",
    right: "8%",
    top: "44%",
    alignItems: "center"
  },
  captionText: {
    color: "white",
    backgroundColor: "#0009",
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center"
  },
  sticker: { position: "absolute", left: "9%", bottom: "12%", fontSize: 49 },
  inputBar: {
    position: "absolute",
    bottom: 8,
    left: 8,
    right: 8,
    flexDirection: "row",
    backgroundColor: "#121212f0",
    borderRadius: 22,
    alignItems: "center",
    paddingHorizontal: 8
  },
  input: { color: "white", minHeight: 44, flex: 1, paddingHorizontal: 8 },
  choices: { position: "absolute", bottom: 8, left: 8, right: 8, flexGrow: 0 },
  choicesContent: { alignItems: "center", gap: 6 },
  option: {
    minHeight: 44,
    minWidth: 58,
    gap: 3,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 18,
    backgroundColor: "#181818cc"
  },
  swatch: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderColor: "#ffffffaa",
    borderWidth: 1
  },
  emoji: { fontSize: 23 },
  message: { color: "white", fontSize: 13, textAlign: "center", marginTop: 8 },
  actions: {
    flexDirection: "row",
    gap: 8,
    paddingTop: 12,
    paddingBottom: 5,
    paddingHorizontal: 10
  },
  action: {
    flex: 1,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 5,
    borderRadius: 24,
    backgroundColor: "#2c2c2c"
  },
  label: { color: "white", fontWeight: "700" },
  disabled: { opacity: 0.55 },
  send: { flex: 1.3 },
  sendText: { fontWeight: "800" }
});
