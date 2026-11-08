"use client";

import { useEffect, useRef, useState } from "react";
import {
  Database,
  Download,
  FileCode,
  FileJson,
  FileText,
  HardDrive,
  Loader2,
  Keyboard,
  Upload,
  Info,
  ChevronsDownUp,
  ChevronsUpDown,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useOpenNoteStore, type SettingsTab, type ShortcutGroupId } from "@/store/opennote-store";
import { useExportAllNotes, useInvalidateNotes } from "./hooks";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

/* ==================== Root dialog ==================== */

export function SettingsDialog() {
  const settingsOpen = useOpenNoteStore((s) => s.settingsOpen);
  const settingsTab = useOpenNoteStore((s) => s.settingsTab);
  const setSettingsOpen = useOpenNoteStore((s) => s.setSettingsOpen);
  const setSettingsTab = useOpenNoteStore((s) => s.setSettingsTab);

  return (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      {/* max-h + flex: hộp thoại không bao giờ tràn màn hình —
          phần nội dung tab tự cuộn, tiêu đề và tab luôn hiển thị */}
      <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>Cài đặt hệ thống</DialogTitle>
          <DialogDescription>
            Quản lý nơi lưu trữ, sao lưu dữ liệu và phím tắt của OpenNote.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={settingsTab}
          onValueChange={(v) => setSettingsTab(v as SettingsTab)}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <TabsList className="grid w-full shrink-0 grid-cols-3">
            <TabsTrigger value="storage">
              <Database className="size-4" /> Lưu trữ
            </TabsTrigger>
            <TabsTrigger value="backup">
              <HardDrive className="size-4" /> Sao lưu
            </TabsTrigger>
            <TabsTrigger value="shortcuts">
              <Keyboard className="size-4" /> Phím tắt
            </TabsTrigger>
          </TabsList>

          <TabsContent value="storage" className="min-h-0 overflow-y-auto pr-1">
            <StorageTab />
          </TabsContent>
          <TabsContent value="backup" className="min-h-0 overflow-y-auto pr-1">
            <BackupTab />
          </TabsContent>
          <TabsContent value="shortcuts" className="min-h-0 overflow-y-auto pr-1">
            <ShortcutsTab />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/* ==================== Tab: Lưu trữ ==================== */

interface StorageInfo {
  storageType: string;
  path: string | null;
  sizeBytes: number | null;
  noteCount: number;
  folderCount: number;
  trashCount: number;
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function StorageTab() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["opennote", "settings", "storage"],
    queryFn: async (): Promise<StorageInfo> => {
      const res = await fetch("/api/settings/storage");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: true,
    staleTime: 10_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Đang tải thông tin lưu trữ…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        Không tải được thông tin lưu trữ. Vui lòng thử lại.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-xl border bg-black/[0.02] p-4 dark:bg-white/[0.03]">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/15">
          <Database className="size-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-semibold">{data.storageType}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Dữ liệu được lưu cục bộ trên máy chủ của ứng dụng, không gửi đi đâu
            khác. Vị trí tệp dữ liệu:
          </p>
          <code className="block truncate rounded-md bg-black/5 px-2 py-1 font-mono text-xs dark:bg-white/10">
            {data.path ?? "—"}
          </code>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2">
        <StatBox label="Ghi chú" value={String(data.noteCount)} />
        <StatBox label="Thư mục" value={String(data.folderCount)} />
        <StatBox label="Thùng rác" value={String(data.trashCount)} />
      </dl>

      <div className="flex items-center justify-between rounded-xl border px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <HardDrive className="size-4 text-muted-foreground" />
          Dung lượng dữ liệu
        </div>
        <span className="text-sm font-semibold tabular-nums">
          {formatBytes(data.sizeBytes)}
        </span>
      </div>

      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        Để di chuyển dữ liệu sang máy khác, hãy tải bản sao lưu .json ở tab
        “Sao lưu” rồi nhập lại trên máy mới.
      </p>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border px-3 py-2.5 text-center">
      <dd className="text-lg font-bold tabular-nums">{value}</dd>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
    </div>
  );
}

/* ==================== Tab: Sao lưu ==================== */

function BackupTab() {
  const { exportNotes, exporting } = useExportAllNotes();
  const invalidate = useInvalidateNotes();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const onPickFile = () => fileRef.current?.click();

  const importBackup = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error("Tệp không phải JSON hợp lệ.");
      }
      const p = payload as { app?: string; notes?: unknown[]; folders?: unknown[] };
      if (p.app !== "OpenNote" || !Array.isArray(p.notes)) {
        throw new Error(
          "Tệp không phải bản sao lưu của OpenNote. Hãy chọn tệp .json đã tải từ mục Sao lưu."
        );
      }
      const res = await fetch("/api/notes/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Nhập dữ liệu thất bại.");
      invalidate();
      toast({
        title: "Đã nhập bản sao lưu",
        description: `Thêm ${data.importedNotes} ghi chú, ${data.importedFolders} thư mục mới${
          data.skippedNotes > 0 ? ` (bỏ qua ${data.skippedNotes} ghi chú trùng)` : ""
        }.`,
        duration: 3500,
      });
    } catch (e) {
      toast({
        title: "Không nhập được bản sao lưu",
        description: e instanceof Error ? e.message : "Vui lòng thử lại.",
        variant: "destructive",
        duration: 4000,
      });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border p-4">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Download className="size-4 text-muted-foreground" /> Xuất dữ liệu
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Tải toàn bộ thư mục và ghi chú về máy để phòng mất dữ liệu. Ghi chú bị
          khóa chỉ xuất tiêu đề, không xuất nội dung và mã PIN.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="rounded-lg"
            disabled={exporting}
            onClick={() => exportNotes("json")}
          >
            {exporting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileJson className="size-4" />
            )}
            Bản sao lưu (.json)
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-lg"
            disabled={exporting}
            onClick={() => exportNotes("txt")}
          >
            <FileText className="size-4" /> Tệp văn bản (.txt)
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-lg"
            disabled={exporting}
            onClick={() => exportNotes("md")}
          >
            <FileCode className="size-4" /> Markdown (.md)
          </Button>
        </div>
      </div>

      <div className="rounded-xl border p-4">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Upload className="size-4 text-muted-foreground" /> Nhập dữ liệu
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Chọn tệp bản sao lưu .json đã tải từ OpenNote. Thư mục và ghi chú mới
          sẽ được thêm vào (bỏ qua những gì đã tồn tại). Ghi chú đã khóa được
          nhập ở dạng mở với nội dung rỗng.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importBackup(f);
          }}
        />
        <Button
          size="sm"
          variant="outline"
          className="rounded-lg"
          disabled={importing}
          onClick={onPickFile}
        >
          {importing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          {importing ? "Đang nhập…" : "Chọn tệp .json…"}
        </Button>
      </div>
    </div>
  );
}

