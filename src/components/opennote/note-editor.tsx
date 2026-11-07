"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ClipboardCopy,
  Download,
  FileCode,
  FileJson,
  FileText,
  FolderInput,
  Info,
  ListChecks,
  Lock,
  LockOpen,
  MoreHorizontal,
  PanelLeftOpen,
  Printer,
  Redo2,
  RotateCcw,
  Share,
  SquarePen,
  Table as TableIcon,
  Trash2,
  Undo2,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { fileToInsertableDataUrl } from "@/lib/image-utils";
import { htmlToMarkdown } from "@/lib/html-to-markdown";
import {
  countWords,
  extractTagsClient,
  formatNoteDateLong,
} from "@/lib/opennote-utils";
import {
  useCreateNote,
  useExportAllNotes,
  useFolders,
  useNoteDetail,
  useNoteAction,
} from "./hooks";
import { usePurgeNotes, useRunWithUndo } from "./use-note-undo";
import { useOpenNoteStore } from "@/store/opennote-store";
import { sanitizeNoteHtml } from "@/lib/note-html";
import { fetchNote, RequestError } from "@/lib/note-request";
import type { NoteDetail } from "@/lib/opennote-types";
import { flushNoteDraft, forgetCommittedNote, loadAfterDiscard, registerOpenNoteRefresh, stageNoteDraft, useNoteDrafts } from "@/store/note-drafts";
import {
  FormatPopover,
  type FormatState,
  type FormatActions,
} from "./format-popover";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const TRASH_FOLDER_ID = "folder-trash-default";

/* ==================== Root ==================== */

export function NoteEditor() {
  const selectedNoteId = useOpenNoteStore((s) => s.selectedNoteId);

  if (!selectedNoteId) return <EditorEmpty />;
  return <EditorInner key={selectedNoteId} noteId={selectedNoteId} />;
}

function EditorEmpty() {
  const createNote = useCreateNote();
  const listCollapsed = useOpenNoteStore((s) => s.listCollapsed);
  const toggleListCollapsed = useOpenNoteStore((s) => s.toggleListCollapsed);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-background p-8 text-center">
      <div className="flex size-20 items-center justify-center rounded-3xl bg-black/5 dark:bg-white/5">
        <FileText className="size-9 text-muted-foreground/40" />
      </div>
      <div>
        <p className="text-lg font-semibold text-muted-foreground">Chưa chọn ghi chú</p>
        <p className="mt-1 text-sm text-muted-foreground/70">
          Chọn một ghi chú từ danh sách hoặc tạo ghi chú mới
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => createNote.mutate()}
          disabled={createNote.isPending}
        >
          <SquarePen className="size-4" /> Ghi chú mới
        </Button>
        {listCollapsed && (
          <Button
            variant="ghost"
            className="hidden rounded-full md:inline-flex"
            onClick={toggleListCollapsed}
          >
            <PanelLeftOpen className="size-4" /> Hiện danh sách ghi chú
          </Button>
        )}
      </div>
    </div>
  );
}

/* ==================== Editor inner ==================== */

