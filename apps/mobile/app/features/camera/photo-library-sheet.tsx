import React from "react";
import { Modal } from "react-native";
import { BottomSheet } from "../../components/bottom-sheet";
import { PhotoLibrary } from "./photo-library";

export function PhotoLibrarySheet({
  visible,
  onClose
}: {
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      presentationStyle="overFullScreen"
      animationType="none"
      onRequestClose={onClose}
    >
      {visible && (
        <BottomSheet
          label="Camera Roll"
          handleTestID="camera-library-grabber"
          expandable
          onClose={onClose}
        >
          {({ expanded, bottomInset, close }) => (
            <PhotoLibrary
              expanded={expanded}
              bottomInset={bottomInset}
              onClose={close}
            />
          )}
        </BottomSheet>
      )}
    </Modal>
  );
}
