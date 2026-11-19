export type AccountBook = {
  id: string;
  title: string;
  author: string;
  description: string;
  kind: "reader" | "builtin" | "external";
  pageCount?: number;
  url?: string;
  cover?: string;
};
export type ReadingBook = {
  id: string;
  title: string;
  author: string;
  pages: { label: string; pdfPage: number; paragraphs: string[] }[];
  pageCount: number;
  startPage?: number;
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;
export function safeBookURL(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password)
      return url.href;
  } catch {
    /* A malformed link is never opened. */
  }
}
export function decodeBookLibrary(value: unknown): AccountBook[] {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.books) ||
    value.books.length > 2000
  )
    throw new Error("The book library returned an invalid response.");
  const ids = new Set<string>();
  return value.books.map((b: unknown) => {
    if (
      !object(b) ||
      !text(b.id, 120) ||
      !/^[\w-]+$/.test(b.id) ||
      ids.has(b.id) ||
      !text(b.title, 180) ||
      !b.title.trim() ||
      !text(b.author, 120) ||
      !text(b.description, 1000) ||
      !["reader", "builtin", "external"].includes(String(b.kind)) ||
      (b.pageCount !== undefined &&
        (!Number.isInteger(b.pageCount) ||
          Number(b.pageCount) < 1 ||
          Number(b.pageCount) > 500)) ||
      (b.kind === "external" && !safeBookURL(b.url)) ||
      (b.kind === "builtin" && b.id !== "george-washington-journal")
    )
      throw new Error("The book library returned an invalid book.");
    ids.add(b.id);
    return {
      id: b.id,
      title: b.title,
      author: b.author,
      description: b.description,
      kind: b.kind as AccountBook["kind"],
      pageCount: b.pageCount as number | undefined,
      url: safeBookURL(b.url),
      cover:
        typeof b.cover === "string" && /^\/books\/[\w-]+\.jpg$/.test(b.cover)
          ? "https://healearth.club" + b.cover
          : safeBookURL(b.cover)
    };
  });
}
export function decodeReadingBook(
  value: unknown,
  expectedId: string
): ReadingBook {
  if (
    !object(value) ||
    value.id !== expectedId ||
    !text(value.title, 180) ||
    !text(value.author, 120) ||
    !Number.isInteger(value.pageCount) ||
    Number(value.pageCount) < 1 ||
    Number(value.pageCount) > 500 ||
    !Array.isArray(value.pages) ||
    !value.pages.length ||
    value.pages.length > 1000
  )
    throw new Error("This reading copy is invalid or unavailable.");
  let characters = 0;
  const pages = value.pages.map((page: unknown) => {
    if (
      !object(page) ||
      !text(page.label, 120) ||
      !Number.isInteger(page.pdfPage) ||
      Number(page.pdfPage) < 1 ||
      Number(page.pdfPage) > Number(value.pageCount) ||
      !Array.isArray(page.paragraphs) ||
      !page.paragraphs.length ||
      page.paragraphs.length > 2000 ||
      !page.paragraphs.every(
        (p: unknown) => text(p, 50_000) && p.trim().length > 0
      )
    )
      throw new Error("This book contains invalid pages.");
    const paragraphs = page.paragraphs as string[];
    characters += paragraphs.reduce((sum, p) => sum + p.length, 0);
    if (characters > 1_000_000)
      throw new Error("This reading copy is too large.");
    return { label: page.label, pdfPage: Number(page.pdfPage), paragraphs };
  });
  return {
    id: expectedId,
    title: value.title,
    author: value.author,
    pageCount: Number(value.pageCount),
    pages,
    startPage: Number.isInteger(value.startPage)
      ? Math.max(0, Math.min(pages.length - 1, Number(value.startPage)))
      : 0
  };
}
export function readingPage(value: unknown, count: number, fallback = 0) {
  return Math.max(
    0,
    Math.min(
      Math.max(0, count - 1),
      typeof value === "number" && Number.isInteger(value) ? value : fallback
    )
  );
}
export function bookPlaceKey(userId: string, bookId: string) {
  return "ohai.books.place:" + JSON.stringify([userId, bookId]);
}