/* ==================== Tab: Phím tắt ==================== */

interface ShortcutRow {
  keys: string[];
  desc: string;
}

const APP_SHORTCUTS: ShortcutRow[] = [
  { keys: ["Ctrl", "Alt", "N"], desc: "Tạo ghi chú mới" },
  { keys: ["/"], desc: "Tìm kiếm ghi chú (khi không đang gõ)" },
  { keys: ["Ctrl", "\\"], desc: "Thu gọn / mở thanh thư mục" },
  { keys: ["Ctrl", "Alt", "L"], desc: "Ẩn / hiện danh sách ghi chú" },
  { keys: ["Ctrl", "Alt", "P"], desc: "Ghim / bỏ ghim ghi chú đang mở" },
  { keys: ["Ctrl", "Alt", "E"], desc: "Tải bản sao lưu toàn bộ (.json)" },
  { keys: ["Ctrl", "/"], desc: "Mở danh sách phím tắt" },
  {
    keys: ["Ctrl", "Z"],
    desc: "Hoàn tác hành động ghi chú gần nhất (xóa, ghim, di chuyển… — khi không đang soạn thảo)",
  },
];

const EDITOR_SHORTCUTS: ShortcutRow[] = [
  { keys: ["Ctrl", "Z"], desc: "Hoàn tác (văn bản khi đang soạn thảo)" },
  { keys: ["Ctrl", "Shift", "Z"], desc: "Làm lại" },
  { keys: ["Ctrl", "B"], desc: "Đậm (trong trình soạn thảo)" },
  { keys: ["Ctrl", "I"], desc: "Nghiêng (trong trình soạn thảo)" },
  { keys: ["Ctrl", "U"], desc: "Gạch chân (trong trình soạn thảo)" },
  { keys: ["Esc"], desc: "Đóng hộp thoại / menu" },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border bg-muted px-1.5 font-mono text-[11px] font-semibold text-foreground shadow-sm">
      {children}
    </kbd>
  );
}

