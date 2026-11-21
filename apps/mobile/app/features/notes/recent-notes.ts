import { Platform } from "react-native";
import { MMKV } from "../../common/database/mmkv";

const storageKey = "nn::recentlyOpenedNoteIds";
const historyLimit = 20;

export function getRecentNoteIds() {
  return MMKV.getArray<string>(storageKey) || [];
}

export function rememberOpenedNote(id: string) {
  if (Platform.OS !== "ios") return;
  const recentIds = getRecentNoteIds();
  if (recentIds[0] === id) return;
  MMKV.setArray(
    storageKey,
    [id, ...recentIds.filter((recentId) => recentId !== id)].slice(
      0,
      historyLimit
    )
  );
}
