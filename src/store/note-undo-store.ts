"use client";

import { create } from "zustand";

/**
 * Hoàn tác ở CẤP GHI CHÚ — lưu các hành động vừa thực hiện (xóa vào thùng
 * rác, khôi phục, ghim, di chuyển thư mục, xóa vĩnh viễn, dọn sạch thùng
 * rác…) kèm hàm hoàn tác. Khác với hoàn tác VĂN BẢN trong trình soạn thảo
 * (Ctrl+Z khi đang gõ), lịch sử này chỉ sống trong phiên hiện tại.
 */
export interface NoteUndoEntry {
  id: string;
  /** Nhãn hành động đã làm, vd "Đã chuyển ghi chú vào thùng rác" */
  label: string;
  undo: () => Promise<void>;
  /** Ghi chú cần chọn lại sau khi hoàn tác (nếu có) */
  selectBack?: string | null;
}

interface NoteUndoState {
  entries: NoteUndoEntry[];
  push: (e: NoteUndoEntry) => void;
  latest: () => NoteUndoEntry | null;
  remove: (id: string) => void;
  clear: () => void;
}

const MAX_ENTRIES = 30;

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `undo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const useNoteUndoStore = create<NoteUndoState>()((set, get) => ({
  entries: [],
  push: (e) =>
    set((s) => ({
      entries: [...s.entries, { ...e, id: e.id || newId() }].slice(-MAX_ENTRIES),
    })),
  latest: () => get().entries.at(-1) ?? null,
  remove: (id) => set((s) => ({ entries: s.entries.filter((entry) => entry.id !== id) })),
  clear: () => set({ entries: [] }),
}));

export { newId as makeUndoId };
