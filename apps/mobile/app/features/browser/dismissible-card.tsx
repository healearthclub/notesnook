import React, { PropsWithChildren, useRef } from "react";
import {
  Animated,
  StyleSheet,
  useWindowDimensions,
  ViewStyle
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

export function DismissibleCard({
  children,
  onDismiss
}: PropsWithChildren<{ onDismiss: () => void }>) {
  const { width } = useWindowDimensions();
  const offset = useRef(new Animated.Value(0)).current;
  const swipe = Gesture.Pan()
    .maxPointers(1)
    .activeOffsetX(-14)
    .failOffsetY([-10, 10])
    .runOnJS(true)
    .onUpdate(({ translationX }) => {
      offset.setValue(Math.min(0, translationX));
    })
    .onFinalize(({ translationX, velocityX }, success) => {
      const dismiss =
        success &&
        (translationX < -72 || (translationX < -28 && velocityX < -550));
      if (dismiss) {
        Animated.timing(offset, {
          toValue: -width,
          duration: 150,
          useNativeDriver: true
        }).start(({ finished }) => {
          if (finished) onDismiss();
        });
      } else {
        Animated.spring(offset, { toValue: 0, useNativeDriver: true }).start();
      }
    });

  return (
    <GestureDetector gesture={swipe}>
      <Animated.View style={{ transform: [{ translateX: offset }] }}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

export const dismissCardAction = [{ name: "dismiss", label: "Dismiss card" }];

export const dockCardStyle: ViewStyle = {
  minHeight: 52,
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  marginHorizontal: 12,
  marginBottom: 6,
  paddingHorizontal: 8,
  paddingVertical: 6,
  borderRadius: 13,
  borderWidth: StyleSheet.hairlineWidth
};

export const compactDockCardStyle: ViewStyle = {
  minHeight: 58,
  marginHorizontal: 0,
  marginBottom: 0,
  gap: 6
};
