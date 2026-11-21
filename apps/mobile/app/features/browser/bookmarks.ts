import { db } from "../../common/database";

function escapeBookmarkUrl(url: string) {
  return url
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export function bookmarkContent(url: string) {
  const escaped = escapeBookmarkUrl(url);
  return `<p><a href="${escaped}">${escaped}</a></p>`;
}

export async function isBookmarked(url: string) {
  const bookmark = await db
    .sql()
    .selectFrom("content")
    .innerJoin("notes", "notes.contentId", "content.id")
    .innerJoin("relations", "relations.toId", "notes.id")
    .innerJoin("notebooks", "notebooks.id", "relations.fromId")
    .where((eb) =>
      eb(
        eb.fn<number>("instr", [
          "content.data",
          eb.val(` href="${escapeBookmarkUrl(url)}"`)
        ]),
        ">",
        0
      )
    )
    .where("notes.type", "=", "note")
    .where("notes.deleted", "is not", true)
    .where("relations.fromType", "=", "notebook")
    .where("relations.toType", "=", "note")
    .where("notebooks.type", "=", "notebook")
    .where("notebooks.deleted", "is not", true)
    .select("notes.id")
    .executeTakeFirst();

  return !!bookmark;
}
