/*
This file is part of the Notesnook project (https://notesnook.com/)

Copyright (C) 2023 Streetwriters (Private) Limited

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

import { isDeleted } from "@notesnook/core";
import * as Keychain from "react-native-keychain";
import { db } from "../../common/database";
import { requestOhaiPublishing, useOhaiAccount } from "../login/google-session";
import { isHealEarthAccountId } from "../login/account-identity";
import { fluidTabsRef } from "../../utils/global-refs";
export type OwnedPublication = {
  id: string;
  accountId: string;
  title: string;
  publicationId?: string;
  publicationState: string;
  aliasState: string;
  shareUrl?: string;
  publishUrl?: string;
  listedPreference: boolean;
  retryable: boolean;
  revision?: number;
  brandedLinksEnabled: boolean;
  restricted?: boolean;
};
export type PublishingCapabilities = {
  contractVersion: 1;
  publishingEnabled: boolean;
  brandedLinksEnabled: boolean;
  archiveEnabled: boolean;
  viewerOrigin: string;
  accountId: string;
};
export const viewerOrigin =
  "https://pinterest-google-clone.trubucla.workers.dev";
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Unexpected publishing response.");
  return v as Record<string, unknown>;
};
const current = (owner: string) => {
  if (useOhaiAccount.getState().userId !== owner)
    throw new Error("Your selected account changed. Reopen publishing.");
};
const service = (owner: string, noteId: string) => {
  if (!isHealEarthAccountId(owner) || !/^[-\w]{1,128}$/.test(noteId))
    throw new Error("Invalid publication identity.");
  return {
    service:
      "org.healearth.ohai.publication." +
      encodeURIComponent(owner) +
      "." +
      noteId,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  };
};
export function validOwnedLink(
  value: unknown,
  branded = false
): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.hash &&
      !u.search &&
      (branded
        ? u.origin === "https://healearth.club" &&
          /^\/@[-\w]{1,40}\/p\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(u.pathname)
        : u.origin === viewerOrigin &&
          /^\/monograph\/[a-f0-9-]{36}$/.test(u.pathname))
    );
  } catch {
    return false;
  }
}
export function parseOwnedPublication(
  raw: unknown,
  owner: string,
  noteId: string,
  cached?: OwnedPublication
): OwnedPublication {
  const v = record(raw);
  if (
    v.id !== noteId ||
    !["publishing", "published", "unpublish_pending", "unpublished"].includes(
      String(v.publicationState)
    ) ||
    !["pending", "ready", "disabled"].includes(String(v.aliasState))
  )
    throw new Error("Unexpected publication state.");
  if (
    v.publicationId !== undefined &&
    (typeof v.publicationId !== "string" ||
      !/^[-a-f0-9]{36}$/.test(v.publicationId))
  )
    throw new Error("Unexpected publication identity.");
  return {
    id: noteId,
    accountId: owner,
    title: typeof v.title === "string" ? v.title : cached?.title || "",
    publicationId:
      typeof v.publicationId === "string"
        ? v.publicationId
        : cached?.publicationId,
    publicationState: String(v.publicationState),
    aliasState: String(v.aliasState),
    publishUrl: validOwnedLink(v.publishUrl)
      ? v.publishUrl
      : cached?.publishUrl,
    shareUrl:
      v.publicationState === "published" &&
      v.aliasState === "ready" &&
      v.shareUrlState === "ready" &&
      validOwnedLink(v.shareUrl, true)
        ? v.shareUrl
        : cached?.shareUrl,
    listedPreference:
      typeof v.listedPreference === "boolean"
        ? v.listedPreference
        : cached?.listedPreference || false,
    retryable: v.retryable === true,
    revision: typeof v.revision === "number" ? v.revision : cached?.revision,
    brandedLinksEnabled: v.brandedLinksEnabled === true,
    restricted:
      v.restricted === true ||
      v.passwordProtected === true ||
      v.hasFragment === true ||
      v.selfDestruct === true ||
      ![v.passwordProtected, v.hasFragment, v.selfDestruct].every(
        (flag) => typeof flag === "boolean"
      )
  };
}
export async function readOwnedPublication(
  owner: string,
  noteId: string
): Promise<OwnedPublication | undefined> {
  current(owner);
  const entry = await Keychain.getGenericPassword(service(owner, noteId));
  current(owner);
  if (!entry) return;
  try {
    const v = record(JSON.parse(entry.password));
    if (v.accountId !== owner || v.id !== noteId) return;
    return parseOwnedPublication(
      {
        ...v,
        shareUrlState: "ready",
        passwordProtected: v.restricted !== false,
        hasFragment: v.restricted !== false,
        selfDestruct: v.restricted !== false
      },
      owner,
      noteId
    );
  } catch {
    return;
  }
}
async function saveOwnedPublication(p: OwnedPublication) {
  current(p.accountId);
  const saved = await Keychain.setGenericPassword(
    "publication",
    JSON.stringify(p),
    service(p.accountId, p.id)
  );
  current(p.accountId);
  if (!saved)
    throw new Error(
      "Could not save publication status on this device. Reopen publishing to refresh it."
    );
  return p;
}
export async function ownedCapabilities(
  owner: string
): Promise<PublishingCapabilities> {
  current(owner);
  const v = record(await requestOhaiPublishing(owner, "capabilities"));
  current(owner);
  if (
    v.accountId !== owner ||
    v.contractVersion !== 1 ||
    typeof v.publishingEnabled !== "boolean" ||
    typeof v.brandedLinksEnabled !== "boolean" ||
    v.viewerOrigin !== viewerOrigin
  )
    throw new Error("Unexpected publishing capabilities.");
  return {
    contractVersion: 1,
    accountId: owner,
    publishingEnabled: v.publishingEnabled,
    brandedLinksEnabled: v.brandedLinksEnabled,
    archiveEnabled: v.archiveEnabled === true,
    viewerOrigin
  };
}
export async function refreshOwnedPublication(owner: string, noteId: string) {
  const cached = await readOwnedPublication(owner, noteId);
  try {
    const raw = await requestOhaiPublishing(owner, noteId + "/metadata");
    current(owner);
    return await saveOwnedPublication(
      parseOwnedPublication(raw, owner, noteId, cached)
    );
  } catch (e) {
    if ((e as { status?: number }).status === 404) return cached;
    throw e;
  }
}
export function ownedShareLink(
  p: OwnedPublication | undefined,
  c: PublishingCapabilities | undefined
) {
  if (
    !p ||
    p.publicationState !== "published" ||
    p.aliasState !== "ready" ||
    p.restricted
  )
    return "";
  if (
    c?.contractVersion === 1 &&
    c.accountId === p.accountId &&
    c.publishingEnabled &&
    c.brandedLinksEnabled &&
    p.brandedLinksEnabled &&
    validOwnedLink(p.shareUrl, true)
  )
    return p.shareUrl;
  return validOwnedLink(p.publishUrl) ? p.publishUrl : "";
}
export async function publishOwnedNote(
  owner: string,
  noteId: string,
  title: string,
  listed: boolean
) {
  current(owner);
  if (!title.trim() || title.length > 240)
    throw new Error("Use a title up to 240 characters.");
  const capabilities = await ownedCapabilities(owner);
  if (!capabilities.publishingEnabled)
    throw new Error("Publishing is not available for this account yet.");
  const remote = await refreshOwnedPublication(owner, noteId);
  if (remote?.restricted && remote.publicationState !== "unpublished")
    throw new Error(
      "Manage this edition’s access controls in its original client, or unpublish it here."
    );
  if (fluidTabsRef.current?.page() === "editor")
    throw new Error("Save this note and return to Notes before publishing.");
  const note = await db.notes.note(noteId);
  if (!note?.contentId || isDeleted(note) || (await db.vaults.itemExists(note)))
    throw new Error("Unlock and save the note before publishing.");
  const item = await db.content.get(note.contentId);
  if (!item || item.locked || isDeleted(item))
    throw new Error("Save and unlock this note before publishing.");
  const content = await db.content.downloadMedia(
    "monograph-" + noteId,
    item,
    false
  );
  current(owner);
  const latest = await db.notes.note(noteId);
  const latestContent = latest?.contentId
    ? await db.content.get(latest.contentId)
    : undefined;
  if (
    !latest ||
    latest.contentId !== note.contentId ||
    latest.dateModified !== note.dateModified ||
    latestContent?.dateModified !== item.dateModified
  )
    throw new Error("The note changed while preparing it. Save and retry.");
  const payload = {
    id: noteId,
    title,
    expectedRevision: remote?.revision || 0,
    content: JSON.stringify({ type: content.type, data: content.data }),
    selfDestruct: false,
    hasFragment: false,
    listed,
    retention: "revocable"
  };
  const encoded = JSON.stringify(payload);
  let byteLength = 0;
  for (const char of encoded) {
    const point = char.codePointAt(0) || 0;
    byteLength += point > 0xffff ? 4 : point > 0x7ff ? 3 : point > 0x7f ? 2 : 1;
    if (byteLength > 4 * 1024 * 1024) break;
  }
  if (byteLength > 4 * 1024 * 1024)
    throw new Error(
      "This published edition exceeds 4 MiB. Remove large attachments and retry."
    );
  const cached = await readOwnedPublication(owner, noteId);
  const pending: OwnedPublication = {
    ...cached,
    id: noteId,
    accountId: owner,
    title,
    listedPreference: listed,
    publicationState: "publishing",
    aliasState: "pending",
    retryable: true,
    restricted: false,
    brandedLinksEnabled: false
  };
  await saveOwnedPublication(pending);
  const raw = await requestOhaiPublishing(owner, "v2", "POST", payload);
  current(owner);
  return saveOwnedPublication(
    parseOwnedPublication(raw, owner, noteId, pending)
  );
}
export async function unpublishOwnedNote(owner: string, noteId: string) {
  const cached = await readOwnedPublication(owner, noteId);
  const raw = await requestOhaiPublishing(owner, noteId, "DELETE");
  current(owner);
  const v = record(raw);
  if (
    v.id === undefined &&
    v.ok === true &&
    v.publicationState === "unpublished"
  )
    v.id = noteId;
  const p = parseOwnedPublication(v, owner, noteId, cached);
  return saveOwnedPublication(p);
}
