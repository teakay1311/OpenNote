"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  Check,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  Hash,
  Loader2,
  Moon,
  MoreHorizontal,
  Pencil,
  Settings,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { tagColor } from "@/lib/opennote-utils";
import type { FolderItem, TagItem } from "@/lib/opennote-types";
import { useFolders, useInvalidateNotes } from "./hooks";
import { useOpenNoteStore } from "@/store/opennote-store";
import { normalizeTag, tagKey } from "@/lib/note-tags";
import { refreshOpenEditor, withSavedDrafts } from "@/store/note-drafts";
import { jsonFetch } from "@/lib/note-request";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const DEFAULT_FOLDER_ID = "folder-notes-default";
const TRASH_FOLDER_ID = "folder-trash-default";

interface SidebarProps {
  onNavigate?: () => void; // close mobile sheet after selecting
  /** render nút đóng riêng trong header (dùng trong mobile sheet) */
  showClose?: boolean;
}

export function Sidebar({ onNavigate, showClose }: SidebarProps) {
  const { theme, setTheme } = useTheme();
  const { data, isLoading } = useFolders();
  const filter = useOpenNoteStore((s) => s.filter);
  const setFilter = useOpenNoteStore((s) => s.setFilter);
  const setSidebarOpen = useOpenNoteStore((s) => s.setSidebarOpen);
  const openSettings = useOpenNoteStore((s) => s.openSettings);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [nameValue, setNameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<FolderItem | null>(null);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);

  const folders = data?.folders || [];
  const tags = data?.tags || [];
  const customFolders = folders.filter(
    (f) => !f.isSystem && f.id !== DEFAULT_FOLDER_ID && f.id !== TRASH_FOLDER_ID
  );
  const defaultFolder = folders.find((f) => f.id === DEFAULT_FOLDER_ID);
  const trashFolder = folders.find((f) => f.id === TRASH_FOLDER_ID);
  const totalCount = folders
    .filter((f) => f.id !== TRASH_FOLDER_ID)
    .reduce((sum, f) => sum + f.count, 0);

  const go = (f: Parameters<typeof setFilter>[0]) => {
    setFilter(f);
    onNavigate?.();
  };

  /** Sau khi đổi tên/xóa thẻ: nếu đang lọc theo thẻ đó thì thoát khỏi bộ lọc */
  const handleTagChanged = (tagLower: string) => {
    if (filter.type === "tag" && filter.tag === tagLower) {
      go({ type: "folder", folderId: DEFAULT_FOLDER_ID });
    }
  };

  const isActive = (type: string, id?: string) =>
    filter.type === type &&
    (type !== "folder" ||
      (filter.type === "folder" && filter.folderId === id));

  const itemCls = (active: boolean) =>
    cn(
      "group/folder flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
      active
        ? "bg-amber-500/20 text-amber-900 dark:bg-amber-400/20 dark:text-amber-200"
        : "text-foreground/80 hover:bg-black/5 dark:hover:bg-white/5"
    );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 pt-5 pb-3">
          <img src="/opennote.svg" alt="" width={36} height={36} className="size-9 shrink-0" />
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-bold tracking-tight">
              OpenNote
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-lg text-foreground/70"
                  aria-label="Cài đặt hệ thống"
                  onClick={() => openSettings()}
                >
                  <Settings className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Cài đặt</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-lg text-foreground/70"
                  aria-label="Chủ đề sáng/tối"
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                >
                  <Sun className="size-4 dark:hidden" />
                  <Moon className="hidden size-4 dark:block" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Sáng / Tối</TooltipContent>
            </Tooltip>

            {showClose && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-lg text-foreground/70"
                    aria-label="Đóng thanh bên"
                    onClick={() => setSidebarOpen(false)}
                  >
                    <X className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Đóng</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Folders */}
        <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Thư mục">
          <SectionLabel>
            Thư mục
            <Button
              variant="ghost"
              size="icon"
              className="size-6 rounded-md text-foreground/50 hover:text-foreground"
              aria-label="Thư mục mới"
              onClick={() => {
                setRenameTarget(null);
                setNameValue("");
                setDialogOpen(true);
              }}
            >
              <FolderPlus className="size-4" />
            </Button>
          </SectionLabel>

          <ul className="space-y-0.5">
            <li>
              <button
                className={cn(itemCls(isActive("all")), "pr-8")}
                onClick={() => go({ type: "all" })}
              >
                <FileText className="size-4 shrink-0 opacity-60" />
                <span className="truncate">Tất cả ghi chú</span>
                {totalCount > 0 && (
                  <span className="ml-auto text-xs tabular-nums opacity-50">
                    {totalCount}
                  </span>
                )}
              </button>
            </li>

            {defaultFolder && (
              <li>
                <button
                  className={cn(itemCls(isActive("folder", DEFAULT_FOLDER_ID)), "pr-8")}
                  onClick={() => go({ type: "folder", folderId: DEFAULT_FOLDER_ID })}
                >
                  <FolderIcon className="size-4 shrink-0 opacity-60" />
                  <span className="truncate">{defaultFolder.name}</span>
                  <span className="ml-auto text-xs tabular-nums opacity-50">
                    {defaultFolder.count}
                  </span>
                </button>
              </li>
            )}

            {customFolders.map((f) => (
              <li key={f.id}>
                <div className="relative">
                  <button
                    className={cn(itemCls(isActive("folder", f.id)), "pr-8")}
                    onClick={() => go({ type: "folder", folderId: f.id })}
                  >
                    <FolderIcon className="size-4 shrink-0 opacity-60" />
                    <span className="truncate">{f.name}</span>
                    <span className="ml-auto text-xs tabular-nums opacity-50">
                      {f.count}
                    </span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1 opacity-0 transition-opacity group-hover/folder:opacity-100 hover:bg-black/10 focus-visible:opacity-100 max-md:opacity-100 dark:hover:bg-white/10"
                        aria-label={`Tùy chọn thư mục ${f.name}`}
                      >
                        <MoreHorizontal className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-44">
                      <DropdownMenuItem
                        onClick={() => {
                          setRenameTarget(f.id);
                          setNameValue(f.name);
                          setDialogOpen(true);
                        }}
                      >
                        <Pencil className="size-4" /> Đổi tên
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteTarget(f)}
                      >
                        <Trash2 className="size-4" /> Xóa thư mục
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            ))}
          </ul>

          {/* Tags — luôn hiển thị để người dùng khám phá tính năng */}
          <SectionLabel className="mt-5">
            Thẻ
            <Button
              variant="ghost"
              size="icon"
              className="size-6 rounded-md text-foreground/50 hover:text-foreground"
              aria-label="Quản lý thẻ"
              onClick={() => setTagDialogOpen(true)}
            >
              <Pencil className="size-3.5" />
            </Button>
          </SectionLabel>
          {tags.length > 0 ? (
            <ul className="space-y-0.5">
              {tags.map((t) => (
                <li key={t.name}>
                  <button
                    className={cn(
                      itemCls(
                        filter.type === "tag" &&
                          filter.tag === t.name.slice(1).toLowerCase()
                      ),
                      "pr-8"
                    )}
                    onClick={() =>
                      go({ type: "tag", tag: t.name.slice(1).toLowerCase() })
                    }
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-full",
                        tagColor(t.name)
                      )}
                    >
                      <Hash className="size-2.5 text-white" />
                    </span>
                    <span className="truncate">{t.name}</span>
                    <span className="ml-auto text-xs tabular-nums opacity-50">
                      {t.count}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-1 text-xs leading-relaxed text-muted-foreground/70">
              Gõ{" "}
              <span className="rounded bg-black/5 px-1 font-mono text-[11px] dark:bg-white/10">
                #thẻ
              </span>{" "}
              trong nội dung ghi chú để tạo thẻ.
            </p>
          )}

          {/* Trash */}
          {trashFolder && (
            <div className="mt-5">
              <SectionLabel />
              <button
                className={cn(itemCls(isActive("trash")), "text-foreground/60")}
                onClick={() => go({ type: "trash" })}
              >
                <Trash2 className="size-4 shrink-0 opacity-60" />
                <span className="truncate">{trashFolder.name}</span>
              </button>
            </div>
          )}
        </nav>

        {isLoading && (
          <div className="px-4 pb-3 text-xs text-muted-foreground">Đang tải…</div>
        )}

        <FolderDialog
          key={dialogOpen ? renameTarget ?? "create" : "closed"}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          folderId={renameTarget}
          initialName={nameValue}
        />

        <DeleteFolderDialog
          key={deleteTarget?.id ?? "closed"}
          folder={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDone={(deletedId) => {
            if (filter.type === "folder" && filter.folderId === deletedId) {
              go({ type: "folder", folderId: DEFAULT_FOLDER_ID });
            }
          }}
        />

        <TagManagerDialog
          open={tagDialogOpen}
          onOpenChange={setTagDialogOpen}
          onAfterChange={handleTagChanged}
        />
      </div>
    </TooltipProvider>
  );
}

