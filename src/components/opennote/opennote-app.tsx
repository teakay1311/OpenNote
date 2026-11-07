"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Sidebar } from "./sidebar";
import { NoteList } from "./note-list";
import { NoteEditor } from "./note-editor";
import { SettingsDialog } from "./settings-dialog";
import { GlobalShortcuts } from "./global-shortcuts";
import { useNoteDrafts } from "@/store/note-drafts";
import { useOpenNoteStore } from "@/store/opennote-store";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

function OpenNoteLayout() {
  const selectedNoteId = useOpenNoteStore((s) => s.selectedNoteId);
  const sidebarOpen = useOpenNoteStore((s) => s.sidebarOpen);
  const setSidebarOpen = useOpenNoteStore((s) => s.setSidebarOpen);
  const sidebarCollapsed = useOpenNoteStore((s) => s.sidebarCollapsed);
  const listCollapsed = useOpenNoteStore((s) => s.listCollapsed);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      {/* Desktop sidebar — chỉ hiện từ lg trở lên, thu gọn được */}
      {!sidebarCollapsed && (
        <aside className="hidden w-60 shrink-0 border-r lg:block" aria-label="Thanh bên">
          <Sidebar />
        </aside>
      )}

      {/* Mobile / tablet sidebar sheet */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent
          side="left"
          className="w-72 border-r p-0"
          showCloseButton={false}
        >
          <SheetTitle className="sr-only">Menu OpenNote</SheetTitle>
          <Sidebar onNavigate={() => setSidebarOpen(false)} showClose />
        </SheetContent>
      </Sheet>

      {/* Notes column: full width on mobile when no note selected.
          listCollapsed (md+) ẩn cột này để ghi chú hiển thị toàn màn hình. */}
      <section
        className={cn(
          "w-full shrink-0 flex-col md:w-80 lg:w-96",
          selectedNoteId
            ? listCollapsed
              ? "hidden"
              : "hidden md:flex"
            : listCollapsed
              ? "flex md:hidden"
              : "flex"
        )}
        aria-label="Danh sách ghi chú"
      >
        <NoteList />
      </section>

      {/* Editor: full width on mobile when a note is selected */}
      <main
        className={cn(
          "min-w-0 flex-1 flex-col",
          selectedNoteId ? "flex" : "hidden md:flex"
        )}
        aria-label="Trình soạn thảo"
      >
        <NoteEditor />
      </main>
    </div>
  );
}

export function OpenNoteApp() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  // Khôi phục tùy chọn thu gọn (sidebar / focus mode) sau khi mount
  useEffect(() => {
    useOpenNoteStore.persist.rehydrate();
  }, []);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!Object.keys(useNoteDrafts.getState().drafts).length) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    const unsubscribe = useNoteDrafts.subscribe((state, previous) => {
      if (Object.entries(state.committed).some(([id, note]) => note && previous.committed[id] !== note)) {
        void queryClient.invalidateQueries({ queryKey: ["opennote"] });
      }
    });
    return () => {
      unsubscribe();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <OpenNoteLayout />
      <SettingsDialog />
      <GlobalShortcuts />
    </QueryClientProvider>
  );
}
