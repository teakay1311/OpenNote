"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { LayoutMode, NoteFilter, SortBy } from "@/lib/opennote-types";

export type SettingsTab = "storage" | "backup" | "shortcuts";
export type ShortcutGroupId = "app" | "editor";

interface OpenNoteState {
  filter: NoteFilter;
  selectedNoteId: string | null;
  searchQuery: string;
  sortBy: SortBy;
  layout: LayoutMode;
  sidebarOpen: boolean; // mobile sheet
  /** Desktop (lg+): thu gọn thanh thư mục bên trái */
  sidebarCollapsed: boolean;
  /** Desktop (md+): ẩn cột danh sách để ghi chú chiếm toàn màn hình */
  listCollapsed: boolean;
  /** ids of notes unlocked in the current session */
  noteAccess: Record<string, string | undefined>;
  /** hộp thoại Cài đặt hệ thống */
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  /** bật/tắt toàn bộ phím tắt của ứng dụng */
  shortcutsEnabled: boolean;
  /** nhóm phím tắt đang mở trong Cài đặt (accordion) — nhớ lựa chọn của người dùng */
  shortcutGroupsOpen: ShortcutGroupId[];
  /** tăng lên mỗi lần cần focus ô tìm kiếm */
  searchFocusTick: number;

  setFilter: (f: NoteFilter) => void;
  selectNote: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
  setSortBy: (s: SortBy) => void;
  setLayout: (l: LayoutMode) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebarCollapsed: () => void;
  toggleListCollapsed: () => void;
  markUnlocked: (id: string, token: string) => void;
  clearUnlocked: (id: string) => void;
  openSettings: (tab?: SettingsTab) => void;
  setSettingsOpen: (open: boolean) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  setShortcutsEnabled: (v: boolean) => void;
  setShortcutGroupsOpen: (groups: ShortcutGroupId[]) => void;
  requestSearchFocus: () => void;
}

export const useOpenNoteStore = create<OpenNoteState>()(
  persist(
    (set) => ({
      filter: { type: "folder", folderId: "folder-notes-default" },
      selectedNoteId: null,
      searchQuery: "",
      sortBy: "edited",
      layout: "list",
      sidebarOpen: false,
      sidebarCollapsed: false,
      listCollapsed: false,
      noteAccess: {},
      settingsOpen: false,
      settingsTab: "storage" as SettingsTab,
      shortcutsEnabled: true,
      shortcutGroupsOpen: ["app"] as ShortcutGroupId[],
      searchFocusTick: 0,

      setFilter: (f) => set({ filter: f, selectedNoteId: null, searchQuery: "" }),
      selectNote: (id) => set({ selectedNoteId: id }),
      setSearchQuery: (q) => set({ searchQuery: q }),
      setSortBy: (s) => set({ sortBy: s }),
      setLayout: (l) => set({ layout: l }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleSidebarCollapsed: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      toggleListCollapsed: () => set((s) => ({ listCollapsed: !s.listCollapsed })),
      markUnlocked: (id, token) => set((s) => ({ noteAccess: { ...s.noteAccess, [id]: token } })),
      clearUnlocked: (id) => set((s) => {
        const noteAccess = { ...s.noteAccess };
        delete noteAccess[id];
        return { noteAccess };
      }),
      openSettings: (tab) =>
        set((s) => ({
          settingsOpen: true,
          settingsTab: tab ?? s.settingsTab,
        })),
      setSettingsOpen: (open) => set({ settingsOpen: open }),
      setSettingsTab: (tab) => set({ settingsTab: tab }),
      setShortcutsEnabled: (v) => set({ shortcutsEnabled: v }),
      setShortcutGroupsOpen: (groups) => set({ shortcutGroupsOpen: groups }),
      requestSearchFocus: () =>
        set((s) => ({ searchFocusTick: s.searchFocusTick + 1 })),
    }),
    {
      name: "opennote-ui-prefs",
      storage: createJSONStorage(() => localStorage),
      // Rehydrate manually after mount (see OpenNoteApp) to avoid SSR
      // hydration mismatches — layout flags only matter on the client.
      skipHydration: true,
      partialize: (s) => ({
        sidebarCollapsed: s.sidebarCollapsed,
        listCollapsed: s.listCollapsed,
        shortcutsEnabled: s.shortcutsEnabled,
        shortcutGroupsOpen: s.shortcutGroupsOpen,
      }),
    }
  )
);
