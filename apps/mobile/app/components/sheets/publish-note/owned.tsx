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

import React, { useEffect, useState } from "react";
import { ActivityIndicator, Switch, TextInput, View } from "react-native";
import type { Note } from "@notesnook/core";
import { useThemeColors } from "@notesnook/theme";
import Clipboard from "@react-native-clipboard/clipboard";
import {
  useOhaiAccount,
  loadOhaiAccount,
  continueWithGoogle
} from "../../../features/login/google-session";
import {
  readOwnedPublication,
  ownedCapabilities,
  refreshOwnedPublication,
  publishOwnedNote,
  unpublishOwnedNote,
  ownedShareLink,
  type OwnedPublication,
  type PublishingCapabilities
} from "../../../features/publishing/owned-publications";
import { db } from "../../../common/database";
import { openLinkInBrowser } from "../../../utils/functions";
import Paragraph from "../../ui/typography/paragraph";
import Heading from "../../ui/typography/heading";
import { Button } from "../../ui/button";
export default function OwnedPublishNoteSheet({
  note,
  onLegacy
}: {
  note: Note;
  onLegacy: () => void;
}) {
  const { colors } = useThemeColors(),
    owner = useOhaiAccount((s) => s.userId),
    email = useOhaiAccount((s) => s.email);
  const [title, setTitle] = useState(note.title || ""),
    [listed, setListed] = useState(false),
    [state, setState] = useState<OwnedPublication>(),
    [caps, setCaps] = useState<PublishingCapabilities>(),
    [busy, setBusy] = useState(false),
    [checkingAccount, setCheckingAccount] = useState(true),
    [message, setMessage] = useState(""),
    [legacy, setLegacy] = useState(false);
  useEffect(() => {
    let active = true;
    void loadOhaiAccount()
      .catch(() => {
        if (active)
          setMessage(
            "Could not restore your account. Unlock the device and retry."
          );
      })
      .finally(() => {
        if (active) setCheckingAccount(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setState(undefined);
    setCaps(undefined);
    setMessage("");
    setListed(false);
    void (async () => {
      setLegacy(!!db.monographs.isPublished(note.id));
      if (!owner) return;
      const apply = (p: OwnedPublication | undefined) => {
        if (!active) return;
        setState(p);
        setListed(p?.listedPreference || false);
        if (p?.title) setTitle(p.title);
      };
      const report = (e: unknown) => {
        if (active) setMessage((e as Error).message);
      };
      try {
        apply(await readOwnedPublication(owner, note.id));
      } catch (e) {
        report(e);
      }
      if (!active) return;
      await Promise.all([
        ownedCapabilities(owner)
          .then((c) => {
            if (active) setCaps(c);
          })
          .catch(report),
        refreshOwnedPublication(owner, note.id).then(apply).catch(report)
      ]);
    })();
    return () => {
      active = false;
    };
  }, [owner, note.id]);
  async function run(action: () => Promise<OwnedPublication>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    const selected = owner;
    try {
      const p = await action();
      if (useOhaiAccount.getState().userId !== selected) return;
      setState(p);
      setMessage(
        p.publicationState === "unpublish_pending"
          ? "The public link is disabled. Retry removal to finish file cleanup."
          : p.publicationState === "unpublished"
          ? "This edition is no longer published."
          : "Your published edition is ready."
      );
    } catch (e) {
      if (selected && useOhaiAccount.getState().userId === selected) {
        setState(await readOwnedPublication(selected, note.id));
        setMessage((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }
  const pending = state?.publicationState === "unpublish_pending",
    link = ownedShareLink(state, caps);
  return (
    <View style={{ padding: 20, gap: 14 }}>
      <Heading>Publish with Heal Earth</Heading>
      <Paragraph>
        Your private original stays in Notes. This first release creates a
        public, revocable edition.
      </Paragraph>
      {checkingAccount ? (
        <ActivityIndicator
          accessibilityLabel="Checking saved account"
          color={colors.primary.accent}
        />
      ) : owner ? (
        <>
          <Paragraph>{email || "Your Heal Earth account"}</Paragraph>
          <TextInput
            accessibilityLabel="Publication title"
            value={title}
            maxLength={240}
            onChangeText={setTitle}
            editable={!busy && !pending}
            style={{
              color: colors.primary.paragraph,
              borderColor: colors.secondary.border,
              borderWidth: 1,
              borderRadius: 12,
              padding: 12
            }}
          />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between"
            }}
          >
            <Paragraph style={{ flex: 1 }}>
              List on my public author profile
            </Paragraph>
            <Switch
              accessibilityLabel="List on my public author profile"
              value={listed}
              onValueChange={setListed}
              disabled={busy || pending}
            />
          </View>
          <Paragraph>
            Anyone with the link can read this edition. Your author address
            stays fixed after your first publication.
          </Paragraph>
          {busy ? <ActivityIndicator color={colors.primary.accent} /> : null}
          <Button
            title={
              state?.publicationState === "published"
                ? "Update published edition"
                : state?.publicationState === "publishing"
                ? "Retry publication"
                : "Publish edition"
            }
            type="accent"
            disabled={
              busy ||
              pending ||
              (state?.restricted && state.publicationState !== "unpublished") ||
              !caps?.publishingEnabled
            }
            onPress={() =>
              void run(() => publishOwnedNote(owner, note.id, title, listed))
            }
          />
          {state && state.publicationState !== "unpublished" ? (
            <Button
              title={pending ? "Retry removal" : "Unpublish edition"}
              type="error"
              disabled={busy}
              onPress={() => void run(() => unpublishOwnedNote(owner, note.id))}
            />
          ) : null}
          {link ? (
            <>
              <Button
                title="Open published note"
                onPress={() => void openLinkInBrowser(link)}
              />
              <Button
                title="Copy link"
                onPress={() => {
                  Clipboard.setString(link);
                  setMessage("Publication link copied.");
                }}
              />
            </>
          ) : null}
          {!caps?.publishingEnabled && caps ? (
            <Paragraph>
              Publishing is not available for this account yet. Existing
              editions can still be withdrawn.
            </Paragraph>
          ) : null}
          {state?.restricted ? (
            <Paragraph>
              Manage this edition’s access controls in its original client, or
              unpublish it here.
            </Paragraph>
          ) : null}
          {message ? (
            <Paragraph accessibilityRole="alert">{message}</Paragraph>
          ) : null}
          {legacy ? (
            <>
              <Paragraph>
                A previous Notesnook share exists. It is separate and will not
                be replaced or deleted by publishing here.
              </Paragraph>
              <Button title="Manage previous publication" onPress={onLegacy} />
            </>
          ) : null}
          <Button
            title="Refresh publication status"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                const p = await refreshOwnedPublication(owner, note.id);
                if (!p)
                  throw new Error(
                    "This note has no Heal Earth publication yet."
                  );
                return p;
              })
            }
          />
        </>
      ) : (
        <>
          <Paragraph>
            Sign in to your Heal Earth account before publishing publicly.
          </Paragraph>
          <Button
            title="Continue with Google"
            type="accent"
            onPress={() => {
              void continueWithGoogle().catch((e) => setMessage(e.message));
            }}
          />
          {message ? <Paragraph>{message}</Paragraph> : null}
          {legacy ? (
            <Button title="Manage previous publication" onPress={onLegacy} />
          ) : null}
        </>
      )}
    </View>
  );
}