function SectionLabel({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-1 flex items-center justify-between px-3 text-[11px] font-semibold tracking-wide text-muted-foreground/70 uppercase",
        className
      )}
    >
      <span className="truncate">{children}</span>
    </div>
  );
}

function usePendingFolderWarning(pending: boolean) {
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);
}

function FolderDialog({
  open,
  onOpenChange,
  folderId,
  initialName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  folderId: string | null;
  initialName: string;
}) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const creation = useRef<{ id: string; name: string } | null>(null);
  const invalidate = useInvalidateNotes();
  usePendingFolderWarning(open && (saving || !!error || name.trim() !== initialName.trim()));

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError("");
    if (!folderId && !creation.current) creation.current = { id: crypto.randomUUID(), name: trimmed };
    const id = folderId ?? creation.current!.id;
    try {
      if (folderId && error) {
        const current = await jsonFetch<{ folders: FolderItem[] }>("/api/folders", { cache: "no-store" });
        const existing = current.folders.find((folder) => folder.id === id);
        if (!existing) throw new Error("Thư mục này đã bị xóa.");
        if (existing.name === trimmed) {
          invalidate();
          onOpenChange(false);
          return;
        }
      }
      if (creation.current && creation.current.name !== trimmed) {
        const folders = await jsonFetch<{ folders: FolderItem[] }>("/api/folders", { cache: "no-store" });
        if (folders.folders.some((folder) => folder.id === id)) {
          await jsonFetch(`/api/folders/${id}`, { method: "PATCH", body: JSON.stringify({ name: trimmed }) });
        } else {
          await jsonFetch("/api/folders", { method: "POST", body: JSON.stringify({ id, name: trimmed }) });
        }
      } else {
        await jsonFetch(folderId ? `/api/folders/${id}` : "/api/folders", {
          method: folderId ? "PATCH" : "POST",
          body: JSON.stringify(folderId ? { name: trimmed } : { id, name: trimmed }),
        });
      }
      invalidate();
      onOpenChange(false);
    } catch (failure) {
      const current = await jsonFetch<{ folders: FolderItem[] }>("/api/folders", { cache: "no-store" }).catch(() => null);
      if (current?.folders.some((folder) => folder.id === id && folder.name === trimmed)) {
        invalidate();
        onOpenChange(false);
      } else {
        setError(failure instanceof Error ? failure.message : "Không lưu được thư mục");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {folderId ? "Đổi tên thư mục" : "Thư mục mới"}
          </DialogTitle>
          <DialogDescription>
            {folderId
              ? "Nhập tên mới cho thư mục."
              : "Đặt tên cho thư mục mới của bạn."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-1">
          <Label htmlFor="folder-name">Tên thư mục</Label>
          <Input
            id="folder-name"
            autoFocus
            value={name}
            placeholder="Ví dụ: Công việc"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
          />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={save} disabled={!name.trim() || saving}>
            {saving ? "Đang lưu…" : "Lưu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteFolderDialog({
  folder,
  onClose,
  onDone,
}: {
  folder: FolderItem | null;
  onClose: () => void;
  onDone: (deletedId: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const invalidate = useInvalidateNotes();
  usePendingFolderWarning(!!folder && (deleting || !!error));

  const remove = async () => {
    if (!folder || deleting) return;
    setDeleting(true);
    setError("");
    try {
      try {
        const current = error
          ? await jsonFetch<{ folders: FolderItem[] }>("/api/folders", { cache: "no-store" })
          : null;
        if (!current || current.folders.some((item) => item.id === folder.id)) {
          await jsonFetch(`/api/folders/${folder.id}`, { method: "DELETE" });
        }
      } catch (failure) {
        const current = await jsonFetch<{ folders: FolderItem[] }>("/api/folders", { cache: "no-store" }).catch(() => null);
        if (!current || current.folders.some((item) => item.id === folder.id)) throw failure;
      }
      invalidate();
      onDone(folder.id);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Không xóa được thư mục");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog
      open={!!folder}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Xóa thư mục “{folder?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Các ghi chú bên trong sẽ được chuyển sang thư mục “Ghi chú”. Hành động
            này không thể hoàn tác.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Hủy</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => { event.preventDefault(); void remove(); }}
            disabled={deleting}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {deleting ? "Đang xóa…" : "Xóa thư mục"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ==================== Quản lý thẻ ==================== */

let tagSyncRequired = false;

function TagManagerDialog({
  open,
  onOpenChange,
  onAfterChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAfterChange: (tagLower: string) => void;
}) {
  const { data, isLoading } = useFolders();
  const invalidate = useInvalidateNotes();
  const { toast } = useToast();
  const tags: TagItem[] = data?.tags || [];

  const [renaming, setRenaming] = useState<string | null>(null);
  const [nameValue, setNameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<TagItem | null>(null);
  const [busy, setBusy] = useState(false);

  const startRename = (t: TagItem) => {
    setRenaming(t.name);
    setNameValue(t.name.slice(1));
  };

  const refreshTagsAndNotes = async () => {
    const editorReady = await refreshOpenEditor();
    const listsReady = await invalidate(true).then(() => true, () => false);
    tagSyncRequired = !editorReady || !listsReady;
    return !tagSyncRequired;
  };

  const changeTag = (method: "PATCH" | "DELETE", body: object) =>
    withSavedDrafts(async () => {
      if (tagSyncRequired && !(await refreshTagsAndNotes())) {
        throw new Error("Chưa tải được dữ liệu thẻ và ghi chú mới. Vui lòng thử lại.");
      }
      try {
        return await jsonFetch<{ updated: number }>("/api/tags", { method, body: JSON.stringify(body) });
      } finally {
        await refreshTagsAndNotes();
      }
    });

  const saveRename = async () => {
    if (!renaming) return;
    const from = renaming.slice(1);
    const to = normalizeTag(nameValue);
    if (!to) {
      toast({
        title: "Tên thẻ không hợp lệ",
        description: "Chỉ gồm chữ, số và dấu _ (tối đa 50 ký tự).",
        variant: "destructive",
        duration: 3500,
      });
      return;
    }
    if (tagKey(to) === tagKey(from)) {
      setRenaming(null);
      return;
    }
    setBusy(true);
    try {
      const d = await changeTag("PATCH", { from, to });
      toast({
        title: "Đã đổi tên thẻ",
        description: `#${from} → #${to} trong ${d.updated} ghi chú.`,
        duration: 3000,
      });
      onAfterChange(tagKey(from));
      setRenaming(null);
    } catch (e) {
      toast({
        title: "Không đổi được tên thẻ",
        description: e instanceof Error ? e.message : "Vui lòng thử lại.",
        variant: "destructive",
        duration: 3500,
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const tag = deleteTarget.name.slice(1);
    setBusy(true);
    try {
      const d = await changeTag("DELETE", { tag });
      toast({
        title: "Đã xóa thẻ",
        description: `Đã gỡ #${tag} khỏi ${d.updated} ghi chú.`,
        duration: 3000,
      });
      onAfterChange(tagKey(tag));
      setDeleteTarget(null);
    } catch (e) {
      toast({
        title: "Không xóa được thẻ",
        description: e instanceof Error ? e.message : "Vui lòng thử lại.",
        variant: "destructive",
        duration: 3500,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-md">
          <DialogHeader className="shrink-0">
            <DialogTitle>Quản lý thẻ</DialogTitle>
            <DialogDescription>
              Đổi tên hoặc xóa thẻ trên các ghi chú không khóa. Thẻ được tạo tự động từ
              #từkhóa trong nội dung ghi chú.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1" aria-label="Danh sách thẻ">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : tags.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Chưa có thẻ nào.
                <br />
                Gõ <span className="font-mono">#thẻ</span> trong nội dung ghi chú
                để tạo thẻ đầu tiên.
              </div>
            ) : (
              <ul className="divide-y">
                {tags.map((t) => (
                  <li key={t.name} className="flex items-center gap-2 py-2">
                    {renaming === t.name ? (
                      <>
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-full",
                            tagColor(t.name)
                          )}
                        >
                          <Hash className="size-2.5 text-white" />
                        </span>
                        <Input
                          autoFocus
                          value={nameValue}
                          aria-label="Tên thẻ mới"
                          onChange={(e) => setNameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveRename();
                            if (e.key === "Escape") setRenaming(null);
                          }}
                          className="h-8 flex-1"
                          maxLength={50}
                        />
                        <Button
                          size="icon"
                          className="size-8 shrink-0 rounded-lg"
                          aria-label="Lưu tên thẻ"
                          disabled={busy || !nameValue.trim()}
                          onClick={() => void saveRename()}
                        >
                          {busy ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Check className="size-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0 rounded-lg"
                          aria-label="Hủy đổi tên"
                          disabled={busy}
                          onClick={() => setRenaming(null)}
                        >
                          <X className="size-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-full",
                            tagColor(t.name)
                          )}
                        >
                          <Hash className="size-2.5 text-white" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {t.name}
                        </span>
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                          {t.count} ghi chú
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0 rounded-lg text-foreground/60"
                          aria-label={`Đổi tên thẻ ${t.name}`}
                          onClick={() => startRename(t)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0 rounded-lg text-destructive/80 hover:text-destructive"
                          aria-label={`Xóa thẻ ${t.name}`}
                          onClick={() => setDeleteTarget(t)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa thẻ “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Thẻ sẽ bị gỡ khỏi các ghi chú không khóa, kể cả trong thùng rác.
              Nội dung còn lại được giữ nguyên. Hành động này không thể hoàn tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Hủy</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => { event.preventDefault(); void confirmDelete(); }}
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {busy ? "Đang xóa…" : "Xóa thẻ"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
