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
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import type { EditorView as EditorViewType } from "prosemirror-view";

let EditorView: typeof EditorViewType;
let view: EditorViewType | undefined;

beforeAll(async () => {
  // ProseMirror detects the browser once when its view module loads.
  Object.defineProperty(navigator, "userAgent", {
    value:
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
    configurable: true
  });
  vi.resetModules();
  ({ EditorView } = await import("prosemirror-view"));
});

afterEach(() => {
  view?.destroy();
  view = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
});

function editor(selected = false) {
  vi.useFakeTimers();
  const schema = new Schema({
    nodes: {
      doc: { content: "paragraph+" },
      paragraph: { content: "text*", toDOM: () => ["p", 0] },
      text: {}
    }
  });
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, schema.text("note"))
  ]);
  const handleKeyDown = vi.fn(() => true);
  view = new EditorView(document.body, {
    state: EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1, selected ? 3 : 1)
    }),
    handleKeyDown
  });
  view.dom.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      keyCode: 13,
      bubbles: true,
      cancelable: true
    })
  );
  return handleKeyDown;
}

test("Android Enter without a DOM mutation invokes the fallback once", () => {
  const handler = editor();
  expect(handler).not.toHaveBeenCalled();
  vi.advanceTimersByTime(250);
  expect(handler).toHaveBeenCalledTimes(1);
});

test("a handled Enter with selected text does not dispatch again later", () => {
  const handler = editor(true);
  expect(handler).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(250);
  expect(handler).toHaveBeenCalledTimes(1);
});

test("destroying the editor cancels pending Android Enter", () => {
  const handler = editor();
  view?.destroy();
  view = undefined;
  vi.advanceTimersByTime(250);
  expect(handler).not.toHaveBeenCalled();
});
