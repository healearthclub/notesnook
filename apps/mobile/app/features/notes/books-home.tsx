import { ScriptureCard } from "../scripture/scripture-card"; // scripture-integration: Books entry
import { useThemeColors } from "@notesnook/theme";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { MMKV } from "../../common/database/mmkv";
import { AuthMode } from "../../components/auth/common";
import AppIcon from "../../components/ui/AppIcon";
import useGlobalSafeAreaInsets from "../../hooks/use-global-safe-area-insets";
import Navigation from "../../services/navigation";
import { loadOhaiAccount, useOhaiAccount } from "../login/google-session";
import { loadAccountBooks, loadReadingCopy } from "./books-library";
import {
  AccountBook,
  bookPlaceKey,
  readingPage,
  ReadingBook,
  safeBookURL
} from "./books-model";

type LibraryState = {
  owner: string | null;
  books?: AccountBook[];
  error?: string;
  signedOut?: boolean;
};

function BookCover({
  book,
  large = false
}: {
  book: AccountBook;
  large?: boolean;
}) {
  const { colors } = useThemeColors();
  return (
    <View
      style={[
        styles.cover,
        large && styles.largeCover,
        {
          backgroundColor: colors.secondary.background,
          borderColor: colors.primary.border
        }
      ]}
    >
      {book.cover ? (
        <Image
          source={{ uri: book.cover }}
          style={styles.coverImage}
          resizeMode="contain"
          accessibilityLabel={"Cover of " + book.title}
        />
      ) : (
        <>
          <AppIcon
            name="book-open-outline"
            size={large ? 42 : 32}
            color={colors.primary.accent}
          />
          <Text
            numberOfLines={4}
            style={[styles.coverTitle, { color: colors.primary.heading }]}
          >
            {book.title}
          </Text>
          <Text
            numberOfLines={1}
            style={{ color: colors.secondary.paragraph, fontSize: 11 }}
          >
            {book.kind === "builtin" ? "PUBLIC EDITION" : "READING COPY"}
          </Text>
        </>
      )}
    </View>
  );
}

