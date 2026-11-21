import { requestOhaiBooks } from "../login/google-session";
import {
  AccountBook,
  decodeBookLibrary,
  decodeReadingBook
} from "./books-model";
export async function loadAccountBooks(userId: string) {
  const body = await requestOhaiBooks(userId);
  return body === null ? null : decodeBookLibrary(body);
}
export async function loadReadingCopy(userId: string, book: AccountBook) {
  if (book.kind === "external")
    throw new Error("This book is read at its source.");
  if (book.kind === "builtin") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      // Public edition only. Never send an account credential to a book/source URL.
      const response = await fetch(
        "https://healearth.club/books/george-washington-journal.json",
        {
          signal: controller.signal,
          credentials: "omit",
          redirect: "error"
        }
      );
      if (!response.ok) throw new Error("Could not open this book. Try again.");
      const raw = await response.text();
      if (raw.length > 1_100_000)
        throw new Error("This reading copy is too large.");
      const body = JSON.parse(raw);
      return decodeReadingBook(
        { ...book, pages: body.pages, startPage: 5 },
        book.id
      );
    } finally {
      clearTimeout(timer);
    }
  }
  const body = await requestOhaiBooks(userId, book.id);
  if (!body) throw new Error("Sign in again to open your book.");
  return decodeReadingBook((body as { book?: unknown }).book, book.id);
}
