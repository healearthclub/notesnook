import { useThemeColors } from "@notesnook/theme";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  View
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView
} from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring
} from "react-native-reanimated";
import {
  SafeAreaProvider,
  useSafeAreaInsets
} from "react-native-safe-area-context";
import { scheduleOnUI } from "react-native-worklets";

const SHEET_SPRING = {
  stiffness: 320,
  damping: 32,
  mass: 0.9,
  overshootClamping: true
};

const HANDLE_HEIGHT = 24;

type BottomSheetProps = {
  onClose: () => void;
  label: string;
  handleTestID?: string;
  heightFraction?: number;
  expandable?: boolean;
  avoidKeyboard?: boolean;
  children: (state: {
    expanded: boolean;
    bottomInset: number;
    close: () => void;
  }) => React.ReactNode;
};

export function BottomSheet({ avoidKeyboard, ...props }: BottomSheetProps) {
  return (
    <SafeAreaProvider>
      {avoidKeyboard ? (
        <KeyboardAvoidingView behavior="padding" style={styles.fill}>
          <Sheet {...props} />
        </KeyboardAvoidingView>
      ) : (
        <Sheet {...props} />
      )}
    </SafeAreaProvider>
  );
}

function Sheet({
  onClose,
  children,
  label,
  handleTestID,
  heightFraction,
  expandable = false
}: BottomSheetProps) {
  const { colors } = useThemeColors();
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);
  const [halfLayout, setHalfLayout] = useState(false);
  const [height, setHeight] = useState(0);
  const availableHeight = Math.max(0, height - insets.top);
  const restingHeight =
    heightFraction === undefined
      ? availableHeight * 0.54
      : Math.min(availableHeight, height * heightFraction);
  const restingProgress =
    availableHeight > 0 ? restingHeight / availableHeight : 0;
  const progress = useSharedValue(0);
  const dragStart = useSharedValue(0);
  const dragOffset = useSharedValue(0);
  const dragging = useSharedValue(false);
  const closing = useSharedValue(false);
  const previousRest = useRef(0);

  const snap = useCallback(
    (detent: number, velocity = 0) => {
      "worklet";
      if (closing.value) return;
      closing.value = detent === 0;
      runOnJS(setExpanded)(detent === 1);
      if (detent === 1) runOnJS(setHalfLayout)(false);
      progress.value = withSpring(
        detent,
        { ...SHEET_SPRING, velocity },
        (finished) => {
          if (!finished) return;
          if (detent === 0) runOnJS(onClose)();
          else if (detent === restingProgress) runOnJS(setHalfLayout)(true);
        }
      );
    },
    [closing, onClose, progress, restingProgress]
  );

  useEffect(() => {
    if (!restingProgress || previousRest.current === restingProgress) return;
    previousRest.current = restingProgress;
    if (!expanded) scheduleOnUI(snap, restingProgress);
  }, [expanded, restingProgress, snap]);

  const close = () => scheduleOnUI(snap, 0);

  function sheetPan(enabled: boolean) {
    const rest = expanded ? 1 : restingProgress;
    return Gesture.Pan()
      .enabled(enabled)
      .maxPointers(1)
      .activeOffsetY([-12, 12])
      .failOffsetX([-20, 20])
      .onStart(({ translationY }) => {
        if (closing.value) return;
        cancelAnimation(progress);
        dragStart.value = progress.value;
        dragOffset.value = translationY;
        dragging.value = true;
        runOnJS(setHalfLayout)(false);
      })
      .onUpdate(({ translationY }) => {
        if (!dragging.value || closing.value) return;
        const distance = translationY - dragOffset.value;
        progress.value = Math.max(
          0,
          Math.min(
            expandable ? 1 : restingProgress,
            dragStart.value - distance / Math.max(1, availableHeight)
          )
        );
      })
      .onEnd(({ translationY, velocityY }) => {
        if (!dragging.value) return;
        dragging.value = false;
        const distance = translationY + velocityY * 0.12;
        let detent = rest;
        if (expandable && distance < -48) detent = 1;
        if (distance > 48) detent = expanded ? restingProgress : 0;
        snap(detent, -velocityY / Math.max(1, availableHeight));
      })
      .onFinalize(() => {
        if (!dragging.value) return;
        dragging.value = false;
        snap(rest);
      });
  }

  // Move the sheet without laying out the content again on each frame.
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY:
          availableHeight * (1 - Math.max(0, Math.min(1, progress.value)))
      }
    ]
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity:
      Math.min(1, progress.value / Math.max(0.01, restingProgress)) * 0.24
  }));

  return (
    <GestureHandlerRootView
      style={styles.fill}
      onLayout={({ nativeEvent }) => setHeight(nativeEvent.layout.height)}
    >
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={styles.fill} onPress={close} accessible={false} />
      </Animated.View>
      <GestureDetector gesture={sheetPan(expandable && !expanded)}>
        <Animated.View
          accessibilityViewIsModal
          onAccessibilityEscape={close}
          style={[
            styles.sheet,
            {
              backgroundColor: colors.primary.background,
              height: availableHeight
            },
            sheetStyle
          ]}
        >
          <GestureDetector gesture={sheetPan(!expandable || expanded)}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                expandable
                  ? `${expanded ? "Collapse" : "Expand"} ${label}`
                  : `Close ${label}`
              }
              testID={handleTestID}
              onPress={
                expandable
                  ? () => scheduleOnUI(snap, expanded ? restingProgress : 1)
                  : close
              }
              style={styles.handle}
            >
              <View
                style={[
                  styles.grabber,
                  { backgroundColor: colors.secondary.paragraph }
                ]}
              />
            </Pressable>
          </GestureDetector>
          <View
            style={
              !expandable || halfLayout
                ? {
                    height: Math.max(0, restingHeight - HANDLE_HEIGHT)
                  }
                : styles.fill
            }
          >
            {children({ expanded, bottomInset: insets.bottom, close })}
          </View>
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "#000" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden"
  },
  handle: {
    height: HANDLE_HEIGHT,
    alignItems: "center",
    justifyContent: "center"
  },
  grabber: { width: 36, height: 4, borderRadius: 2, opacity: 0.55 }
});
