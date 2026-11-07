"use client";

import { create } from "zustand";
import type { NoteDetail } from "@/lib/opennote-types";
import { fetchNote, jsonFetch, noteHeaders, RequestError } from "@/lib/note-request";

type Body = Pick<NoteDetail, "title" | "content" | "plainText">;
type Base = Pick<NoteDetail, "revision" | "deletedAt" | "locked">;
type Draft = {
  body: Body;
  base: Base;
  status: "dirty" | "saving" | "error" | "conflict";
  error?: string;
};

export const useNoteDrafts = create<{
  drafts: Record<string, Draft | undefined>;
  committed: Record<string, Base | undefined>;
  paused: boolean;
}>(() => ({ drafts: {}, committed: {}, paused: false }));

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const writes = new Map<string, Promise<void>>();

function setDraft(id: string, draft?: Draft) {
  useNoteDrafts.setState((s) => {
    const drafts = { ...s.drafts };
    if (draft) drafts[id] = draft;
    else delete drafts[id];
    return { drafts };
  });
}

function clearTimer(id: string) {
  clearTimeout(timers.get(id));
  timers.delete(id);
}

export function stageNoteDraft(id: string, body: Body, base: Base) {
  const state = useNoteDrafts.getState();
  if (state.paused || !base.revision) return;
  const previous = state.drafts[id];
  setDraft(id, {
    body,
    base: previous?.base ?? base,
    status: previous?.status === "conflict" ? "conflict" : "dirty",
    error: previous?.status === "conflict" ? previous.error : undefined,
  });
  clearTimer(id);
  if (previous?.status === "conflict") return;
  timers.set(id, setTimeout(() => void flushNoteDraft(id).catch(() => {}), 700));
}

async function save(id: string, draft: Draft) {
  const request = () => jsonFetch<NoteDetail>(`/api/notes/${id}`, {
    method: "PATCH",
    headers: noteHeaders(id),
    body: JSON.stringify({
      ...draft.body,
      baseRevision: draft.base.revision,
      baseLocked: draft.base.locked,
      baseDeletedAt: draft.base.deletedAt,
    }),
  });
  try {
    return await request();
  } catch (error) {
    if (error instanceof RequestError && error.status >= 400 && error.status < 500) throw error;
    // A failed response can follow a successful commit. Replay the exact
    // conditional write; the server acknowledges matching data without writing again.
    return request();
  }
}

export function flushNoteDraft(id: string): Promise<void> {
  clearTimer(id);
  const existing = writes.get(id);
  if (existing) return existing;

  const pending = (async () => {
    for (;;) {
      const draft = useNoteDrafts.getState().drafts[id];
      if (!draft) return;
      if (draft.status === "conflict") throw new Error(draft.error);
      setDraft(id, { ...draft, status: "saving" });
      try {
        const note = await save(id, draft);
        const base = { revision: note.revision, deletedAt: note.deletedAt, locked: note.locked };
        useNoteDrafts.setState((s) => ({ committed: { ...s.committed, [id]: base } }));
        const latest = useNoteDrafts.getState().drafts[id];
        if (!latest || latest.body === draft.body) {
          setDraft(id);
          return;
        }
        setDraft(id, { ...latest, base, status: "dirty" });
      } catch (error) {
        const latest = useNoteDrafts.getState().drafts[id];
        if (latest) setDraft(id, {
          ...latest,
          status: error instanceof RequestError && [404, 409].includes(error.status) ? "conflict" : "error",
          error: error instanceof Error ? error.message : "Không lưu được ghi chú",
        });
        throw error;
      }
    }
  })().finally(() => writes.delete(id));
  writes.set(id, pending);
  return pending;
}

export function forgetCommittedNote(id: string) {
  useNoteDrafts.setState((s) => {
    const committed = { ...s.committed };
    delete committed[id];
    return { committed };
  });
}

export async function loadAfterDiscard(id: string) {
  const fresh = await fetchNote(id).catch((error: unknown) => {
    if (error instanceof RequestError && error.status === 404) return null;
    throw error;
  });
  clearTimer(id);
  setDraft(id);
  forgetCommittedNote(id);
  return fresh;
}

export async function withSavedDrafts<T>(operation: () => Promise<T>, ids?: string[]): Promise<T> {
  if (useNoteDrafts.getState().paused) throw new Error("Đang xử lý thao tác khác");
  useNoteDrafts.setState({ paused: true });
  try {
    await Promise.all((ids ?? Object.keys(useNoteDrafts.getState().drafts)).map(flushNoteDraft));
    return await operation();
  } finally {
    useNoteDrafts.setState({ paused: false });
  }
}

let openEditor: { id: string; refresh: () => Promise<boolean> } | undefined;

export function registerOpenNoteRefresh(id: string, refresh: () => Promise<boolean>) {
  const registration = { id, refresh };
  openEditor = registration;
  return () => {
    if (openEditor === registration) openEditor = undefined;
  };
}

export async function refreshOpenEditor(id?: string) {
  return openEditor && (!id || openEditor.id === id) ? openEditor.refresh() : true;
}
