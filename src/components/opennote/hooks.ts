"use client";

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOpenNoteStore } from "@/store/opennote-store";
import { useToast } from "@/hooks/use-toast";
import { fetchNote, jsonFetch, noteHeaders } from "@/lib/note-request";
import { forgetCommittedNote, refreshOpenEditor, withSavedDrafts } from "@/store/note-drafts";
import { htmlToMarkdown } from "@/lib/html-to-markdown";
import type {
  FolderItem,
  NoteDetail,
  NoteFilter,
  NoteListItem,
  SortBy,
  TagItem,
} from "@/lib/opennote-types";

export function useFolders() {
  return useQuery({
    queryKey: ["opennote", "folders"],
    queryFn: () =>
      jsonFetch<{ folders: FolderItem[]; tags: TagItem[] }>("/api/folders"),
  });
}

/* ---------------- Export toàn bộ ghi chú (dùng chung) ---------------- */

interface ExportedNote {
  title: string;
  content: string | null;
  plainText: string;
  locked: boolean;
  pinned: boolean;
  folderId: string;
  createdAt: string;
  updatedAt: string;
}

export type ExportFormat = "json" | "txt" | "md";

/** Xuất toàn bộ ghi chú: .json (sao lưu), .txt (văn bản gộp) hoặc .md (Markdown gộp). */
export function useExportAllNotes() {
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);

  const exportNotes = useCallback(
    async (fmt: ExportFormat) => {
      setExporting(true);
      try {
        const res = await fetch("/api/notes/export");
        if (!res.ok) throw new Error("export failed");
        const data = await res.json();
        const notes: ExportedNote[] = data.notes ?? [];
        const stamp = new Date().toISOString().slice(0, 10);
        let blob: Blob;
        let filename: string;

        if (fmt === "json") {
          blob = new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json;charset=utf-8",
          });
          filename = `opennote-sao-luu-${stamp}.json`;
        } else if (fmt === "md") {
          const folderMap = new Map<string, string>(
            ((data.folders ?? []) as { id: string; name: string }[]).map((f) => [
              f.id,
              f.name,
            ])
          );
          const lines: string[] = [
            "# OpenNote — Toàn bộ ghi chú",
            "",
            `> Xuất ngày ${new Date().toLocaleString("vi-VN")} · ${notes.length} ghi chú`,
            "",
          ];
          notes.forEach((n, i) => {
            lines.push("---", "");
            lines.push(`## ${i + 1}. ${n.title || "Ghi chú không tiêu đề"}`);
            lines.push("");
            lines.push(
              `> Thư mục: ${folderMap.get(n.folderId) || "—"} · Tạo: ${new Date(
                n.createdAt
              ).toLocaleString("vi-VN")} · Sửa: ${new Date(
                n.updatedAt
              ).toLocaleString("vi-VN")}${n.pinned ? " · Đã ghim" : ""}${
                n.locked ? " · Đã khóa" : ""
              }`
            );
            lines.push("");
            lines.push(
              n.locked
                ? "*(Ghi chú này đã khóa — nội dung không được xuất.)*"
                : htmlToMarkdown(n.content ?? "") || "*(Ghi chú trống)*"
            );
            lines.push("");
          });
          blob = new Blob([lines.join("\n")], {
            type: "text/markdown;charset=utf-8",
          });
          filename = `opennote-ghi-chu-${stamp}.md`;
        } else {
          const folderMap = new Map<string, string>(
            ((data.folders ?? []) as { id: string; name: string }[]).map((f) => [
              f.id,
              f.name,
            ])
          );
          const lines: string[] = [
            "OpenNote — Xuất toàn bộ ghi chú",
            `Ngày xuất: ${new Date().toLocaleString("vi-VN")}`,
            `Tổng cộng: ${notes.length} ghi chú`,
            "",
          ];
          notes.forEach((n, i) => {
            const sep = "─".repeat(36);
            lines.push(sep);
            lines.push(`${i + 1}. ${n.title || "Ghi chú không tiêu đề"}`);
            lines.push(
              `Thư mục: ${folderMap.get(n.folderId) || "—"} · Tạo: ${new Date(
                n.createdAt
              ).toLocaleString("vi-VN")} · Sửa: ${new Date(
                n.updatedAt
              ).toLocaleString("vi-VN")}${n.pinned ? " · Đã ghim" : ""}${
                n.locked ? " · Đã khóa" : ""
              }`
            );
            lines.push("");
            lines.push(
              n.locked
                ? "(Ghi chú này đã khóa — nội dung không được xuất.)"
                : n.plainText || "(Ghi chú trống)"
            );
            lines.push("");
          });
          blob = new Blob([lines.join("\n")], {
            type: "text/plain;charset=utf-8",
          });
          filename = `opennote-ghi-chu-${stamp}.txt`;
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);

        toast({
          title: "Đã xuất ghi chú",
          description: `${notes.length} ghi chú đã được tải về trong tệp “${filename}”.`,
          duration: 2500,
        });
      } catch {
        toast({
          title: "Không xuất được ghi chú",
          description: "Vui lòng thử lại.",
          variant: "destructive",
        });
      } finally {
        setExporting(false);
      }
    },
    [toast]
  );

  return { exportNotes, exporting };
}

