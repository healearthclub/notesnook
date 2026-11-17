import { NativeModules } from "react-native";

export type CameraAccess = "granted" | "denied" | "unavailable";

export type LibraryAsset = {
  node: {
    id: string;
    type: string;
    image: { uri: string; playableDuration: number };
  };
};

export type LibraryAlbum = { id: string; title: string; count: number };

export const camera = NativeModules.OhaiCamera as {
  requestAccess(): Promise<CameraAccess>;
  setRunning(running: boolean): Promise<boolean>;
  takePhoto(): Promise<string>;
  savePhoto(uri: string): Promise<boolean>;
  discardPhoto(uri: string): void;
  playVideo(id: string): Promise<void>;
  listAlbums(): Promise<LibraryAlbum[]>;
  getAlbumPage(
    id: string,
    offset: number
  ): Promise<{ items: LibraryAsset[]; nextOffset: number | null }>;
};
