"use client";

import { useCallback } from "react";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { jsonFetch, RequestError } from "@/lib/note-request";
import { forgetCommittedNote, withSavedDrafts } from "@/store/note-drafts";
import { useInvalidateNotes } from "./hooks";
import { useOpenNoteStore } from "@/store/opennote-store";
import {
  makeUndoId,
  useNoteUndoStore,
  type NoteUndoEntry,
} from "@/store/note-undo-store";

let undoInFlight = false;

type ToastFn = ReturnType<typeof useToast>["toast"];

/** Thực thi một mục hoàn tác (dùng chung cho nút "Hoàn tác" và Ctrl+Z). */
export async function runUndoEntry(
  entry: NoteUndoEntry,
  toast: ToastFn,
  selectNote: (id: string | null) => void
) {
  const history = useNoteUndoStore.getState();
  if (undoInFlight || !history.entries.some((item) => item.id === entry.id)) return;
  undoInFlight = true;
  try {
    await entry.undo();
    history.remove(entry.id);
    if (entry.selectBack) selectNote(entry.selectBack);
    toast({
      title: "Đã hoàn tác",
      description: entry.label,
      duration: 2500,
    });
  } catch (error) {
    const expired = error instanceof RequestError && error.status === 410;
    if (expired) history.remove(entry.id);
    toast({
      title: "Không hoàn tác được hành động này",
      description: error instanceof Error ? error.message : "Vui lòng thử lại.",
      action: expired ? undefined : (
        <ToastAction altText="Thử lại hoàn tác" onClick={() => void runUndoEntry(entry, toast, selectNote)}>
          Thử lại
        </ToastAction>
      ),
      variant: "destructive",
      duration: 3000,
    });
  } finally {
    undoInFlight = false;
  }
}

/**
 * Chạy một hành động cấp ghi chú rồi hiển thị toast có nút "Hoàn tác".
 * Hành động được ghi vào lịch sử hoàn tác (hoàn tác được thêm bằng Ctrl+Z
 * khi không đang soạn thảo văn bản).
 */
export function useRunWithUndo() {
  const { toast } = useToast();
  const selectNote = useOpenNoteStore((s) => s.selectNote);

  return useCallback(
    async (opts: {
      /** Nhãn hành động đã làm, vd "Đã chuyển ghi chú vào thùng rác" */
      label: string;
      description?: string;
      action: () => Promise<unknown>;
      undo: () => Promise<unknown>;
      /** Ghi chú cần chọn lại sau khi hoàn tác */
      selectBack?: string | null;
      retry?: () => void;
    }): Promise<boolean> => {
      try {
        await opts.action();
      } catch (error) {
        const retry = opts.retry;
        toast({
          title: "Không thực hiện được",
          description: error instanceof Error ? error.message : "Vui lòng thử lại.",
          action: retry && (!(error instanceof RequestError) || error.status >= 500) ? (
            <ToastAction altText="Thử lại thao tác" onClick={retry}>Thử lại</ToastAction>
          ) : undefined,
          variant: "destructive",
          duration: 3000,
        });
        return false;
      }
      const entry: NoteUndoEntry = {
        id: makeUndoId(),
        label: opts.label,
        undo: async () => {
          await opts.undo();
        },
        selectBack: opts.selectBack ?? null,
      };
      useNoteUndoStore.getState().push(entry);
      toast({
        title: opts.label,
        description: opts.description,
        duration: 8000,
        action: (
          <ToastAction
            altText={`Hoàn tác: ${opts.label}`}
            onClick={() => void runUndoEntry(entry, toast, selectNote)}
          >
            Hoàn tác
          </ToastAction>
        ),
      });
      return true;
    },
    [toast, selectNote]
  );
}

export function usePurgeNotes() {
  const runWithUndo = useRunWithUndo();
  const invalidate = useInvalidateNotes();

  return (ids: string[], label: string) => {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, "0")).join("");
    const issuedAt = Date.now();
    const send = async (body: object) => {
      const request = () => jsonFetch("/api/notes/trash-actions", {
        method: "POST", body: JSON.stringify({ ...body, token }),
      });
      try {
        await request();
      } catch (error) {
        if (error instanceof RequestError && error.status < 500 && error.status >= 400) throw error;
        await request();
      }
    };
    const run = (): Promise<boolean> => runWithUndo({
      label,
      action: () => withSavedDrafts(async () => {
        await send({ action: "purge", ids, issuedAt });
        const state = useOpenNoteStore.getState();
        for (const id of ids) {
          forgetCommittedNote(id);
          state.clearUnlocked(id);
        }
        if (state.selectedNoteId && ids.includes(state.selectedNoteId)) state.selectNote(null);
        invalidate();
      }, ids),
      undo: async () => {
        await send({ action: "undo" });
        invalidate();
      },
      retry: () => { void run(); },
    });
    return run();
  };
}