export function buildNotesParams(
  filter: NoteFilter,
  search: string,
  sort: SortBy
): string {
  const params = new URLSearchParams();
  if (filter.type === "folder") {
    params.set("view", "folder");
    params.set("folderId", filter.folderId);
  } else if (filter.type === "trash") {
    params.set("view", "trash");
  } else {
    params.set("view", "all");
  }
  if (filter.type === "tag") params.set("tag", filter.tag);
  if (search.trim()) params.set("q", search.trim());
  params.set("sort", sort);
  return params.toString();
}

export function useNotesList() {
  const filter = useOpenNoteStore((s) => s.filter);
  const search = useOpenNoteStore((s) => s.searchQuery);
  const sort = useOpenNoteStore((s) => s.sortBy);
  const params = buildNotesParams(filter, search, sort);
  return useQuery({
    queryKey: ["opennote", "notes", params],
    queryFn: () => jsonFetch<{ notes: NoteListItem[] }>(`/api/notes?${params}`),
  });
}

export function useNoteDetail(id: string | null) {
  const token = useOpenNoteStore((s) => id ? s.noteAccess[id] : undefined);
  return useQuery({
    queryKey: ["opennote", "note", id, !!token],
    queryFn: () => fetchNote(id!),
    enabled: !!id,
    refetchOnMount: "always",
    gcTime: token ? 0 : undefined,
  });
}

export function useInvalidateNotes() {
  const qc = useQueryClient();
  return (throwOnError = false) => qc.invalidateQueries({ queryKey: ["opennote"] }, { throwOnError });
}

export function useCreateNote() {
  const invalidate = useInvalidateNotes();
  const selectNote = useOpenNoteStore((s) => s.selectNote);
  const filter = useOpenNoteStore((s) => s.filter);
  const folderId = filter.type === "folder" && filter.folderId !== "folder-trash-default" ? filter.folderId : undefined;
  return useMutation({
    mutationFn: () =>
      jsonFetch<NoteDetail>("/api/notes", {
        method: "POST",
        body: JSON.stringify({ folderId }),
      }),
    onSuccess: (note) => {
      invalidate();
      selectNote(note.id);
    },
  });
}

export function useNoteAction() {
  const invalidate = useInvalidateNotes();
  const selectNote = useOpenNoteStore((s) => s.selectNote);
  return {
    invalidate,
    selectNote,
    async patch(id: string, data: Record<string, unknown>) {
      const write = () => jsonFetch<NoteDetail>(`/api/notes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      if ("deletedAt" in data) {
        await withSavedDrafts(async () => {
          await write();
          await refreshOpenEditor(id);
        }, [id]);
      } else {
        await write();
      }
      await invalidate();
    },
    async trash(id: string) {
      await withSavedDrafts(async () => {
        await jsonFetch<NoteDetail>(`/api/notes/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ deletedAt: new Date().toISOString() }),
        });
        if (useOpenNoteStore.getState().selectedNoteId === id) selectNote(null);
        await invalidate();
      }, [id]);
    },
    async restore(id: string) {
      await withSavedDrafts(async () => {
        await jsonFetch<NoteDetail>(`/api/notes/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ deletedAt: null }),
        });
        await refreshOpenEditor(id);
        await invalidate();
      }, [id]);
    },
    async lock(id: string, pin: string) {
      await withSavedDrafts(async () => {
        await jsonFetch(`/api/notes/${id}/lock`, { method: "POST", body: JSON.stringify({ pin }) });
        forgetCommittedNote(id);
        useOpenNoteStore.getState().clearUnlocked(id);
        await invalidate();
      }, [id]);
    },
    async relock(id: string) {
      await withSavedDrafts(async () => {
        await jsonFetch(`/api/notes/${id}/lock`, {
          method: "POST", headers: noteHeaders(id), body: JSON.stringify({ relock: true }),
        });
        forgetCommittedNote(id);
        useOpenNoteStore.getState().clearUnlocked(id);
        await invalidate();
      }, [id]);
    },
    async unlock(id: string, pin: string) {
      return jsonFetch<NoteDetail & { accessToken: string }>(
        `/api/notes/${id}/unlock`,
        { method: "POST", body: JSON.stringify({ pin }) }
      );
    },
    async removeLock(id: string, pin: string) {
      await withSavedDrafts(async () => {
        await jsonFetch(`/api/notes/${id}/remove-lock`, { method: "POST", body: JSON.stringify({ pin }) });
        forgetCommittedNote(id);
        useOpenNoteStore.getState().clearUnlocked(id);
        await invalidate();
      }, [id]);
    },
  };
}