function EditorInner({ noteId }: { noteId: string }) {
  const { data: note, isLoading, isFetching, isFetchedAfterMount, error: detailError, refetch } = useNoteDetail(noteId);
  const action = useNoteAction();
  const runWithUndo = useRunWithUndo();
  const purgeNotes = usePurgeNotes();
  const { toast } = useToast();
  const selectNote = useOpenNoteStore((s) => s.selectNote);
  const draft = useNoteDrafts((s) => s.drafts[noteId]);
  const committed = useNoteDrafts((s) => s.committed[noteId]);
  const paused = useNoteDrafts((s) => s.paused);
  const baseRef = useRef<Pick<NoteDetail, "revision" | "deletedAt" | "locked"> | null>(null);
  const markUnlocked = useOpenNoteStore((s) => s.markUnlocked);
  const clearUnlocked = useOpenNoteStore((s) => s.clearUnlocked);
  const listCollapsed = useOpenNoteStore((s) => s.listCollapsed);
  const toggleListCollapsed = useOpenNoteStore((s) => s.toggleListCollapsed);

  const editorRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const draggingInside = useRef(false);
  const savedRangeRef = useRef<Range | null>(null);
  /** last table cell the caret was in (kept for consecutive table ops) */
  const tableCellRef = useRef<HTMLTableCellElement | null>(null);
  const [title, setTitle] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);
  const saveState = draft?.status ?? "saved";
  const [format, setFormat] = useState<FormatState>({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    block: "p",
  });
  const [inTable, setInTable] = useState(false);
  const [lockDialog, setLockDialog] = useState(false);
  const [removeLockDialog, setRemoveLockDialog] = useState(false);
  const [unlockDialog, setUnlockDialog] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  /* ---------- Undo / Redo history (custom stack) ---------- */
  const histRef = useRef<{
    entries: { html: string; start: number; end: number }[];
    index: number;
    lastPush: number;
  }>({ entries: [], index: -1, lastPush: 0 });
  const [histAvail, setHistAvail] = useState({ undo: false, redo: false });

  const refreshHist = useCallback(() => {
    const h = histRef.current;
    setHistAvail({ undo: h.index > 0, redo: h.index < h.entries.length - 1 });
  }, []);

  /** Caret position as character offsets inside the editor's text */
  const caretOffsets = useCallback((): { start: number; end: number } => {
    const root = editorRef.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) {
      return { start: -1, end: -1 };
    }
    const range = sel.getRangeAt(0);
    const toOffset = (node: Node, off: number) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let pos = 0;
      let cur = walker.nextNode();
      while (cur) {
        if (cur === node) return pos + off;
        pos += cur.textContent?.length ?? 0;
        cur = walker.nextNode();
      }
      return pos;
    };
    return {
      start: toOffset(range.startContainer, range.startOffset),
      end: toOffset(range.endContainer, range.endOffset),
    };
  }, []);

  const setCaretOffsets = useCallback((start: number, end: number) => {
    const root = editorRef.current;
    const sel = window.getSelection();
    if (!root || !sel) return;
    const fromOffset = (target: number): { node: Node; offset: number } | null => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let pos = 0;
      let cur = walker.nextNode();
      while (cur) {
        const len = cur.textContent?.length ?? 0;
        if (target >= pos && target <= pos + len) return { node: cur, offset: target - pos };
        pos += len;
        cur = walker.nextNode();
      }
      return null;
    };
    try {
      if (start >= 0) {
        const s = fromOffset(start);
        const e = fromOffset(end) ?? s;
        if (s && e) {
          const range = document.createRange();
          range.setStart(s.node, s.offset);
          range.setEnd(e.node, e.offset);
          sel.removeAllRanges();
          sel.addRange(range);
          return;
        }
      }
    } catch {
      /* ignore → fallback below */
    }
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }, []);

  const snapshot = useCallback(
    (): { html: string; start: number; end: number } | null => {
      const el = editorRef.current;
      if (!el) return null;
      const c = caretOffsets();
      return { html: el.innerHTML, start: c.start, end: c.end };
    },
    [caretOffsets]
  );

  /** Push the current DOM state as a new history entry (drops the redo tail). */
  const commitHistory = useCallback(
    (force = false) => {
      const snap = snapshot();
      const h = histRef.current;
      if (!snap) return;
      if (!force && h.index >= 0 && h.entries[h.index]?.html === snap.html) {
        h.entries[h.index] = snap;
        h.lastPush = Date.now();
        refreshHist();
        return;
      }
      h.entries = h.entries.slice(0, h.index + 1);
      h.entries.push(snap);
      if (h.entries.length > 200) h.entries.splice(0, h.entries.length - 200);
      h.index = h.entries.length - 1;
      h.lastPush = Date.now();
      refreshHist();
    },
    [snapshot, refreshHist]
  );

  /** Keep the current entry in sync with the DOM (coalesce typing bursts). */
  const syncHistory = useCallback(() => {
    const snap = snapshot();
    const h = histRef.current;
    if (!snap || h.index < 0) return;
    h.entries[h.index] = snap;
  }, [snapshot]);

  const ready = !isFetching || isFetchedAfterMount;
  const isLocked = !!note?.locked && !note.revision;
  const inTrash = !!note?.deletedAt;
  const readOnly = paused || reloading || reloadFailed;

  const loadEditor = useCallback((fresh: NoteDetail) => {
    const editor = editorRef.current;
    if (!editor || !fresh.revision) return;
    const pending = useNoteDrafts.getState().drafts[noteId];
    editor.dataset.loaded = noteId;
    editor.innerHTML = sanitizeNoteHtml(pending?.body.content ?? fresh.content);
    setTitle(pending?.body.title ?? fresh.title);
    baseRef.current = pending?.base ?? fresh;
    histRef.current = {
      entries: [{ html: editor.innerHTML, start: -1, end: -1 }],
      index: 0,
      lastPush: 0,
    };
    refreshHist();
  }, [noteId, refreshHist]);

  if (!initialized && note) {
    setInitialized(true);
    setTitle(draft?.body.title ?? note.title);
  }

  useEffect(() => {
    if (ready && note && editorRef.current?.dataset.loaded !== noteId) loadEditor(note);
  }, [ready, note, noteId, loadEditor]);

  useEffect(() => {
    if (!committed) return;
    baseRef.current = committed;
    forgetCommittedNote(noteId);
  }, [committed, noteId]);

  const reloadEditor = useCallback(async (discard = false) => {
    setReloading(true);
    try {
      const fresh = discard ? await loadAfterDiscard(noteId) : await fetchNote(noteId);
      if (fresh?.revision) loadEditor(fresh);
      await refetch();
      setReloadFailed(false);
      return true;
    } catch {
      setReloadFailed(true);
      return false;
    } finally {
      setReloading(false);
    }
  }, [noteId, loadEditor, refetch]);

  useEffect(() => registerOpenNoteRefresh(noteId, async () =>
    editorRef.current ? reloadEditor() : true), [noteId, reloadEditor]);

  const getPlainText = useCallback(() => {
    const el = editorRef.current;
    return el ? el.innerText.replace(/\u200B/g, "").trim() : "";
  }, []);

  const normalizeBlocks = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    [...root.childNodes].forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
        const p = document.createElement("p");
        root.replaceChild(p, node);
        p.appendChild(node);
      }
    });
  }, []);

  const scheduleSave = useCallback(() => {
    const editor = editorRef.current;
    const input = titleRef.current;
    const base = baseRef.current;
    if (!editor || !input || !base || editor.dataset.loaded !== noteId || readOnly) return;
    stageNoteDraft(noteId, { title: input.value, content: editor.innerHTML, plainText: getPlainText() }, base);
  }, [noteId, getPlainText, readOnly]);

  useEffect(() => () => {
    void flushNoteDraft(noteId).catch(() => {});
  }, [noteId]);

  const draftNotice = (draft?.error || reloadFailed) && (
    <div role="alert" className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-sm">
      <span>{draft?.error ?? "Không tải được nội dung mới của ghi chú."}</span>
      {draft && (
        <Button size="sm" variant="outline" onClick={() => {
          void navigator.clipboard.writeText([draft.body.title, draft.body.plainText].join("\n\n"))
            .then(() => toast({ title: "Đã sao chép bản nháp" }))
            .catch(() => toast({ title: "Không sao chép được bản nháp", variant: "destructive" }));
        }}>Sao chép bản nháp</Button>
      )}
      {draft?.status === "error" && (
        <Button size="sm" variant="outline" onClick={() => {
          void flushNoteDraft(noteId).catch(() => {});
        }}>Thử lưu lại</Button>
      )}
      {(draft?.status === "conflict" || reloadFailed) && (
        <Button size="sm" variant="outline" onClick={() => {
          if (draft && !window.confirm("Bỏ bản sửa chưa lưu và tải nội dung mới?")) return;
          void reloadEditor(!!draft);
        }}>Tải bản mới</Button>
      )}
    </div>
  );

  /* ---------- Selection helpers ---------- */
  const saveSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  const restoreSelection = useCallback(() => {
    const sel = window.getSelection();
    if (
      sel &&
      savedRangeRef.current &&
      editorRef.current &&
      (!editorRef.current.contains(sel.anchorNode) || sel.rangeCount === 0)
    ) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
    editorRef.current?.focus();
  }, []);

  const findTable = useCallback((node: Node | null): HTMLTableElement | null => {
    let cur: Node | null = node;
    while (cur && cur !== editorRef.current) {
      if (cur instanceof HTMLTableElement) return cur;
      cur = cur.parentNode;
    }
    return null;
  }, []);

  const updateFormatState = useCallback(() => {
    try {
      const block = (document.queryCommandValue("formatBlock") || "p").toLowerCase();
      setFormat({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        strike: document.queryCommandState("strikeThrough"),
        block: block === "div" ? "p" : block,
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const handler = () => {
      const sel = window.getSelection();
      if (sel && editorRef.current?.contains(sel.anchorNode)) {
        updateFormatState();
        saveSelection();
        // remember the last table cell for consecutive table operations
        let cur: Node | null = sel.anchorNode;
        while (cur && cur !== editorRef.current) {
          if (cur instanceof HTMLTableCellElement) {
            tableCellRef.current = cur;
            break;
          }
          cur = cur.parentNode;
        }
        setInTable(!!findTable(sel.anchorNode));
      }
    };
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, [updateFormatState, saveSelection, findTable]);

  /* ---------- Undo / redo actions & input tracking ---------- */

  const handleEditorInput = useCallback(() => {
    scheduleSave();
    const h = histRef.current;
    if (Date.now() - h.lastPush > 600) commitHistory();
    else syncHistory();
  }, [scheduleSave, commitHistory, syncHistory]);

  const applyHistory = useCallback(
    (entry: { html: string; start: number; end: number }) => {
      const el = editorRef.current;
      if (!el) return;
      el.innerHTML = entry.html;
      setCaretOffsets(entry.start, entry.end);
      updateFormatState();
      refreshHist();
      scheduleSave();
    },
    [setCaretOffsets, updateFormatState, refreshHist, scheduleSave]
  );

  const handleUndo = useCallback(() => {
    const h = histRef.current;
    if (h.index <= 0) return;
    h.index -= 1;
    applyHistory(h.entries[h.index]);
  }, [applyHistory]);

  const handleRedo = useCallback(() => {
    const h = histRef.current;
    if (h.index < 0 || h.index >= h.entries.length - 1) return;
    h.index += 1;
    applyHistory(h.entries[h.index]);
  }, [applyHistory]);

  /* ---------- Commands ---------- */
  const exec = useCallback(
    (cmd: string, value?: string) => {
      restoreSelection();
      commitHistory(true);
      normalizeBlocks();
      try {
        document.execCommand("styleWithCSS", false, "true");
      } catch {
        /* ignore */
      }
      document.execCommand(cmd, false, value);
      syncHistory();
      updateFormatState();
      scheduleSave();
    },
    [restoreSelection, commitHistory, normalizeBlocks, syncHistory, updateFormatState, scheduleSave]
  );

  const setBlock = useCallback((tag: string) => exec("formatBlock", `<${tag}>`), [exec]);

  const setList = useCallback(
    (type: "bullet" | "number" | "dash") => {
      restoreSelection();
      commitHistory(true);
      const closestTag = (node: Node | null, tag: string): HTMLElement | null => {
        let cur: Node | null = node;
        while (cur && cur !== editorRef.current) {
          if (cur instanceof HTMLElement && cur.tagName.toLowerCase() === tag) return cur;
          cur = cur.parentNode;
        }
        return null;
      };
      const sel = window.getSelection();
      if (type === "number") {
        document.execCommand("insertOrderedList");
      } else {
        const ul = closestTag(sel?.anchorNode ?? null, "ul");
        if (ul) {
          if (type === "dash" && !ul.classList.contains("dashed")) {
            ul.classList.add("dashed");
          } else if (type === "bullet" && ul.classList.contains("dashed")) {
            ul.classList.remove("dashed");
          } else {
            document.execCommand("insertUnorderedList"); // toggle off
          }
        } else {
          document.execCommand("insertUnorderedList");
          const ul2 = closestTag(window.getSelection()?.anchorNode ?? null, "ul");
          if (type === "dash" && ul2) ul2.classList.add("dashed");
        }
      }
      syncHistory();
      scheduleSave();
    },
    [restoreSelection, commitHistory, syncHistory, scheduleSave]
  );

  const insertChecklist = useCallback(() => {
    restoreSelection();
    commitHistory(true);
    document.execCommand(
      "insertHTML",
      false,
      '<ul class="taskList"><li class="taskItem"><span class="taskCb" contenteditable="false"></span><br></li></ul>'
    );
    syncHistory();
    scheduleSave();
  }, [restoreSelection, commitHistory, syncHistory, scheduleSave]);

  /* Keyboard: undo/redo shortcuts, markdown-style list conversion
     ("1." / "-" + Space → list), and Enter inside checklist items
     (browsers fail to clone the non-editable checkbox span, so we
     build the new item manually). */
  const handleEditorKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const sel = window.getSelection();

      /* Undo / redo shortcuts */
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "z") {
          e.preventDefault();
          if (e.shiftKey) handleRedo();
          else handleUndo();
          return;
        }
        if (k === "y") {
          e.preventDefault();
          handleRedo();
          return;
        }
      }

      /* Auto-convert "1." / "1)" / "-" / "*" + Space into a list */
      if (
        e.key === " " &&
        !e.ctrlKey &&
        !e.metaKey &&
        sel &&
        sel.isCollapsed &&
        sel.rangeCount > 0 &&
        editorRef.current?.contains(sel.anchorNode)
      ) {
        let block: HTMLElement | null = null;
        let cur: Node | null = sel.anchorNode;
        while (cur && cur !== editorRef.current) {
          if (cur instanceof HTMLElement && /^(P|H1|H2|H3|DIV|BLOCKQUOTE)$/.test(cur.tagName)) {
            block = cur;
            break;
          }
          cur = cur.parentNode;
        }
        if (!block && editorRef.current) {
          // The caret sits in loose content directly under the editor root
          // (typical for the first line of a fresh note, before any block
          // wrapper exists). Wrap that top-level node into a <p> so the
          // conversion below has a proper block to turn into a list.
          const root = editorRef.current;
          let top: Node | null = sel.anchorNode;
          while (top && top.parentNode !== root) top = top.parentNode;
          if (top && top !== root) {
            // Remember the exact caret boundary with raw values: removing a
            // node from the DOM also rewrites every Range that points into
            // it (DOM spec), so even a cloned Range would get clamped to
            // the removal point. After the wrap we rebuild the caret from
            // (anchorNode, anchorOffset), which stays valid because the
            // node moves back into the document inside the new <p>.
            const anchor = sel.anchorNode;
            const anchorOffset = sel.anchorOffset;
            let wrapped = false;
            if (top instanceof HTMLElement) {
              const tag = top.tagName;
              if (/^(P|H1|H2|H3|DIV|BLOCKQUOTE)$/.test(tag)) {
                block = top;
              } else if (!/^(UL|OL|TABLE|LI)$/.test(tag)) {
                // loose inline element (e.g. <b>) → wrap in <p>
                const p = document.createElement("p");
                root.replaceChild(p, top);
                p.appendChild(top);
                block = p;
                wrapped = true;
              }
            } else if (top.nodeType === Node.TEXT_NODE) {
              // loose text node → wrap in <p>
              const p = document.createElement("p");
              root.replaceChild(p, top);
              p.appendChild(top);
              block = p;
              wrapped = true;
            }
            if (wrapped && anchor) {
              try {
                const r = document.createRange();
                r.setStart(anchor, anchorOffset);
                r.collapse(true);
                sel.removeAllRanges();
                sel.addRange(r);
              } catch {
                /* ignore */
              }
            }
          }
        }
        if (block && !block.closest("li, ol, ul")) {
          const range = sel.getRangeAt(0);
          const pre = document.createRange();
          pre.selectNodeContents(block);
          pre.setEnd(range.startContainer, range.startOffset);
          const post = document.createRange();
          post.selectNodeContents(block);
          post.setStart(range.startContainer, range.startOffset);
          const marker = pre.toString().replace(/\u200B/g, "").trim();
          const rest = post.toString().replace(/\u200B/g, "").trim();
          const type =
            rest || marker === ""
              ? null // only convert when the marker is the sole content of the block
              : /^1[.)]$/.test(marker)
                ? "number"
                : /^[-–]$/.test(marker)
                  ? "dash"
                  : /^[*•]$/.test(marker)
                    ? "bullet"
                    : null;
          if (type) {
            e.preventDefault();
            commitHistory(true);
            const list = document.createElement(type === "number" ? "ol" : "ul");
            if (type === "dash") list.classList.add("dashed");
            const li = document.createElement("li");
            li.innerHTML = "<br>";
            list.appendChild(li);
            block.replaceWith(list);
            const r2 = document.createRange();
            r2.selectNodeContents(li);
            r2.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r2);
            updateFormatState();
            syncHistory();
            scheduleSave();
            return;
          }
        }
      }

      /* Checklist Enter handling */
      if (e.key !== "Enter" || e.shiftKey) return;
      if (!sel || !editorRef.current?.contains(sel.anchorNode)) return;
      let li: HTMLElement | null = null;
      let cur2: Node | null = sel.anchorNode;
      while (cur2 && cur2 !== editorRef.current) {
        if (cur2 instanceof HTMLElement && cur2.tagName === "LI" && cur2.classList.contains("taskItem")) {
          li = cur2;
          break;
        }
        cur2 = cur2.parentNode;
      }
      if (!li) return;
      e.preventDefault();
      commitHistory(true);

      if (!li.textContent?.trim()) {
        // Empty item → leave the checklist
        const ul = li.closest("ul");
        const p = document.createElement("p");
        p.innerHTML = "<br>";
        (ul || li).after(p);
        li.remove();
        if (ul && !ul.querySelector("li")) ul.remove();
        const range = document.createRange();
        range.selectNodeContents(p);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        // Create the next item with its own checkbox
        const newLi = document.createElement("li");
        newLi.className = "taskItem";
        newLi.innerHTML = '<span class="taskCb" contenteditable="false"></span><br>';
        li.after(newLi);
        const range = document.createRange();
        range.setStart(newLi, 1);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      syncHistory();
      scheduleSave();
    },
    [handleRedo, handleUndo, commitHistory, syncHistory, updateFormatState, scheduleSave]
  );

  const insertTable = useCallback(() => {
    restoreSelection();
    commitHistory(true);
    document.execCommand(
      "insertHTML",
      false,
      '<table class="noteTable"><tbody><tr><td><br></td><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td><td><br></td></tr></tbody></table><p><br></p>'
    );
    // Đặt caret vào ô đầu tiên ngay lập tức để thanh điều khiển bảng
    // hiện ra luôn (không phải chờ người dùng bấm vào ô)
    const firstCell = editorRef.current?.querySelector<HTMLTableCellElement>(
      "table.noteTable:last-of-type td"
    );
    const table = editorRef.current?.querySelector<HTMLTableElement>(
      "table.noteTable:last-of-type"
    );
    if (firstCell && table) {
      const sel = window.getSelection();
      const r = document.createRange();
      r.selectNodeContents(firstCell);
      r.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(r);
      tableCellRef.current = firstCell;
      setInTable(true);
      saveSelection();
    }
    syncHistory();
    scheduleSave();
  }, [restoreSelection, commitHistory, saveSelection, syncHistory, scheduleSave]);

  const insertSafeHtml = useCallback(
    (html: string) => {
      if (!editorRef.current?.isContentEditable || useNoteDrafts.getState().paused) return;
      restoreSelection();
      commitHistory(true);
      document.execCommand("insertHTML", false, sanitizeNoteHtml(html));
      syncHistory();
      scheduleSave();
    },
    [restoreSelection, commitHistory, syncHistory, scheduleSave]
  );

  /** Nén/thu nhỏ rồi chèn lần lượt nhiều file ảnh (dán, kéo-thả, chọn file) */
  const insertImageFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      for (const file of images) {
        try {
          const dataUrl = await fileToInsertableDataUrl(file);
          insertSafeHtml(`<img src="${dataUrl}" alt="Ảnh trong ghi chú" />`);
        } catch {
          toast({
            title: "Không chèn được ảnh",
            description: "Tệp ảnh không hợp lệ hoặc quá lớn.",
            variant: "destructive",
            duration: 3000,
          });
        }
      }
    },
    [insertSafeHtml, toast]
  );

  const formatActions: FormatActions = {
    setBlock,
    toggleInline: (cmd) => exec(cmd),
    setList,
    setQuote: () => exec("formatBlock", "<blockquote>"),
    insertDivider: () => exec("insertHorizontalRule"),
    setTextColor: (color) => exec("foreColor", color || "#000000"),
    setHighlight: (color) => exec("hiliteColor", color || "transparent"),
  };

  /* ---------- Checkbox toggle ---------- */
  const handleEditorClick = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly) return;
      const target = e.target as HTMLElement;
      if (target.closest(".taskCb")) {
        e.preventDefault();
        const li = target.closest("li.taskItem");
        if (li) {
          commitHistory(true);
          li.classList.toggle("checked");
          syncHistory();
          scheduleSave();
        }
      }
    },
    [commitHistory, syncHistory, scheduleSave, readOnly]
  );

  /* ---------- Paste / drag-drop images ---------- */
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files || []);
      if (files.some((f) => f.type.startsWith("image/"))) {
        e.preventDefault();
        void insertImageFiles(files);
        return;
      }
      const html = e.clipboardData.getData("text/html");
      if (html) {
        e.preventDefault();
        insertSafeHtml(html);
      }
    },
    [insertImageFiles, insertSafeHtml]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (Array.from(e.dataTransfer?.types || []).includes("Files")) {
      e.preventDefault();
      setDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.target === e.currentTarget) setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const files = Array.from(e.dataTransfer.files);
      if (files.some((f) => f.type.startsWith("image/"))) {
        e.preventDefault();
        setDragOver(false);
        void insertImageFiles(files);
        return;
      }
      const html = e.dataTransfer.getData("text/html");
      if (html && !draggingInside.current) {
        e.preventDefault();
        const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
        if (range && editorRef.current?.contains(range.startContainer)) {
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          savedRangeRef.current = range;
        }
        insertSafeHtml(html);
      }
      draggingInside.current = false;
    },
    [insertImageFiles, insertSafeHtml]
  );

  /* ---------- Title enter → focus editor ---------- */
  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const editor = editorRef.current;
      if (editor) {
        editor.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }, []);

  /* ---------- Table mutation ---------- */
  const mutateTable = useCallback(
    (op: "addRow" | "addCol" | "removeRow" | "removeCol" | "removeTable") => {
      // Prefer the current selection; fall back to the last table cell
      // (a previous op like removeRow can drop the caret outside the table)
      const sel = window.getSelection();
      let cell: HTMLTableCellElement | null = null;
      if (sel?.anchorNode && editorRef.current?.contains(sel.anchorNode)) {
        let cur: Node | null = sel.anchorNode;
        while (cur && cur !== editorRef.current) {
          if (cur instanceof HTMLTableCellElement) {
            cell = cur;
            break;
          }
          cur = cur.parentNode;
        }
      }
      if (!cell && tableCellRef.current && editorRef.current?.contains(tableCellRef.current)) {
        cell = tableCellRef.current;
      }
      if (!cell) return;
      const row = cell.parentElement as HTMLTableRowElement | null;
      const table = findTable(cell);
      if (!row || !table) return;
      commitHistory(true);

      if (op === "addRow") {
        const tr = document.createElement("tr");
        for (let i = 0; i < row.children.length; i++) {
          const td = document.createElement("td");
          td.innerHTML = "<br>";
          tr.appendChild(td);
        }
        row.after(tr);
      } else if (op === "removeRow") {
        if (table.rows.length > 1) row.remove();
        else table.remove();
      } else if (op === "addCol") {
        const idx = Array.from(row.children).indexOf(cell);
        Array.from(table.rows).forEach((r) => {
          const td = document.createElement("td");
          td.innerHTML = "<br>";
          if (idx >= 0 && idx < r.children.length) r.children[idx].after(td);
          else r.appendChild(td);
        });
      } else if (op === "removeCol") {
        const idx = Array.from(row.children).indexOf(cell);
        if (row.children.length <= 1) {
          table.remove();
        } else {
          Array.from(table.rows).forEach((r) => {
            if (r.children[idx]) r.children[idx].remove();
          });
        }
      } else if (op === "removeTable") {
        const p = document.createElement("p");
        p.innerHTML = "<br>";
        table.after(p);
        table.remove();
        tableCellRef.current = null;
        setInTable(false);
        syncHistory();
        scheduleSave();
        return;
      }
      // Put the caret back inside the table so consecutive ops keep working
      const firstCell = table.rows[0]?.cells[0];
      if (firstCell) {
        tableCellRef.current = firstCell;
        const r = document.createRange();
        r.selectNodeContents(firstCell);
        r.collapse(true);
        const s2 = window.getSelection();
        s2?.removeAllRanges();
        s2?.addRange(r);
        setInTable(true);
      } else {
        tableCellRef.current = null;
        setInTable(false);
      }
      syncHistory();
      scheduleSave();
    },
    [findTable, commitHistory, syncHistory, scheduleSave]
  );

  /* ---------- Render: loading / missing ---------- */
  if (isLoading || !ready) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!note || (detailError instanceof RequestError && detailError.status === 404)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-background p-8 text-center">
        <FileText className="size-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Không tìm thấy ghi chú</p>
        {draftNotice}
      </div>
    );
  }

  /* ---------- Render: lock screen ---------- */
  if (isLocked) {
    return (
      <div className="flex h-full flex-col bg-background">
        <header className="flex shrink-0 items-center gap-1 px-2 py-1.5 md:px-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-lg md:hidden"
            aria-label="Quay lại danh sách"
            onClick={() => selectNote(null)}
          >
            <ArrowLeft className="size-5" />
          </Button>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-lg"
            aria-label="Thêm tùy chọn"
          >
            <MoreHorizontal className="size-5" />
          </Button>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-amber-500/15">
            <Lock className="size-7 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="text-center">
            <p className="font-semibold">Ghi chú này đã bị khóa</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Nhập mã PIN để xem nội dung
            </p>
          </div>
          <Button
            className="rounded-full bg-amber-500 text-amber-950 hover:bg-amber-400"
            onClick={() => setUnlockDialog(true)}
          >
            <LockOpen className="size-4" /> Mở khóa
          </Button>
        </div>

        {draftNotice}
        <UnlockDialog
          open={unlockDialog}
          onOpenChange={setUnlockDialog}
          noteId={noteId}
          onUnlocked={(token) => markUnlocked(noteId, token)}
          unlock={action.unlock}
        />
      </div>
    );
  }

  /* ---------- Render: main editor ---------- */
  return (
    <div className="flex h-full min-w-0 flex-col bg-background print-area">
      <EditorTopBar
        noteId={noteId}
        inTrash={inTrash}
        pinned={note.pinned}
        saveState={saveState}
        readOnly={readOnly}
        title={title}
        noteUpdatedAt={note.updatedAt}
        noteCreatedAt={note.createdAt}
        folderId={note.folderId}
        onPin={() =>
          void runWithUndo({
            label: note.pinned ? "Đã bỏ ghim ghi chú" : "Đã ghim ghi chú",
            action: () => action.patch(noteId, { pinned: !note.pinned }),
            undo: () => action.patch(noteId, { pinned: note.pinned }),
          })
        }
        onTrash={() =>
          void runWithUndo({
            label: "Đã chuyển ghi chú vào thùng rác",
            action: () => action.trash(noteId),
            undo: () => action.restore(noteId),
            selectBack: noteId,
          })
        }
        onRestore={() =>
          void runWithUndo({
            label: "Đã khôi phục ghi chú",
            action: () => action.restore(noteId),
            undo: () =>
              action.patch(noteId, { deletedAt: note.deletedAt }),
            selectBack: noteId,
          })
        }
        onDeleteForever={() => { void purgeNotes([noteId], "Đã xóa vĩnh viễn ghi chú"); }}
        onLock={() => {
          if (!note.locked) setLockDialog(true);
          else void action.relock(noteId).catch((e: Error) => toast({ title: e.message, variant: "destructive" }));
        }}
        onRemoveLock={() => setRemoveLockDialog(true)}
        onChecklist={insertChecklist}
        onTable={insertTable}
        onImage={() => imageInputRef.current?.click()}
        onInfo={() => setInfoOpen(true)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={histAvail.undo}
        canRedo={histAvail.redo}
        listHidden={listCollapsed}
        onToggleList={toggleListCollapsed}
        formatState={format}
        formatActions={formatActions}
      />

      {draftNotice}
      {inTrash && (
        <div className="flex items-center gap-2 border-b bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-300 md:px-8">
          <Trash2 className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            Ghi chú này đang ở trong “Đã xóa gần đây”
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0 rounded-full bg-background"
            onClick={() => void action.restore(noteId).catch((e: Error) => toast({ title: e.message, variant: "destructive" }))}
          >
            <RotateCcw className="size-3.5" /> Khôi phục
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 pt-6 pb-32 md:px-8 md:pt-8">
          <p className="mb-3 text-center text-[11px] text-muted-foreground/70">
            {note.updatedAt ? formatNoteDateLong(note.updatedAt) : ""}
          </p>
          <input
            ref={titleRef}
            readOnly={readOnly}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              scheduleSave();
            }}
            onKeyDown={handleTitleKeyDown}
            placeholder="Tiêu đề"
            aria-label="Tiêu đề ghi chú"
            className="w-full border-none bg-transparent text-2xl font-bold tracking-tight outline-none placeholder:text-muted-foreground/40 md:text-[28px]"
          />
          <div
            ref={editorRef}
            contentEditable={!readOnly}
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Nội dung ghi chú"
            data-placeholder="Bắt đầu viết…"
            className={cn(
              "note-editor mt-2 min-h-[50vh] text-[15px] leading-relaxed",
              dragOver &&
                "outline-2 outline-dashed outline-amber-400/70 outline-offset-8"
            )}
            onInput={handleEditorInput}
            onKeyUp={saveSelection}
            onMouseUp={saveSelection}
            onClick={handleEditorClick}
            onKeyDown={handleEditorKeyDown}
            onPaste={handlePaste}
            onDragStart={() => { draggingInside.current = true; }}
            onDragEnd={() => { draggingInside.current = false; }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onBlur={saveSelection}
          />

          {inTable && !readOnly && (
            <div className="sticky bottom-4 mx-auto mt-4 flex w-fit items-center gap-0.5 rounded-full border bg-popover/95 p-1 shadow-lg backdrop-blur">
              <TableCtlButton label="+ Hàng" title="Thêm hàng dưới" onClick={() => mutateTable("addRow")} />
              <TableCtlButton label="+ Cột" title="Thêm cột phải" onClick={() => mutateTable("addCol")} />
              <TableCtlButton label="− Hàng" title="Bớt một hàng" onClick={() => mutateTable("removeRow")} />
              <TableCtlButton label="− Cột" title="Bớt một cột" onClick={() => mutateTable("removeCol")} />
              <TableCtlButton label="Xóa bảng" title="Xóa bảng" danger onClick={() => mutateTable("removeTable")} />
            </div>
          )}
        </div>
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) void insertImageFiles(files);
          e.target.value = "";
        }}
      />

      <LockDialog
        open={lockDialog}
        onOpenChange={setLockDialog}
        onLocked={() => clearUnlocked(noteId)}
        lockNote={action.lock}
        noteId={noteId}
      />
      <UnlockDialog
        open={unlockDialog}
        onOpenChange={setUnlockDialog}
        noteId={noteId}
        onUnlocked={(token) => markUnlocked(noteId, token)}
        unlock={action.unlock}
      />
      <RemoveLockDialog
        open={removeLockDialog}
        onOpenChange={setRemoveLockDialog}
        noteId={noteId}
        onRemoved={() => clearUnlocked(noteId)}
        removeLock={action.removeLock}
      />
      <InfoDialog
        open={infoOpen}
        onOpenChange={setInfoOpen}
        getPlainText={getPlainText}
        folderId={note.folderId}
        createdAt={note.createdAt}
        updatedAt={note.updatedAt}
      />
    </div>
  );
}

