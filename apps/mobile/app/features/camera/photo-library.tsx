import {
  CameraRoll,
  cameraRollEventEmitter,
  iosReadGalleryPermission,
  iosRefreshGallerySelection,
  iosRequestReadWriteGalleryPermission
} from "@react-native-camera-roll/camera-roll";
import { useThemeColors } from "@notesnook/theme";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  AppState,
  FlatList,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  ViewToken,
  View
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { FolderRow } from "../../components/ui/folder-row";
import AppIcon from "../../components/ui/AppIcon";
import { camera, LibraryAlbum, LibraryAsset } from "./native";

const tabs = ["Photos", "Videos", "Folders"] as const;
const DEFAULT_PHOTO_COLUMNS = 3;
const MAX_COLUMNS = 4;
const PINCH_THRESHOLD = 1.18;

export function PhotoLibrary({
  expanded,
  bottomInset,
  onClose
}: {
  expanded: boolean;
  bottomInset: number;
  onClose: () => void;
}) {
  const { colors } = useThemeColors();
  const { width } = useWindowDimensions();
  const [selected, setSelected] = useState(0);
  const [album, setAlbum] = useState<LibraryAlbum>();
  const [preview, setPreview] = useState<LibraryAsset>();
  const [permission, setPermission] = useState<
    "granted" | "limited" | "denied"
  >();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const pager = useRef<ScrollView>(null);
  const activeTab = useRef(0);
  const previousWidth = useRef(0);
  const permissionRequest = useRef(0);
  const checking = useRef(false);
  const playing = useRef(false);

  const refresh = useCallback(async (ask = false) => {
    if (checking.current) return;
    const request = ++permissionRequest.current;
    checking.current = true;
    setError("");
    try {
      let status = await iosReadGalleryPermission("readWrite");
      if (ask && status === "not-determined") {
        status = await iosRequestReadWriteGalleryPermission();
      }
      if (request !== permissionRequest.current) return;
      if (status === "granted" || status === "limited") {
        setPermission(status);
        setRevision((value) => value + 1);
      } else {
        previousWidth.current = 0;
        setPermission("denied");
        setPreview(undefined);
        setAlbum(undefined);
      }
    } catch {
      if (request === permissionRequest.current)
        setError("Could not load Camera Roll.");
    } finally {
      if (request === permissionRequest.current) checking.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    const state = AppState.addEventListener("change", (next) => {
      if (next === "active") void refresh();
    });
    const selection = cameraRollEventEmitter.addListener(
      "onLibrarySelectionChange",
      () => void refresh()
    );
    return () => {
      permissionRequest.current++;
      checking.current = false;
      state.remove();
      selection.remove();
    };
  }, [refresh]);

  function selectTab(index: number) {
    activeTab.current = index;
    setSelected(index);
    pager.current?.scrollTo({ x: index * width, animated: true });
  }

  function goBack() {
    if (preview) setPreview(undefined);
    else if (selected === 2 && album) setAlbum(undefined);
    else onClose();
  }

  async function openAsset(asset: LibraryAsset) {
    if (!asset.node.type.startsWith("video")) {
      setPreview(asset);
      return;
    }
    if (playing.current) return;
    playing.current = true;
    try {
      await camera.playVideo(asset.node.id);
    } catch {
      setError("Could not open this video.");
    } finally {
      playing.current = false;
    }
  }

  return (
    <View
      style={[styles.fill, { paddingBottom: bottomInset }]}
      testID="camera-library"
    >
      <View style={[styles.header, { borderColor: colors.primary.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            preview
              ? "Close photo"
              : selected === 2 && album
              ? "Back to folders"
              : "Close Camera Roll"
          }
          onPress={goBack}
          style={styles.button}
        >
          <AppIcon
            name={
              preview || (selected === 2 && album)
                ? "chevron-left"
                : "chevron-down"
            }
            size={25}
          />
        </Pressable>
        {preview ? (
          <Text
            accessibilityRole="header"
            style={[styles.previewTitle, { color: colors.primary.heading }]}
          >
            Photo
          </Text>
        ) : (
          <View style={styles.tabs} accessibilityRole="tablist">
            {tabs.map((tab, index) => (
              <Pressable
                key={tab}
                accessibilityRole="tab"
                accessibilityState={{ selected: selected === index }}
                testID={`camera-library-tab-${tab.toLowerCase()}`}
                onPress={() => selectTab(index)}
                style={[
                  styles.tab,
                  {
                    borderBottomColor:
                      selected === index
                        ? colors.primary.heading
                        : "transparent"
                  }
                ]}
              >
                <Text
                  style={[
                    styles.tabLabel,
                    {
                      color:
                        selected === index
                          ? colors.primary.heading
                          : colors.secondary.paragraph
                    }
                  ]}
                >
                  {tab}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
      {permission === "limited" && !preview && (
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => {
            void iosRefreshGallerySelection().catch(() =>
              Linking.openSettings()
            );
          }}
        >
          <Text style={{ color: colors.primary.accent }}>
            Manage Photos access
          </Text>
        </Pressable>
      )}
      {!!error && (
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => void refresh()}
        >
          <Text style={{ color: colors.primary.paragraph }}>
            {error} Tap to retry.
          </Text>
        </Pressable>
      )}
      {permission === "denied" ? (
        <View style={styles.status}>
          <Text style={{ color: colors.primary.heading }}>
            Allow Photos access to see your Camera Roll.
          </Text>
          <Pressable
            accessibilityRole="button"
            style={styles.button}
            onPress={() => void Linking.openSettings()}
          >
            <Text style={{ color: colors.primary.accent }}>Open Settings</Text>
          </Pressable>
        </View>
      ) : permission ? (
        <View style={styles.fill}>
          <ScrollView
            ref={pager}
            testID="camera-library-pager"
            horizontal
            pagingEnabled
            directionalLockEnabled
            bounces={false}
            showsHorizontalScrollIndicator={false}
            contentInsetAdjustmentBehavior="never"
            accessibilityElementsHidden={!!preview}
            pointerEvents={preview ? "none" : "auto"}
            onContentSizeChange={() => {
              if (previousWidth.current === width) return;
              previousWidth.current = width;
              pager.current?.scrollTo({
                x: activeTab.current * width,
                animated: false
              });
            }}
            onMomentumScrollEnd={({ nativeEvent }) => {
              const index = Math.max(
                0,
                Math.min(
                  tabs.length - 1,
                  Math.round(nativeEvent.contentOffset.x / width)
                )
              );
              activeTab.current = index;
              setSelected(index);
            }}
          >
            <View
              style={{ width }}
              accessibilityElementsHidden={selected !== 0}
            >
              <MediaGrid
                width={width}
                revision={revision}
                scrollEnabled={expanded}
                assetType="Photos"
                onOpen={openAsset}
              />
            </View>
            <View
              style={{ width }}
              accessibilityElementsHidden={selected !== 1}
            >
              <MediaGrid
                width={width}
                revision={revision}
                scrollEnabled={expanded}
                assetType="Videos"
                onOpen={openAsset}
              />
            </View>
            <View
              style={{ width }}
              accessibilityElementsHidden={selected !== 2}
            >
              {album ? (
                <>
                  <Text
                    accessibilityRole="header"
                    style={[
                      styles.albumTitle,
                      { color: colors.primary.heading }
                    ]}
                  >
                    {album.title}
                  </Text>
                  <MediaGrid
                    key={album.id}
                    width={width}
                    revision={revision}
                    scrollEnabled={expanded}
                    assetType="All"
                    album={album}
                    onOpen={openAsset}
                  />
                </>
              ) : (
                <Albums
                  revision={revision}
                  scrollEnabled={expanded}
                  onOpen={setAlbum}
                />
              )}
            </View>
          </ScrollView>
          {preview && (
            <Image
              source={{ uri: preview.node.image.uri }}
              style={[StyleSheet.absoluteFill, styles.preview]}
              resizeMode="contain"
            />
          )}
        </View>
      ) : (
        !error && (
          <Text
            style={[
              styles.status,
              { color: colors.primary.paragraph, textAlign: "center" }
            ]}
          >
            Loading Camera Roll…
          </Text>
        )
      )}
    </View>
  );
}

function Albums({
  revision,
  scrollEnabled,
  onOpen
}: {
  revision: number;
  scrollEnabled: boolean;
  onOpen: (album: LibraryAlbum) => void;
}) {
  const { colors } = useThemeColors();
  const [albums, setAlbums] = useState<LibraryAlbum[]>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let ignore = false;
    setError(false);
    void camera
      .listAlbums()
      .then((result) => {
        if (!ignore) setAlbums(result);
      })
      .catch(() => {
        if (!ignore) setError(true);
      });
    return () => {
      ignore = true;
    };
  }, [revision, retry]);

  return (
    <FlatList
      data={albums}
      testID="camera-library-albums"
      scrollEnabled={scrollEnabled}
      keyExtractor={({ id }) => id}
      ListEmptyComponent={
        <Pressable
          disabled={!error}
          style={styles.status}
          onPress={() => setRetry((value) => value + 1)}
        >
          <Text style={{ color: colors.primary.paragraph }}>
            {error
              ? "Could not load albums. Tap to retry."
              : albums
              ? "No albums"
              : "Loading albums…"}
          </Text>
        </Pressable>
      }
      renderItem={({ item }) => (
        <FolderRow
          title={item.title}
          count={item.count}
          accessibilityLabel={item.title}
          onPress={() => onOpen(item)}
        />
      )}
    />
  );
}

function MediaGrid({
  width,
  revision,
  assetType,
  album,
  scrollEnabled,
  onOpen
}: {
  width: number;
  revision: number;
  assetType: "Photos" | "Videos" | "All";
  album?: LibraryAlbum;
  scrollEnabled: boolean;
  onOpen: (asset: LibraryAsset) => void;
}) {
  const { colors } = useThemeColors();
  const [items, setItems] = useState<LibraryAsset[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const cursor = useRef<string | number | null>(null);
  const request = useRef(0);
  const busy = useRef(false);
  const albumId = album?.id;
  const canZoom = assetType !== "Videos";
  const [grid, setGrid] = useState(() => ({
    columns: canZoom ? DEFAULT_PHOTO_COLUMNS : MAX_COLUMNS,
    anchorIndex: 0
  }));
  const firstVisiblePhoto = useRef(0);
  const cell = width / grid.columns;

  const rememberVisiblePhoto = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const index = viewableItems[0]?.index;
      if (index != null) firstVisiblePhoto.current = index;
    },
    []
  );

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .enabled(canZoom)
        .runOnJS(true)
        .onEnd(({ scale }) => {
          const change =
            scale >= PINCH_THRESHOLD
              ? -1
              : scale <= 1 / PINCH_THRESHOLD
              ? 1
              : 0;
          if (!change) return;
          const anchorIndex = firstVisiblePhoto.current;
          setGrid((current) => {
            const columns = Math.min(
              MAX_COLUMNS,
              Math.max(1, current.columns + change)
            );
            return columns === current.columns
              ? current
              : { columns, anchorIndex };
          });
        }),
    [canZoom]
  );

  const load = useCallback(
    async (reset: boolean) => {
      if (!reset && (busy.current || cursor.current === null)) return;
      const token = ++request.current;
      busy.current = true;
      setError(false);
      if (reset) setLoading(true);
      try {
        const fetched = albumId
          ? await camera.getAlbumPage(
              albumId,
              reset ? 0 : Number(cursor.current)
            )
          : await CameraRoll.getPhotos({
              first: 48,
              after: reset ? undefined : String(cursor.current),
              assetType,
              include: ["playableDuration"]
            }).then(({ edges, page_info }) => ({
              items: edges,
              nextOffset: page_info.has_next_page
                ? page_info.end_cursor ?? null
                : null
            }));
        if (request.current !== token) return;
        cursor.current = fetched.nextOffset;
        setItems((current) => {
          if (reset) return fetched.items;
          const known = new Set(current.map(({ node }) => node.id));
          return [
            ...current,
            ...fetched.items.filter(({ node }) => !known.has(node.id))
          ];
        });
      } catch {
        if (request.current === token) setError(true);
      } finally {
        if (request.current === token) {
          setLoading(false);
          busy.current = false;
        }
      }
    },
    [albumId, assetType]
  );

  useEffect(() => {
    void load(true);
    return () => {
      request.current++;
    };
  }, [load, revision]);

  const rows = (
    <FlatList
      key={grid.columns}
      testID={`camera-library-grid-${assetType.toLowerCase()}`}
      scrollEnabled={scrollEnabled}
      data={items}
      numColumns={grid.columns}
      // FlatList virtualizes rows when numColumns is set.
      initialScrollIndex={
        items.length && !error
          ? Math.floor(
              Math.min(grid.anchorIndex, items.length - 1) / grid.columns
            )
          : undefined
      }
      getItemLayout={
        error
          ? undefined
          : (_, row) => ({ length: cell, offset: cell * row, index: row })
      }
      onViewableItemsChanged={rememberVisiblePhoto}
      keyExtractor={({ node }) => node.id}
      initialNumToRender={20}
      onEndReached={() => void load(false)}
      onEndReachedThreshold={0.5}
      ListHeaderComponent={
        error ? (
          <Pressable
            accessibilityRole="button"
            style={styles.status}
            onPress={() => void load(true)}
          >
            <Text style={{ color: colors.primary.paragraph }}>
              Could not load media. Tap to retry.
            </Text>
          </Pressable>
        ) : null
      }
      ListEmptyComponent={
        !error ? (
          <View style={styles.status}>
            <Text style={{ color: colors.primary.paragraph }}>
              {loading
                ? "Loading…"
                : assetType === "Photos"
                ? "No photos"
                : assetType === "Videos"
                ? "No videos"
                : "This album is empty"}
            </Text>
          </View>
        ) : null
      }
      renderItem={({ item, index }) => {
        const video = item.node.type.startsWith("video");
        const seconds = Math.floor(item.node.image.playableDuration || 0);
        return (
          <Pressable
            testID={`camera-library-${assetType.toLowerCase()}-item-${index}`}
            accessibilityRole="button"
            accessibilityLabel={`${video ? "Open video" : "Open photo"} ${
              index + 1
            }`}
            onPress={() => onOpen(item)}
            style={[
              styles.cell,
              {
                width: cell,
                height: cell,
                backgroundColor: colors.secondary.background
              }
            ]}
          >
            <Image
              source={{ uri: item.node.image.uri }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
            />
            {video && (
              <Text style={styles.duration}>
                {Math.floor(seconds / 60)}:
                {String(seconds % 60).padStart(2, "0")}
              </Text>
            )}
          </Pressable>
        );
      }}
    />
  );
  return canZoom ? (
    <GestureDetector gesture={pinch}>
      <View collapsable={false} style={styles.fill}>
        {rows}
      </View>
    </GestureDetector>
  ) : (
    rows
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "stretch",
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  button: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 10,
    justifyContent: "center",
    alignItems: "center"
  },
  tabs: { flex: 1, flexDirection: "row", paddingRight: 12, gap: 12 },
  tab: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    borderBottomWidth: 2
  },
  tabLabel: { fontSize: 16, fontWeight: "700" },
  previewTitle: { alignSelf: "center", fontSize: 18, fontWeight: "700" },
  status: { padding: 20, alignItems: "center" },
  preview: { width: "100%", height: "100%", backgroundColor: "#080808" },
  albumTitle: { fontSize: 18, fontWeight: "700", padding: 16 },
  cell: {
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ffffff44"
  },
  duration: {
    position: "absolute",
    right: 4,
    bottom: 4,
    paddingHorizontal: 4,
    backgroundColor: "#0009",
    color: "white",
    fontSize: 11,
    fontWeight: "600"
  }
});