export function BooksHome({ active }: { active: boolean }) {
  const { colors } = useThemeColors();
  const userId = useOhaiAccount((s) => s.userId);
  const [result, setResult] = useState<LibraryState>();
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState<{
    owner: string;
    book: AccountBook;
  }>();
  const state = result?.owner === userId ? result : undefined;
  const current = selection?.owner === userId && active ? selection : undefined;
  useEffect(() => {
    if (!active) return;
    let valid = true;
    setRefreshing(true);
    const owner = userId;
    async function load() {
      if (!owner) {
        await loadOhaiAccount();
        return { owner, signedOut: true };
      }
      const books = await loadAccountBooks(owner);
      return books ? { owner, books } : { owner, signedOut: true };
    }
    void load()
      .then((next) => {
        if (valid) setResult(next);
      })
      .catch((error: unknown) => {
        if (valid)
          setResult((previous) => ({
            owner,
            books: previous?.owner === owner ? previous.books : undefined,
            error:
              error instanceof Error
                ? error.message
                : "Couldn’t load your books."
          }));
      })
      .finally(() => {
        if (valid) setRefreshing(false);
      });
    return () => {
      valid = false;
    };
  }, [active, revision, userId]);
  useEffect(() => {
    setSelection(undefined);
  }, [userId]);
  const reload = () => setRevision((n) => n + 1);

  if (!state)
    return (
      <View style={styles.message}><ScriptureCard />
        <ActivityIndicator
          color={colors.primary.accent}
          accessibilityLabel="Loading your books"
        />
      </View>
    );
  if (state.signedOut)
    return (
      <View style={styles.message}><ScriptureCard />
        <AppIcon
          name="book-open-outline"
          size={36}
          color={colors.primary.accent}
        />
        <Text style={[styles.title, { color: colors.primary.heading }]}>
          Your books, in one place
        </Text>
        <Text
          style={[styles.description, { color: colors.secondary.paragraph }]}
        >
          Sign in with the Google account you use on Heal Earth Club.
        </Text>
        <Pressable
          accessibilityRole="button"
          style={[
            styles.primaryButton,
            { backgroundColor: colors.primary.accent }
          ]}
          onPress={() => Navigation.navigate("Auth", { mode: AuthMode.login })}
        >
          <Text
            style={{
              color: colors.primary.accentForeground,
              fontWeight: "600"
            }}
          >
            Sign in with Google
          </Text>
        </Pressable>
      </View>
    );
  return (
    <>
      <FlatList
        testID="home-books-library"
        data={state.books || []}
        numColumns={2}
        columnWrapperStyle={styles.columns}
        contentContainerStyle={styles.library}
        keyExtractor={(book) => book.id}
        refreshing={refreshing}
        onRefresh={reload}
        ListHeaderComponent={
          <View style={styles.libraryHeader}><ScriptureCard />
            <View style={styles.row}>
              <Text
                style={[
                  styles.title,
                  { color: colors.primary.heading, flex: 1 }
                ]}
              >
                Your reading library
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Refresh books"
                onPress={reload}
                style={styles.iconButton}
              >
                <AppIcon name="refresh" size={22} />
              </Pressable>
            </View>
            {state.error && (
              <View accessibilityRole="alert" style={styles.notice}>
                <Text style={{ color: colors.primary.paragraph }}>
                  {state.error}
                </Text>
                <Pressable
                  onPress={reload}
                  accessibilityRole="button"
                  style={styles.smallAction}
                >
                  <Text style={{ color: colors.primary.accent }}>
                    Try again
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          !refreshing && !state.error ? (
            <View style={styles.message}>
              <AppIcon
                name="book-open-outline"
                size={36}
                color={colors.primary.accent}
              />
              <Text style={[styles.title, { color: colors.primary.heading }]}>
                No synced books yet
              </Text>
              <Text
                style={[
                  styles.description,
                  { color: colors.secondary.paragraph }
                ]}
              >
                Sync a reading copy from your account to start reading.
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={"View " + item.title + " by " + item.author}
            onPress={() =>
              userId && setSelection({ owner: userId, book: item })
            }
            style={styles.bookCard}
            testID={"book-card-" + item.id}
          >
            <BookCover book={item} />
            <Text
              numberOfLines={2}
              style={[styles.bookTitle, { color: colors.primary.heading }]}
            >
              {item.title}
            </Text>
            <Text
              numberOfLines={1}
              style={{ color: colors.secondary.paragraph, fontSize: 13 }}
            >
              {item.author}
            </Text>
            <Text style={{ color: colors.primary.accent, fontSize: 12 }}>
              {item.kind === "external" ? "Read at source" : "Read book"}
            </Text>
          </Pressable>
        )}
      />
      {current && (
        <BookWindow
          key={current.owner + ":" + current.book.id}
          owner={current.owner}
          book={current.book}
          close={() => setSelection(undefined)}
        />
      )}
    </>
  );
}

function BookWindow({
  owner,
  book,
  close
}: {
  owner: string;
  book: AccountBook;
  close: () => void;
}) {
  const { colors } = useThemeColors();
  const insets = useGlobalSafeAreaInsets();
  const currentAccount = useOhaiAccount((s) => s.userId);
  const [reading, setReading] = useState(false);
  const [document, setDocument] = useState<ReadingBook>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!reading || currentAccount !== owner) return;
    let active = true;
    setError(undefined);
    void loadReadingCopy(owner, book)
      .then((copy) => {
        if (active) setDocument(copy);
      })
      .catch((e: unknown) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Could not open your book."
          );
      });
    return () => {
      active = false;
    };
  }, [reading, owner, book, currentAccount, revision]);
  const open = () => {
    if (book.kind !== "external") {
      setReading(true);
      return;
    }
    const url = safeBookURL(book.url);
    if (url)
      void Linking.openURL(url).catch(() =>
        setError("Could not open the source. Try again.")
      );
  };
  if (currentAccount !== owner) return null;
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={close}
    >
      <View
        style={[
          styles.window,
          {
            backgroundColor: colors.primary.background,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            paddingLeft: insets.left,
            paddingRight: insets.right
          }
        ]}
        testID="book-window"
      >
        <View
          style={[styles.toolbar, { borderBottomColor: colors.primary.border }]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={reading ? "Back to book details" : "Close book"}
            onPress={reading ? () => setReading(false) : close}
            style={styles.iconButton}
          >
            <AppIcon name={reading ? "arrow-left" : "close"} size={24} />
          </Pressable>
          <Text
            numberOfLines={1}
            style={[
              styles.bookTitle,
              { flex: 1, color: colors.primary.heading }
            ]}
          >
            {book.title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close book"
            onPress={close}
            style={styles.iconButton}
          >
            <AppIcon name="chevron-down" size={24} />
          </Pressable>
        </View>
        {reading ? (
          document ? (
            <BookReader owner={owner} book={document} />
          ) : (
            <View style={styles.message}>
              {error ? (
                <>
                  <Text
                    accessibilityRole="alert"
                    style={[
                      styles.description,
                      { color: colors.primary.paragraph }
                    ]}
                  >
                    {error}
                  </Text>
                  <Pressable
                    onPress={() => setRevision((n) => n + 1)}
                    style={styles.smallAction}
                    accessibilityRole="button"
                  >
                    <Text style={{ color: colors.primary.accent }}>
                      Try again
                    </Text>
                  </Pressable>
                </>
              ) : (
                <ActivityIndicator
                  accessibilityLabel="Opening your book"
                  color={colors.primary.accent}
                />
              )}
            </View>
          )
        ) : (
          <ScrollView contentContainerStyle={styles.details}>
            <BookCover book={book} large />
            <Text
              accessibilityRole="header"
              style={[styles.detailTitle, { color: colors.primary.heading }]}
            >
              {book.title}
            </Text>
            <Text
              style={[
                styles.description,
                { color: colors.secondary.paragraph }
              ]}
            >
              {book.author}
            </Text>
            {!!book.pageCount && (
              <Text style={{ color: colors.secondary.paragraph }}>
                {book.pageCount} original PDF pages
              </Text>
            )}
            <Text
              style={[styles.description, { color: colors.primary.paragraph }]}
            >
              {book.description}
            </Text>
            {error && (
              <Text
                accessibilityRole="alert"
                style={{ color: colors.primary.paragraph }}
              >
                {error}
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              testID="book-read"
              onPress={open}
              style={[
                styles.primaryButton,
                { backgroundColor: colors.primary.accent }
              ]}
            >
              <Text
                style={{
                  color: colors.primary.accentForeground,
                  fontWeight: "600"
                }}
              >
                {book.kind === "external" ? "Read at source" : "Read book"}
              </Text>
            </Pressable>
            <Text
              style={[
                styles.description,
                { color: colors.secondary.paragraph, fontSize: 12 }
              ]}
            >
              {book.kind === "external"
                ? "The source’s sign-in and borrowing requirements still apply."
                : "Your place is saved on this iPhone. Original PDF files remain in the browser where you imported them."}
            </Text>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function BookReader({ owner, book }: { owner: string; book: ReadingBook }) {
  const { colors } = useThemeColors();
  const key = bookPlaceKey(owner, book.id);
  const [page, setPage] = useState(() =>
    readingPage(MMKV.getInt(key), book.pages.length, book.startPage)
  );
  const [size, setSize] = useState(20);
  const [cream, setCream] = useState(false);
  const [contents, setContents] = useState(false);
  const [marks, setMarks] = useState<number[]>(() => {
    try {
      const value: unknown = JSON.parse(MMKV.getString(key + ":marks") || "[]");
      return Array.isArray(value)
        ? value.filter(
            (n): n is number =>
              typeof n === "number" &&
              Number.isInteger(n) &&
              n >= 0 &&
              n < book.pages.length
          )
        : [];
    } catch {
      return [];
    }
  });
  const scroll = useRef<ScrollView>(null);
  const background = cream ? "#f6f0e2" : colors.primary.background;
  const foreground = cream ? "#29251f" : colors.primary.paragraph;
  const section = book.pages[page];
  const go = (next: number) => {
    const value = readingPage(next, book.pages.length);
    setPage(value);
    MMKV.setInt(key, value);
    setContents(false);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };
  const bookmark = () => {
    const next = marks.includes(page)
      ? marks.filter((p) => p !== page)
      : [...marks, page].sort((a, b) => a - b);
    setMarks(next);
    MMKV.setString(key + ":marks", JSON.stringify(next));
  };
  return (
    <View
      style={[styles.window, { backgroundColor: background }]}
      testID="book-reader"
    >
      <View
        style={[
          styles.readerTools,
          { borderBottomColor: colors.primary.border }
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Contents and bookmarks"
          accessibilityState={{ expanded: contents }}
          style={styles.iconButton}
          onPress={() => setContents((v) => !v)}
        >
          <AppIcon name="format-list-bulleted" size={23} color={foreground} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Decrease text size"
          style={styles.iconButton}
          onPress={() => setSize((n) => Math.max(16, n - 2))}
        >
          <Text style={{ color: foreground, fontSize: 17 }}>A−</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Increase text size"
          style={styles.iconButton}
          onPress={() => setSize((n) => Math.min(32, n + 2))}
        >
          <Text style={{ color: foreground, fontSize: 22 }}>A+</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Toggle cream paper"
          accessibilityState={{ selected: cream }}
          style={styles.iconButton}
          onPress={() => setCream((v) => !v)}
        >
          <AppIcon name="theme-light-dark" size={23} color={foreground} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            marks.includes(page) ? "Remove bookmark" : "Bookmark this page"
          }
          accessibilityState={{ selected: marks.includes(page) }}
          style={styles.iconButton}
          onPress={bookmark}
        >
          <AppIcon
            name={marks.includes(page) ? "bookmark" : "bookmark-outline"}
            size={23}
            color={marks.includes(page) ? colors.primary.accent : foreground}
          />
        </Pressable>
      </View>
      {contents ? (
        <ScrollView contentContainerStyle={styles.contents}>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: foreground }]}
          >
            Contents
          </Text>
          {!!marks.length && (
            <>
              <Text style={{ color: foreground, fontWeight: "600" }}>
                Your bookmarks
              </Text>
              {marks.map((p) => (
                <Pressable
                  key={"mark" + p}
                  style={styles.contentRow}
                  onPress={() => go(p)}
                  accessibilityRole="button"
                >
                  <AppIcon
                    name="bookmark"
                    color={colors.primary.accent}
                    size={18}
                  />
                  <Text style={{ color: foreground }}>
                    {book.pages[p].label}
                  </Text>
                </Pressable>
              ))}
            </>
          )}
          {book.pages.map((p, i) => (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityState={{ selected: i === page }}
              onPress={() => go(i)}
              style={styles.contentRow}
            >
              <Text
                style={{
                  color: i === page ? colors.primary.accent : foreground,
                  flex: 1
                }}
              >
                {p.label}
              </Text>
              <Text style={{ color: foreground }}>{i + 1}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <ScrollView ref={scroll} contentContainerStyle={styles.readingText}>
          <Text
            accessibilityRole="header"
            style={{
              color: foreground,
              fontSize: 14,
              marginBottom: 24,
              fontWeight: "600"
            }}
          >
            {section.label}
          </Text>
          {section.paragraphs.map((paragraph, i) => (
            <Text
              selectable
              key={i}
              style={{
                color: foreground,
                fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
                fontSize: size,
                lineHeight: Math.round(size * 1.65),
                marginBottom: size
              }}
            >
              {paragraph}
            </Text>
          ))}
        </ScrollView>
      )}
      <View
        style={[styles.readerFooter, { borderTopColor: colors.primary.border }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous page"
          disabled={page === 0}
          onPress={() => go(page - 1)}
          style={[styles.iconButton, page === 0 && { opacity: 0.3 }]}
        >
          <AppIcon name="chevron-left" size={27} color={foreground} />
        </Pressable>
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: foreground, textAlign: "center", flex: 1 }}
        >
          {page + 1} / {book.pages.length} ·{" "}
          {Math.round(((page + 1) / book.pages.length) * 100)}%
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next page"
          disabled={page === book.pages.length - 1}
          onPress={() => go(page + 1)}
          style={[
            styles.iconButton,
            page === book.pages.length - 1 && { opacity: 0.3 }
          ]}
        >
          <AppIcon name="chevron-right" size={27} color={foreground} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  window: { flex: 1 },
  library: { padding: 16, paddingBottom: 32, flexGrow: 1 },
  columns: { gap: 16 },
  libraryHeader: { gap: 12, marginBottom: 20 },
  row: { flexDirection: "row", alignItems: "center" },
  notice: { gap: 4, padding: 12 },
  message: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 14
  },
  title: { fontSize: 19, fontWeight: "600" },
  description: { fontSize: 15, lineHeight: 23, textAlign: "center" },
  bookCard: { flex: 1, maxWidth: "50%", gap: 5, marginBottom: 24 },
  cover: {
    width: "100%",
    aspectRatio: 0.72,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    alignItems: "center",
    justifyContent: "space-around",
    overflow: "hidden"
  },
  largeCover: { width: 170, height: 235, aspectRatio: undefined },
  coverImage: { width: "100%", height: "100%" },
  coverTitle: {
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    fontSize: 17,
    textAlign: "center"
  },
  bookTitle: { fontSize: 16, fontWeight: "600", marginTop: 5 },
  primaryButton: {
    minHeight: 48,
    borderRadius: 24,
    paddingHorizontal: 28,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center"
  },
  smallAction: { paddingVertical: 12 },
  iconButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center"
  },
  toolbar: {
    minHeight: 52,
    paddingHorizontal: 6,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  details: { padding: 24, alignItems: "center", gap: 16, paddingBottom: 40 },
  detailTitle: { fontSize: 25, fontWeight: "600", textAlign: "center" },
  readerTools: {
    flexDirection: "row",
    justifyContent: "space-around",
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  readingText: { padding: 24, paddingBottom: 40 },
  readerFooter: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    minHeight: 52,
    borderTopWidth: StyleSheet.hairlineWidth
  },
  contents: { padding: 20, gap: 8 },
  contentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    paddingVertical: 10
  }
});