function ShortcutList({ rows }: { rows: ShortcutRow[] }) {
  return (
    <ul className="divide-y">
      {rows.map((r) => (
        <li key={r.desc} className="flex items-center justify-between gap-3 py-2">
          <span className="text-xs text-foreground/90">{r.desc}</span>
          <span className="flex shrink-0 items-center gap-1">
            {r.keys.map((k, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-[10px] text-muted-foreground">+</span>}
                <Kbd>{k}</Kbd>
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Một nhóm phím tắt thu gọn / mở rộng được (accordion) */
function ShortcutSection({
  value,
  title,
  rows,
}: {
  value: ShortcutGroupId;
  title: string;
  rows: ShortcutRow[];
}) {
  return (
    <AccordionItem
      value={value}
      className="rounded-xl border bg-black/[0.02] px-4 last:border-b dark:bg-white/[0.03]"
    >
      <AccordionTrigger className="items-center gap-2 py-3 hover:no-underline">
        <span className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {title}
          </span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground tabular-nums">
            {rows.length}
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="pb-2 pt-0">
        <ShortcutList rows={rows} />
      </AccordionContent>
    </AccordionItem>
  );
}

const ALL_GROUP_IDS: ShortcutGroupId[] = ["app", "editor"];

function ShortcutsTab() {
  const enabled = useOpenNoteStore((s) => s.shortcutsEnabled);
  const setEnabled = useOpenNoteStore((s) => s.setShortcutsEnabled);
  const groupsOpen = useOpenNoteStore((s) => s.shortcutGroupsOpen);
  const setGroupsOpen = useOpenNoteStore((s) => s.setShortcutGroupsOpen);

  const allOpen = ALL_GROUP_IDS.every((id) => groupsOpen.includes(id));

  return (
    <div className={cn("space-y-4", !enabled && "opacity-90")}>
      <div className="flex items-center justify-between rounded-xl border px-4 py-3">
        <div>
          <Label htmlFor="shortcuts-enabled" className="text-sm font-medium">
            Bật phím tắt
          </Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Các phím tắt không xung đột với thao tác mặc định (Ctrl+C, Ctrl+V,
            Ctrl+F…).
          </p>
        </div>
        <Switch
          id="shortcuts-enabled"
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label="Bật hoặc tắt phím tắt"
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Danh sách phím tắt
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setGroupsOpen(allOpen ? [] : ALL_GROUP_IDS)}
          aria-label={allOpen ? "Thu gọn tất cả các nhóm phím tắt" : "Mở rộng tất cả các nhóm phím tắt"}
        >
          {allOpen ? (
            <ChevronsDownUp className="size-3.5" />
          ) : (
            <ChevronsUpDown className="size-3.5" />
          )}
          {allOpen ? "Thu gọn tất cả" : "Mở rộng tất cả"}
        </Button>
      </div>

      <Accordion
        type="multiple"
        value={groupsOpen}
        onValueChange={(v) => setGroupsOpen(v as ShortcutGroupId[])}
        className="space-y-2"
      >
        <ShortcutSection
          value="app"
          title="Phím tắt ứng dụng"
          rows={APP_SHORTCUTS}
        />
        <ShortcutSection
          value="editor"
          title="Trong trình soạn thảo"
          rows={EDITOR_SHORTCUTS}
        />
      </Accordion>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Trên máy Mac, dùng ⌘ Cmd thay cho Ctrl. Khi đang gõ trong ô nhập liệu,
        phím “/” không được kích hoạt để tránh gõ nhầm ký tự.
      </p>
    </div>
  );
}
