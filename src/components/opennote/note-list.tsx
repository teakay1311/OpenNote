"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  ArrowDownUp,
  CheckSquare,
  ClipboardCopy,
  GalleryVerticalEnd,
  List,
  Lock,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  Pin,
  PinOff,
  RotateCcw,
  Search,
  Settings,
  SquarePen,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNoteDate } from "@/lib/opennote-utils";
import {
  useCreateNote,
  useFolders,
  useNotesList,
  useNoteAction,
} from "./hooks";
import { usePurgeNotes, useRunWithUndo } from "./use-note-undo";
import { useOpenNoteStore } from "@/store/opennote-store";
import { useToast } from "@/hooks/use-toast";
import type { NoteListItem } from "@/lib/opennote-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const TRASH_FOLDER_ID = "folder-trash-default";
const DEFAULT_FOLDER_ID = "folder-notes-default";

export function NoteList() {
  const { theme, setTheme } = useTheme();
  const filter = useOpenNoteStore((s) => s.filter);
  const search = useOpenNoteStore((s) => s.searchQuery);
  const setSearch = useOpenNoteStore((s) => s.setSearchQuery);
  const sortBy = useOpenNoteStore((s) => s.sortBy);
  const setSortBy = useOpenNoteStore((s) => s.setSortBy);
  const layout = useOpenNoteStore((s) => s.layout);
  const setLayout = useOpenNoteStore((s) => s.setLayout);
  const selectedNoteId = useOpenNoteStore((s) => s.selectedNoteId);
  const selectNote = useOpenNoteStore((s) => s.selectNote);
  const setSidebarOpen = useOpenNoteStore((s) => s.setSidebarOpen);
  const sidebarCollapsed = useOpenNoteStore((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useOpenNoteStore((s) => s.toggleSidebarCollapsed);
  const toggleListCollapsed = useOpenNoteStore((s) => s.toggleListCollapsed);
  const openSettings = useOpenNoteStore((s) => s.openSettings);
  const searchFocusTick = useOpenNoteStore((s) => s.searchFocusTick);
  const { data, isLoading } = useNotesList();
  const { data: foldersData } = useFolders();
  const createNote = useCreateNote();
  const purgeNotes = usePurgeNotes();
  const searchRef = useRef<HTMLInputElement>(null);
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [emptying, setEmptying] = useState(false);

  // Focus ô tìm kiếm khi có yêu cầu từ phím tắt "/"
  useEffect(() => {
    if (searchFocusTick > 0) searchRef.current?.focus();
  }, [searchFocusTick]);

  const notes = useMemo(() => data?.notes || [], [data]);
  const pinned = notes.filter((n) => n.pinned);
  const others = notes.filter((n) => !n.pinned);

  const headerTitle = () => {
    if (search.trim()) return `Kết quả cho “${search.trim()}”`;
    if (filter.type === "trash") return "Đã xóa gần đây";
    if (filter.type === "tag") return `#${filter.tag}`;
    if (filter.type === "all") return "Tất cả ghi chú";
    const f = foldersData?.folders.find((x) => x.id === filter.folderId);
    return f?.name;
  };
  const isTrash = filter.type === "trash";

  const emptyTrash = async () => {
    if (!confirmIds?.length || emptying) return;
    setEmptying(true);
    try {
      await purgeNotes(confirmIds, `Đã dọn sạch ${confirmIds.length} ghi chú`);
      setConfirmIds(null);
    } finally {
      setEmptying(false);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col border-r bg-background">
      {/* Header */}
      <div className="shrink-0 px-3 pt-3 pb-2 md:pt-4">
        <div className="mb-2 flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-lg lg:hidden"
            aria-label="Mở menu"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="size-5" />
          </Button>

          {/* Thu gọn / mở rộng thanh thư mục (desktop lg+) */}
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden size-9 rounded-lg lg:inline-flex"
                  aria-label={
                    sidebarCollapsed ? "Hiện thanh thư mục" : "Thu gọn thanh thư mục"
                  }
                  onClick={toggleSidebarCollapsed}
                >
                  {sidebarCollapsed ? (
                    <PanelLeftOpen className="size-[18px]" />
                  ) : (
                    <PanelLeftClose className="size-[18px]" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {sidebarCollapsed ? "Hiện thanh thư mục" : "Thu gọn thanh thư mục"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Ẩn/hiện cột danh sách ghi chú (desktop md+) — đặt trong khung danh sách */}
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden size-9 rounded-lg md:inline-flex"
                  aria-label="Ẩn danh sách ghi chú"
                  onClick={toggleListCollapsed}
                >
                  <PanelRightClose className="size-[18px]" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Ẩn danh sách — xem ghi chú toàn màn hình</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Khi thanh thư mục đang thu gọn: giữ nút cài đặt + đổi chủ đề tại đây */}
          {sidebarCollapsed && (
            <div className="hidden items-center gap-0.5 lg:flex">
              <TooltipProvider delayDuration={300}>
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
              </TooltipProvider>

              <TooltipProvider delayDuration={300}>
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
              </TooltipProvider>
            </div>
          )}

          <h2 className="min-w-0 flex-1 truncate px-1 text-base font-bold md:text-lg">
            {headerTitle() ?? `${notes.length} ghi chú`}
          </h2>

          {isTrash && notes.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-lg px-2 text-destructive hover:text-destructive"
              onClick={() => setConfirmIds(notes.map((note) => note.id))}
            >
              <Trash2 className="size-4" />
              <span className="hidden sm:inline">Dọn sạch</span>
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 rounded-lg"
                aria-label="Tùy chọn hiển thị"
              >
                <ArrowDownUp className="size-4.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Sắp xếp theo</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setSortBy("edited")}>
                <span className={cn(sortBy === "edited" && "font-semibold text-amber-600 dark:text-amber-400")}>
                  Ngày chỉnh sửa
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("created")}>
                <span className={cn(sortBy === "created" && "font-semibold text-amber-600 dark:text-amber-400")}>
                  Ngày tạo
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("title")}>
                <span className={cn(sortBy === "title" && "font-semibold text-amber-600 dark:text-amber-400")}>
                  Tiêu đề
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Hiển thị</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setLayout("list")}>
                <List className="size-4" />
                <span className={cn(layout === "list" && "font-semibold")}>Danh sách</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLayout("gallery")}>
                <GalleryVerticalEnd className="size-4" />
                <span className={cn(layout === "gallery" && "font-semibold")}>Thư viện</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {!isTrash && (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 rounded-lg text-amber-500 hover:bg-amber-500/15 hover:text-amber-600 dark:text-amber-400"
                    aria-label="Ghi chú mới"
                    disabled={createNote.isPending}
                    onClick={() => createNote.mutate()}
                  >
                    <SquarePen className="size-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Ghi chú mới</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm kiếm"
            className="h-9 rounded-lg border-transparent bg-black/5 pl-8 pr-8 text-sm focus-visible:bg-background dark:bg-white/5"
            aria-label="Tìm kiếm ghi chú"
          />
          {search && (
            <button
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10"
              aria-label="Xóa tìm kiếm"
              onClick={() => {
                setSearch("");
                searchRef.current?.focus();
              }}
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-24 md:pb-4">
        {isLoading ? (
          <div className="space-y-2 p-1">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-xl bg-black/5 dark:bg-white/5"
              />
            ))}
          </div>
        ) : notes.length === 0 ? (
          <EmptyState isTrash={isTrash} searching={!!search.trim()} />
        ) : layout === "gallery" ? (
          <GalleryView
            pinned={pinned}
            others={others}
            selectedNoteId={selectedNoteId}
            isTrash={isTrash}
            onSelect={(id) => selectNote(id)}
          />
        ) : (
          <ListView
            pinned={pinned}
            others={others}
            selectedNoteId={selectedNoteId}
            isTrash={isTrash}
            onSelect={(id) => selectNote(id)}
          />
        )}
      </div>

      {/* Xác nhận dọn sạch thùng rác — chống xóa nhầm dữ liệu */}
      <AlertDialog open={!!confirmIds} onOpenChange={(open) => { if (!open && !emptying) setConfirmIds(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dọn sạch thùng rác?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmIds?.length} ghi chú trong “Đã xóa gần đây” sẽ bị xóa.
              Bạn có thể hoàn tác trong phiên làm việc này.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={emptying}>Hủy</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => { event.preventDefault(); void emptyTrash(); }}
              disabled={emptying}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {emptying ? "Đang dọn…" : "Dọn sạch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ---------------- List view ---------------- */

function ListView({
  pinned,
  others,
  selectedNoteId,
  isTrash,
  onSelect,
}: {
  pinned: NoteListItem[];
  others: NoteListItem[];
  selectedNoteId: string | null;
  isTrash: boolean;
  onSelect: (id: string) => void;
}) {
  const action = useNoteAction();
  const runWithUndo = useRunWithUndo();
  const purgeNotes = usePurgeNotes();
  const filter = useOpenNoteStore((s) => s.filter);

  const renderRow = (n: NoteListItem) => (
    <NoteRow
      key={n.id}
      note={n}
      active={n.id === selectedNoteId}
      isTrash={isTrash}
      showFolder={filter.type !== "folder" || !!isTrash}
      onSelect={() => onSelect(n.id)}
      onPin={() =>
        void runWithUndo({
          label: n.pinned ? "Đã bỏ ghim ghi chú" : "Đã ghim ghi chú",
          action: () => action.patch(n.id, { pinned: !n.pinned }),
          undo: () => action.patch(n.id, { pinned: n.pinned }),
        })
      }
      onTrash={() =>
        void runWithUndo({
          label: "Đã chuyển ghi chú vào thùng rác",
          action: () => action.trash(n.id),
          undo: () => action.restore(n.id),
          selectBack: selectedNoteId === n.id ? n.id : null,
        })
      }
      onRestore={() =>
        void runWithUndo({
          label: "Đã khôi phục ghi chú",
          action: () => action.restore(n.id),
          undo: () =>
            action.patch(n.id, { deletedAt: n.deletedAt }),
        })
      }
      onDelete={() => { void purgeNotes([n.id], "Đã xóa vĩnh viễn ghi chú"); }}
    />
  );

  return (
    <div className="space-y-4 p-1">
      {pinned.length > 0 && (
        <div>
          <p className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground/70 uppercase">
            Đã ghim
          </p>
          {pinned.map(renderRow)}
        </div>
      )}
      {others.length > 0 && (
        <div>
          {pinned.length > 0 && (
            <p className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground/70 uppercase">
              Ghi chú khác
            </p>
          )}
          {others.map(renderRow)}
        </div>
      )}
    </div>
  );
}

function NoteRow({
  note,
  active,
  isTrash,
  showFolder,
  onSelect,
  onPin,
  onTrash,
  onRestore,
  onDelete,
}: {
  note: NoteListItem;
  active: boolean;
  isTrash: boolean;
  showFolder: boolean;
  onSelect: () => void;
  onPin: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group/note relative">
      <button
        className={cn(
          "w-full rounded-xl px-3 py-2.5 text-left transition-colors",
          active
            ? "bg-amber-400/25 dark:bg-amber-400/15"
            : "hover:bg-black/5 dark:hover:bg-white/5"
        )}
        onClick={onSelect}
      >
        <div className="flex items-center gap-1.5 pr-6">
          {note.pinned && <Pin className="size-3 shrink-0 fill-amber-500 text-amber-500" />}
          {note.locked && <Lock className="size-3 shrink-0 text-muted-foreground" />}
          <span className={cn("truncate text-sm font-semibold", !note.title && !note.snippet && "text-muted-foreground/60")}>
            {note.title || note.snippet || "Ghi chú mới"}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 pr-6">
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatNoteDate(note.updatedAt)}
          </span>
          {note.locked ? (
            <span className="truncate text-xs text-muted-foreground/80 italic">
              Ghi chú đã khóa
            </span>
          ) : (
            note.snippet && (
              <span className="truncate text-xs text-muted-foreground/80">
                {note.snippet}
              </span>
            )
          )}
          {showFolder && (
            <span className="ml-auto shrink-0 rounded-md bg-black/5 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground dark:bg-white/10">
              {note.folderName}
            </span>
          )}
        </div>
      </button>

      {/* Row actions */}
      <div className="absolute top-2 right-1.5 opacity-0 transition-opacity group-hover/note:opacity-100 focus-within:opacity-100 max-md:opacity-100">
        <RowActions
          note={note}
          isTrash={isTrash}
          pinned={note.pinned}
          onPin={onPin}
          onTrash={onTrash}
          onRestore={onRestore}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

function RowActions({
  note,
  isTrash,
  pinned,
  onPin,
  onTrash,
  onRestore,
  onDelete,
}: {
  note: NoteListItem;
  isTrash: boolean;
  pinned: boolean;
  onPin: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const { toast } = useToast();

  const copyNote = async () => {
    try {
      const res = await fetch(`/api/notes/${note.id}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.locked) {
        toast({
          title: "Ghi chú đã khóa",
          description: "Hãy mở khóa ghi chú trước khi sao chép nội dung.",
          duration: 2500,
        });
        return;
      }
      const text = `${data.title || ""}\n\n${data.plainText || ""}`.trim();
      await navigator.clipboard.writeText(text);
      toast({
        title: "Đã sao chép",
        description: "Nội dung ghi chú đã được copy vào clipboard.",
        duration: 2000,
      });
    } catch {
      toast({
        title: "Không thể sao chép",
        description: "Vui lòng thử lại.",
        variant: "destructive",
      });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="rounded-md bg-background/80 p-1 shadow-sm ring-1 ring-black/5 backdrop-blur hover:bg-black/5 dark:bg-popover/80 dark:ring-white/10 dark:hover:bg-white/10"
          aria-label="Tùy chọn ghi chú"
        >
          <span className="sr-only">Tùy chọn</span>
          <MoreDot />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {isTrash ? (
          <>
            <DropdownMenuItem onClick={onRestore}>
              <RotateCcw className="size-4" /> Khôi phục
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
              <Trash2 className="size-4" /> Xóa vĩnh viễn
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onClick={copyNote}>
              <ClipboardCopy className="size-4" /> Sao chép nội dung
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onPin}>
              {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
              {pinned ? "Bỏ ghim" : "Ghim ghi chú"}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onTrash}>
              <Trash2 className="size-4" /> Xóa
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MoreDot() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="7" r="1.4" />
      <circle cx="7" cy="7" r="1.4" />
      <circle cx="11" cy="7" r="1.4" />
    </svg>
  );
}

/* ---------------- Gallery view ---------------- */

function GalleryView(props: {
  pinned: NoteListItem[];
  others: NoteListItem[];
  selectedNoteId: string | null;
  isTrash: boolean;
  onSelect: (id: string) => void;
}) {
  const action = useNoteAction();
  const runWithUndo = useRunWithUndo();
  const purgeNotes = usePurgeNotes();
  const filter = useOpenNoteStore((s) => s.filter);

  const renderCard = (n: NoteListItem) => (
    <NoteCard
      key={n.id}
      note={n}
      active={n.id === props.selectedNoteId}
      isTrash={props.isTrash}
      showFolder={filter.type !== "folder" || !!props.isTrash}
      onSelect={() => props.onSelect(n.id)}
      onPin={() =>
        void runWithUndo({
          label: n.pinned ? "Đã bỏ ghim ghi chú" : "Đã ghim ghi chú",
          action: () => action.patch(n.id, { pinned: !n.pinned }),
          undo: () => action.patch(n.id, { pinned: n.pinned }),
        })
      }
      onTrash={() =>
        void runWithUndo({
          label: "Đã chuyển ghi chú vào thùng rác",
          action: () => action.trash(n.id),
          undo: () => action.restore(n.id),
          selectBack: props.selectedNoteId === n.id ? n.id : null,
        })
      }
      onRestore={() =>
        void runWithUndo({
          label: "Đã khôi phục ghi chú",
          action: () => action.restore(n.id),
          undo: () =>
            action.patch(n.id, { deletedAt: n.deletedAt }),
        })
      }
      onDelete={() => { void purgeNotes([n.id], "Đã xóa vĩnh viễn ghi chú"); }}
    />
  );

  return (
    <div className="space-y-4 p-1">
      {props.pinned.length > 0 && (
        <div>
          <p className="px-1 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground/70 uppercase">
            Đã ghim
          </p>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            {props.pinned.map(renderCard)}
          </div>
        </div>
      )}
      {props.others.length > 0 && (
        <div>
          {props.pinned.length > 0 && (
            <p className="px-1 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground/70 uppercase">
              Ghi chú khác
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            {props.others.map(renderCard)}
          </div>
        </div>
      )}
    </div>
  );
}

function NoteCard({
  note,
  active,
  isTrash,
  showFolder,
  onSelect,
  onPin,
  onTrash,
  onRestore,
  onDelete,
}: {
  note: NoteListItem;
  active: boolean;
  isTrash: boolean;
  showFolder: boolean;
  onSelect: () => void;
  onPin: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group/note relative">
      <button
        className={cn(
          "flex h-32 w-full flex-col overflow-hidden rounded-xl border p-3 text-left transition-colors",
          active
            ? "border-amber-400/60 bg-amber-400/20 dark:bg-amber-400/10"
            : "border-black/5 bg-black/[0.02] hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.07]"
        )}
        onClick={onSelect}
      >
        <div className="flex items-center gap-1">
          {note.pinned && <Pin className="size-3 shrink-0 fill-amber-500 text-amber-500" />}
          {note.locked && <Lock className="size-3 shrink-0 text-muted-foreground" />}
          <span className={cn("truncate text-[13px] font-semibold", !note.title && !note.snippet && "text-muted-foreground/60")}>
            {note.title || note.snippet || "Ghi chú mới"}
          </span>
        </div>
        <span className="mt-1 line-clamp-3 flex-1 overflow-hidden text-[11px] leading-4 text-muted-foreground/80">
          {note.locked ? "Ghi chú đã khóa" : note.snippet || "\u00A0"}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {formatNoteDate(note.updatedAt)}
          </span>
          {showFolder && (
            <span className="ml-auto max-w-[45%] truncate rounded-md bg-black/5 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground dark:bg-white/10">
              {note.folderName}
            </span>
          )}
        </div>
      </button>
      <div className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover/note:opacity-100 focus-within:opacity-100 max-md:opacity-100">
        <RowActions
          note={note}
          isTrash={isTrash}
          pinned={note.pinned}
          onPin={onPin}
          onTrash={onTrash}
          onRestore={onRestore}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

/* ---------------- Empty state ---------------- */

function EmptyState({
  isTrash,
  searching,
}: {
  isTrash: boolean;
  searching: boolean;
}) {
  const createNote = useCreateNote();
  return (
    <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-black/5 dark:bg-white/5">
        {isTrash ? (
          <Trash2 className="size-7 text-muted-foreground/50" />
        ) : searching ? (
          <Search className="size-7 text-muted-foreground/50" />
        ) : (
          <CheckSquare className="size-7 text-muted-foreground/50" />
        )}
      </div>
      <p className="text-sm font-medium text-muted-foreground">
        {isTrash
          ? "Thùng rác trống"
          : searching
            ? "Không tìm thấy ghi chú nào"
            : "Chưa có ghi chú nào"}
      </p>
      {!isTrash && !searching && (
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={() => createNote.mutate()}
        >
          <SquarePen className="size-4" /> Tạo ghi chú đầu tiên
        </Button>
      )}
    </div>
  );
}