/* ==================== Top toolbar ==================== */

interface EditorTopBarProps {
  noteId: string;
  inTrash: boolean;
  pinned: boolean;
  saveState: "saved" | "dirty" | "saving" | "error" | "conflict";
  readOnly: boolean;
  title: string;
  noteCreatedAt: string;
  noteUpdatedAt: string;
  folderId: string;
  onPin: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDeleteForever: () => void;
  onLock: () => void;
  onRemoveLock: () => void;
  onChecklist: () => void;
  onTable: () => void;
  onImage: () => void;
  onInfo: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** cột danh sách đang bị ẩn (focus mode) */
  listHidden: boolean;
  onToggleList: () => void;
  formatState: FormatState;
  formatActions: FormatActions;
}

function EditorTopBar(props: EditorTopBarProps) {
  const {
    noteId,
    inTrash,
    pinned,
    onPin,
    onTrash,
    onRestore,
    onDeleteForever,
    onLock,
    onRemoveLock,
    onChecklist,
    onTable,
    onImage,
    onInfo,
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    listHidden,
    onToggleList,
    formatState,
    formatActions,
    title,
  } = props;
  const { toast } = useToast();
  const selectNote = useOpenNoteStore((s) => s.selectNote);
  const { data: foldersData } = useFolders();
  const action = useNoteAction();
  const runWithUndo = useRunWithUndo();
  const { exportNotes, exporting } = useExportAllNotes();
  const folders = (foldersData?.folders || []).filter((f) => f.id !== TRASH_FOLDER_ID);

  /** Lưu nội dung văn bản/md thành tệp tải về */
  const saveFile = (text: string, ext: string, mime: string) => {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName =
      title
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
        .trim()
        .replace(/\s+/g, "-") || "ghi-chu";
    a.href = url;
    a.download = `${safeName}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadTxt = () => {
    const editor = document.querySelector<HTMLElement>(".note-editor");
    const text = `${title}\n\n${editor?.innerText || ""}`.trim();
    saveFile(text, "txt", "text/plain;charset=utf-8");
  };

  const downloadMd = () => {
    const editor = document.querySelector<HTMLElement>(".note-editor");
    const body = htmlToMarkdown(editor?.innerHTML || "");
    const text = `${title ? `# ${title}\n\n` : ""}${body}`.trim() + "\n";
    saveFile(text, "md", "text/markdown;charset=utf-8");
  };

  return (
    <TooltipProvider delayDuration={300}>
      <header className="flex shrink-0 items-center gap-0.5 overflow-x-auto px-2 py-1.5 md:px-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 rounded-lg md:hidden"
          aria-label="Quay lại danh sách"
          onClick={() => selectNote(null)}
        >
          <ArrowLeft className="size-5" />
        </Button>

        <div className="flex-1" />

        {/* Khi cột danh sách đang ẩn: nút mở lại danh sách (desktop).
            Nút ẩn danh sách đã chuyển vào khung danh sách ghi chú. */}
        {listHidden && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hidden size-9 shrink-0 rounded-lg md:inline-flex"
                aria-label="Hiện danh sách ghi chú"
                onClick={onToggleList}
              >
                <PanelLeftOpen className="size-[18px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Hiện danh sách ghi chú</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 shrink-0 rounded-lg"
              aria-label="Hoàn tác"
              disabled={!canUndo || props.readOnly}
              onClick={onUndo}
            >
              <Undo2 className="size-[18px]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Hoàn tác</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 shrink-0 rounded-lg"
              aria-label="Làm lại"
              disabled={!canRedo || props.readOnly}
              onClick={onRedo}
            >
              <Redo2 className="size-[18px]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Làm lại</TooltipContent>
        </Tooltip>

        {props.saveState === "saving" && (
          <span className="mr-1 hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
            <Loader2 className="size-3 animate-spin" /> Đang lưu
          </span>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 rounded-lg"
              aria-label="Chèn bảng"
              disabled={props.readOnly}
              onClick={onTable}
            >
              <TableIcon className="size-[18px]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Bảng</TooltipContent>
        </Tooltip>

        <FormatPopover state={formatState} actions={formatActions}>
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-lg font-bold"
            disabled={props.readOnly}
            aria-label="Định dạng văn bản"
          >
            <span className="text-[15px]">Aa</span>
          </Button>
        </FormatPopover>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 rounded-lg"
              aria-label="Danh sách công việc"
              disabled={props.readOnly}
              onClick={onChecklist}
            >
              <ListChecks className="size-[18px]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Danh sách công việc</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 rounded-lg"
              aria-label="Chèn ảnh"
              disabled={props.readOnly}
              onClick={onImage}
            >
              <ImageIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Chèn ảnh</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 rounded-lg"
              aria-label="Chia sẻ"
            >
              <Share className="size-[18px]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem
              onClick={async () => {
                const editor = document.querySelector<HTMLElement>(".note-editor");
                const text = `${title}\n\n${editor?.innerText || ""}`.trim();
                try {
                  await navigator.clipboard.writeText(text);
                  toast({
                    title: "Đã sao chép",
                    description: "Nội dung ghi chú đã được copy vào clipboard.",
                    duration: 2000,
                  });
                } catch {
                  toast({
                    title: "Không thể sao chép",
                    description: "Trình duyệt đang chặn quyền truy cập clipboard.",
                    variant: "destructive",
                  });
                }
              }}
            >
              <ClipboardCopy className="size-4" /> Sao chép văn bản
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.print()}>
              <Printer className="size-4" /> In ghi chú
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Tải xuống: ghi chú hiện tại + sao lưu toàn bộ */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 shrink-0 rounded-lg"
              aria-label="Tải xuống"
              disabled={exporting}
            >
              {exporting ? (
                <Loader2 className="size-[18px] animate-spin" />
              ) : (
                <Download className="size-[18px]" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={downloadMd}>
              <FileCode className="size-4" /> Tải ghi chú này (.md)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={downloadTxt}>
              <FileText className="size-4" /> Tải ghi chú này (.txt)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => exportNotes("json")}>
              <FileJson className="size-4" /> Sao lưu toàn bộ (.json)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportNotes("txt")}>
              <Download className="size-4" /> Xuất toàn bộ (.txt)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportNotes("md")}>
              <FileCode className="size-4" /> Xuất toàn bộ (.md)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 rounded-lg"
              aria-label="Thêm tùy chọn"
            >
              <MoreHorizontal className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={onPin}>
              {pinned ? <PinOff2 /> : <Pin2 />}
              {pinned ? "Bỏ ghim ghi chú" : "Ghim ghi chú"}
            </DropdownMenuItem>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <FolderInput className="size-4" /> Di chuyển đến
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                {folders.map((f) => (
                  <DropdownMenuItem
                    key={f.id}
                    onClick={() =>
                      void runWithUndo({
                        label: `Đã chuyển đến “${f.name}”`,
                        action: () => action.patch(noteId, { folderId: f.id }),
                        undo: () => action.patch(noteId, { folderId: props.folderId }),
                      })
                    }
                  >
                    {f.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuItem onClick={onLock}>
              <Lock className="size-4" /> Khóa ghi chú
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRemoveLock}>
              <LockOpen className="size-4" /> Tắt khóa ghi chú
            </DropdownMenuItem>

            <DropdownMenuItem onClick={onInfo}>
              <Info className="size-4" /> Thông tin ghi chú
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {inTrash ? (
              <>
                <DropdownMenuItem onClick={onRestore}>
                  <RotateCcw className="size-4" /> Khôi phục
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={onDeleteForever}
                >
                  <Trash2 className="size-4" /> Xóa vĩnh viễn
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={onTrash}
              >
                <Trash2 className="size-4" /> Xóa
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
    </TooltipProvider>
  );
}

function Pin2() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" x2="12" y1="17" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </svg>
  );
}

function PinOff2() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" x2="12" y1="17" y2="22" />
      <path d="M9 9V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1" />
      <path d="M15 11v-.76a2 2 0 0 1 1.11-1.79l1.78-.9A2 2 0 0 0 19 5.76V5" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

function TableCtlButton({
  label,
  title,
  onClick,
  danger,
}: {
  label: string;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/10",
        danger && "text-destructive hover:bg-destructive/10 dark:hover:bg-destructive/20"
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/* ==================== Lock / unlock dialogs ==================== */

function LockDialog({
  open,
  onOpenChange,
  onLocked,
  lockNote,
  noteId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onLocked: () => void;
  lockNote: (id: string, pin: string) => Promise<void>;
  noteId: string;
}) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!/^\d{4,8}$/.test(pin)) {
      setError("Mã PIN gồm 4–8 chữ số");
      return;
    }
    if (pin !== confirmPin) {
      setError("Mã PIN nhập lại không khớp");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await lockNote(noteId, pin);
      onLocked();
      onOpenChange(false);
      setPin("");
      setConfirmPin("");
    } catch {
      setError("Không khóa được ghi chú");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="size-4 text-amber-600" /> Khóa ghi chú
          </DialogTitle>
          <DialogDescription>
            Đặt mã PIN để bảo vệ ghi chú này. Bạn sẽ cần nhập mã mỗi khi mở khóa.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="lock-pin">Mã PIN (4–8 chữ số)</Label>
            <Input
              id="lock-pin"
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lock-pin-confirm">Nhập lại mã PIN</Label>
            <Input
              id="lock-pin-confirm"
              inputMode="numeric"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button
            className="bg-amber-500 text-amber-950 hover:bg-amber-400"
            onClick={submit}
            disabled={busy}
          >
            {busy ? "Đang khóa…" : "Khóa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnlockDialog({
  open,
  onOpenChange,
  noteId,
  onUnlocked,
  unlock,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  noteId: string;
  onUnlocked: (token: string) => void;
  unlock: (id: string, pin: string) => Promise<{ accessToken: string }>;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!pin) return;
    setBusy(true);
    setError("");
    try {
      const res = await unlock(noteId, pin);
      onUnlocked(res.accessToken);
      onOpenChange(false);
      setPin("");
    } catch {
      setError("Mã PIN không đúng");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LockOpen className="size-4 text-amber-600" /> Mở khóa ghi chú
          </DialogTitle>
          <DialogDescription>Nhập mã PIN của ghi chú này.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-1">
          <Input
            inputMode="numeric"
            autoFocus
            type="password"
            value={pin}
            placeholder="Mã PIN"
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            aria-label="Mã PIN"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button
            className="bg-amber-500 text-amber-950 hover:bg-amber-400"
            onClick={submit}
            disabled={busy || !pin}
          >
            {busy ? "Đang mở…" : "Mở khóa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveLockDialog({
  open,
  onOpenChange,
  noteId,
  onRemoved,
  removeLock,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  noteId: string;
  onRemoved: () => void;
  removeLock: (id: string, pin: string) => Promise<void>;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!pin) return;
    setBusy(true);
    setError("");
    try {
      await removeLock(noteId, pin);
      onRemoved();
      onOpenChange(false);
      setPin("");
    } catch {
      setError("Mã PIN không đúng");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Tắt khóa ghi chú</DialogTitle>
          <DialogDescription>
            Nhập mã PIN hiện tại để gỡ khóa vĩnh viễn.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-1">
          <Input
            inputMode="numeric"
            autoFocus
            type="password"
            value={pin}
            placeholder="Mã PIN"
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            aria-label="Mã PIN hiện tại"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={submit} disabled={busy || !pin}>
            {busy ? "Đang xử lý…" : "Tắt khóa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ==================== Info dialog ==================== */

function InfoDialog({
  open,
  onOpenChange,
  getPlainText,
  folderId,
  createdAt,
  updatedAt,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  getPlainText: () => string;
  folderId: string;
  createdAt: string;
  updatedAt: string;
}) {
  const { data: foldersData } = useFolders();
  const folderName =
    foldersData?.folders.find((f) => f.id === folderId)?.name || "Ghi chú";
  const stats = useMemo(() => {
    if (!open) return { words: 0, chars: 0, tags: [] as string[] };
    const text = getPlainText();
    return {
      words: countWords(text),
      chars: text.length,
      tags: extractTagsClient(text),
    };
  }, [open, getPlainText]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Thông tin ghi chú</DialogTitle>
          <DialogDescription>
            Thông tin chi tiết và thống kê của ghi chú hiện tại.
          </DialogDescription>
        </DialogHeader>
        <dl className="space-y-2.5 py-1 text-sm">
          <InfoRow label="Thư mục" value={folderName} />
          <InfoRow label="Tạo lúc" value={formatNoteDateLong(createdAt)} />
          <InfoRow label="Chỉnh sửa lúc" value={formatNoteDateLong(updatedAt)} />
          <InfoRow label="Số từ" value={String(stats.words)} />
          <InfoRow label="Số ký tự" value={String(stats.chars)} />
          {stats.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {stats.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-medium">{value}</dd>
    </div>
  );
}
