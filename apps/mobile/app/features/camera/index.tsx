import React, { useEffect, useRef, useState } from "react";
import {
  AppState,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewProps,
  requireNativeComponent
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import AppIcon from "../../components/ui/AppIcon";
import useGlobalSafeAreaInsets from "../../hooks/use-global-safe-area-insets";

import { camera, type CameraAccess } from "./native";
import { PhotoReview } from "./photo-review";

const CameraPreview = requireNativeComponent<ViewProps>("OhaiCameraPreview");

export function CameraScreen({
  libraryOpen,
  onOpenLibrary,
  capturingRef
}: {
  libraryOpen: boolean;
  onOpenLibrary: () => void;
  capturingRef: React.RefObject<boolean>;
}) {
  const insets = useGlobalSafeAreaInsets();
  const [captured, setCaptured] = useState<string>();
  const capturedFile = useRef<string | undefined>(undefined);
  const mounted = useRef(false);
  const [access, setAccess] = useState<CameraAccess>();
  const [foreground, setForeground] = useState(
    AppState.currentState === "active"
  );
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    mounted.current = true;
    const update = AppState.addEventListener("change", (state) => {
      setForeground(state === "active");
    });
    return () => {
      mounted.current = false;
      update.remove();
      if (capturedFile.current) camera.discardPhoto(capturedFile.current);
    };
  }, []);

  useEffect(() => {
    if (!foreground || captured) return;
    let cancelled = false;
    void camera
      .requestAccess()
      .then((status) => {
        if (cancelled) return;
        setAccess(status);
        if (status === "granted")
          return camera.setRunning(true).then((running) => {
            if (cancelled) return;
            setReady(running);
            if (!running) setAccess("unavailable");
          });
      })
      .catch(() => {
        if (!cancelled) setAccess("unavailable");
      });

    return () => {
      cancelled = true;
      setReady(false);
      void camera.setRunning(false).catch(() => {});
    };
  }, [foreground, captured]);

  async function takePhoto() {
    if (!ready || capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    setMessage("");
    try {
      const uri = await camera.takePhoto();
      if (!mounted.current) {
        camera.discardPhoto(uri);
        return;
      }
      capturedFile.current = uri;
      setCaptured(uri);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save the photo."
      );
    } finally {
      capturingRef.current = false;
      setCapturing(false);
    }
  }

  function closeReview() {
    if (capturedFile.current) camera.discardPhoto(capturedFile.current);
    capturedFile.current = undefined;
    setCaptured(undefined);
  }

  return (
    <View style={styles.camera} testID="camera-screen">
      {!captured && (
        <View
          testID="camera-swipe-area"
          accessibilityElementsHidden={libraryOpen}
          style={[styles.camera, { paddingTop: insets.top }]}
        >
          <CameraPreview style={StyleSheet.absoluteFill} />
          {access && access !== "granted" ? (
            <View style={styles.cameraStatus}>
              <AppIcon name="camera-outline" size={36} color="white" />
              <Text style={styles.cameraLabel}>
                {access === "denied"
                  ? "Camera access is off"
                  : "Camera unavailable"}
              </Text>
              {access === "denied" && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void Linking.openSettings()}
                >
                  <Text style={styles.cameraLabel}>Open Settings</Text>
                </Pressable>
              )}
            </View>
          ) : null}
          <View style={styles.cameraControls}>
            {message ? (
              <Text accessibilityLiveRegion="polite" style={styles.cameraLabel}>
                {message}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Take photo"
              accessibilityState={{ disabled: !ready || capturing }}
              disabled={!ready || capturing}
              onPress={() => void takePhoto()}
              style={[styles.shutter, (!ready || capturing) && styles.disabled]}
              testID="camera-shutter"
            />
            <Pressable
              accessibilityRole="button"
              disabled={capturing}
              onPress={onOpenLibrary}
              style={styles.libraryButton}
              testID="camera-open-library"
            >
              <AppIcon name="chevron-up" size={22} color="white" />
              <Text style={styles.cameraLabel}>Camera Roll</Text>
            </Pressable>
          </View>
        </View>
      )}
      <Modal
        visible={!!captured}
        animationType="fade"
        presentationStyle="fullScreen"
        onRequestClose={closeReview}
      >
        {captured && (
          <SafeAreaProvider>
            <SafeAreaView style={styles.reviewSafeArea}>
              <PhotoReview uri={captured} onClose={closeReview} />
            </SafeAreaView>
          </SafeAreaProvider>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  camera: { flex: 1, backgroundColor: "#080808" },
  reviewSafeArea: { flex: 1, backgroundColor: "#000" },
  cameraStatus: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14
  },
  cameraControls: {
    position: "absolute",
    bottom: 12,
    left: 0,
    right: 0,
    alignItems: "center",
    gap: 10
  },
  cameraLabel: { color: "white", fontWeight: "600", textAlign: "center" },
  shutter: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderColor: "white",
    borderWidth: 5,
    backgroundColor: "#ffffff22"
  },
  disabled: { opacity: 0.42 },
  libraryButton: {
    minHeight: 44,
    minWidth: 100,
    paddingHorizontal: 12,
    alignItems: "center"
  }
});
