/// <reference types="bun-types" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { spyOn } from "bun:test";
import { runUndoEntry } from "../src/components/opennote/use-note-undo";
import { jsonFetch, RequestError } from "../src/lib/note-request";
import { useNoteUndoStore } from "../src/store/note-undo-store";

test("drops only terminal undo errors and allows the previous action", async () => {
  const history = useNoteUndoStore.getState();
  history.clear();
  let restored = false;
  const previous = { id: "previous", label: "Ghim", undo: async () => { restored = true; } };
  const current = {
    id: "current", label: "Di chuyển",
    undo: async () => { throw new RequestError("Thư mục đã mất", 409, "FOLDER_NOT_FOUND"); },
  };
  const notifications: { title?: unknown; action?: unknown }[] = [];
  const toast = (notification: (typeof notifications)[number]) => {
    notifications.push(notification);
    return { id: "toast", dismiss: () => {}, update: () => {} };
  };
  try {
    history.push(previous);
    history.push(current);
    await runUndoEntry(current, toast, () => {});
    assert.equal(history.latest()?.id, previous.id);
    assert.equal(notifications[0]?.action, undefined);
    assert.equal(restored, false);

    const temporary = {
      id: "temporary", label: "Thao tác thử lại",
      undo: async () => { throw new RequestError("Xung đột tạm thời", 409); },
    };
    history.push(temporary);
    await runUndoEntry(temporary, toast, () => {});
    assert.equal(history.latest()?.id, temporary.id);
    assert.ok(notifications.at(-1)?.action);

    const expired = { id: "expired", label: "Thùng rác", undo: async () => { throw new RequestError("Hết hạn", 410); } };
    history.push(expired);
    await runUndoEntry(expired, toast, () => {});
    assert.equal(history.latest()?.id, temporary.id);
    assert.equal(notifications.at(-1)?.action, undefined);

    history.remove(temporary.id);
    await runUndoEntry(previous, toast, () => {});
    assert.equal(restored, true);
    assert.equal(history.latest(), null);
  } finally {
    history.clear();
  }
});

test("preserves the structured API error code through jsonFetch", async () => {
  const request = spyOn(globalThis, "fetch").mockResolvedValue(Response.json(
    { error: "Thư mục đích không còn tồn tại", code: "FOLDER_NOT_FOUND" }, { status: 409 },
  ));
  try {
    await assert.rejects(jsonFetch("/api/notes/test"), { status: 409, code: "FOLDER_NOT_FOUND" });
  } finally {
    request.mockRestore();
  }
});
