"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateNote,
  useExportAllNotes,
  useNoteAction,
} from "./hooks";
import { useRunWithUndo, runUndoEntry } from "./use-note-undo";
import { useOpenNoteStore } from "@/store/opennote-store";
import { useNoteUndoStore } from "@/store/note-undo-store";
import { useToast } from "@/hooks/use-toast";

/**
 * Phím tắt toàn cục — được thiết kế KHÔNG xung đột với phím tắt mặc định
 * của trình duyệt / hệ điều hành (Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+F,
 * Ctrl+T, Ctrl+N, Ctrl+W…). Mọi tổ hợp của ứng dụng đều dùng thêm phím
 * Alt hoặc ký tự riêng (», /) nên không thể đè lên phím gốc:
 *
 *  - Ctrl+Alt+N : tạo ghi chú mới
 *  - /          : focus ô tìm kiếm (chỉ khi không đang gõ)
 *  - Ctrl+\     : thu gọn/mở thanh thư mục
 *  - Ctrl+Alt+L : ẩn/hiện danh sách ghi chú
 *  - Ctrl+Alt+P : ghim/bỏ ghim ghi chú đang mở
 *  - Ctrl+Alt+E : tải bản sao lưu .json
 *  - Ctrl+/     : mở Cài đặt → Phím tắt
 *  - Ctrl+Z     : hoàn tác hành động cấp ghi chú gần nhất
 *                 (xóa/ghim/di chuyển… — CHỈ khi không đang soạn thảo,
 *                  khi đang gõ thì Ctrl+Z là hoàn tác văn bản của editor)
 *
 * Trên Mac: ⌘ Cmd được chấp nhận thay cho Ctrl.
 */
export function GlobalShortcuts() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createNote = useCreateNote();
  const action = useNoteAction();
  const runWithUndo = useRunWithUndo();
  const { exportNotes } = useExportAllNotes();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const store = useOpenNoteStore.getState();

      // Người dùng có thể tắt toàn bộ phím tắt trong Cài đặt
      if (!store.shortcutsEnabled) return;
      // Đang có hộp thoại / menu / popover mở → không bắn phím tắt
      if (
        document.querySelector(
          '[role="dialog"], [role="menu"], [role="alertdialog"], [data-radix-popper-content-wrapper]'
        )
      ) {
        return;
      }
      // Đang soạn thảo IME (gõ tiếng Việt có dấu…) → nhường nguyên trạng
      if (e.isComposing) return;

      const mod = e.ctrlKey || e.metaKey;
      const alt = e.altKey;
      const key = e.key.toLowerCase();
      // Chỉ khi target là Element mới có closest() — tránh TypeError khi
      // event bắn từ window/document (synthetic event, script…)
      const target = e.target instanceof Element ? e.target : null;
      const isTyping = !!target?.closest(
        'input, textarea, select, [contenteditable="true"], [contenteditable=""]'
      );

      // AltGr (bàn phím châu Âu) gửi ctrl+alt — bỏ qua để không chặn gõ ký tự
      if (e.getModifierState?.("AltGraph")) return;

      /* ---------- Tổ hợp phím ứng dụng ---------- */
      // Hoàn tác hành động cấp ghi chú gần nhất (xóa/ghim/di chuyển…).
      // Khi đang soạn thảo thì nhường Ctrl+Z cho hoàn tác văn bản.
      if (mod && !alt && !e.shiftKey && key === "z") {
        if (isTyping) return;
        const entry = useNoteUndoStore.getState().latest();
        if (!entry) return;
        e.preventDefault();
        void runUndoEntry(entry, toast, store.selectNote);
        return;
      }

      if (mod && alt && key === "n" && !e.shiftKey) {
        e.preventDefault();
        createNote.mutate();
        return;
      }

      if (mod && alt && key === "l" && !e.shiftKey) {
        e.preventDefault();
        if (window.innerWidth >= 768) store.toggleListCollapsed();
        return;
      }

      if (mod && alt && key === "p" && !e.shiftKey) {
        e.preventDefault();
        const id = store.selectedNoteId;
        if (!id) return;
        const note = queryClient.getQueryData<{ pinned?: boolean }>([
          "opennote",
          "note",
          id,
          !!store.noteAccess[id],
        ]);
        const prevPinned = !!note?.pinned;
        const nextPinned = !prevPinned;
        void runWithUndo({
          label: nextPinned ? "Đã ghim ghi chú" : "Đã bỏ ghim ghi chú",
          action: () => action.patch(id, { pinned: nextPinned }),
          undo: () => action.patch(id, { pinned: prevPinned }),
        });
        return;
      }

      if (mod && alt && key === "e" && !e.shiftKey) {
        e.preventDefault();
        exportNotes("json");
        return;
      }

      if (mod && (key === "\\" || e.code === "Backslash")) {
        e.preventDefault();
        if (window.innerWidth >= 1024) store.toggleSidebarCollapsed();
        return;
      }

      if (mod && (key === "/" || e.code === "Slash")) {
        e.preventDefault();
        store.openSettings("shortcuts");
        return;
      }

      /* ---------- Phím đơn ---------- */
      // "/" focus tìm kiếm — chỉ khi KHÔNG đang gõ trong ô nhập/soạn thảo
      if (!mod && !alt && !e.shiftKey && key === "/" && !isTyping) {
        e.preventDefault();
        store.requestSearchFocus();
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createNote, action, exportNotes, queryClient, toast, runWithUndo]);

  return null;
}
