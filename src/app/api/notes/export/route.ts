import { NextResponse } from "next/server";
import { sanitizeNoteHtml } from "@/lib/note-html";
import { db } from "@/lib/db";
import { ensureSystemFolders } from "@/lib/opennote-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/notes/export
 * Full backup of all folders + notes.
 * - Locked notes are exported WITHOUT content (consistent with the app's
 *   lock model: content is only readable after entering the PIN).
 * - PIN hashes are never exported.
 */
export async function GET() {
  try {
    await ensureSystemFolders();

    const folders = await db.folder.findMany({
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      select: { id: true, name: true, isSystem: true },
    });

    const notes = await db.note.findMany({
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        content: true,
        plainText: true,
        pinned: true,
        locked: true,
        folderId: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      app: "OpenNote",
      version: 1,
      exportedAt: new Date().toISOString(),
      totalNotes: notes.length,
      folders,
      notes: notes.map((n) => ({
        ...n,
        content: n.locked ? null : sanitizeNoteHtml(n.content),
        plainText: n.locked ? "" : n.plainText,
      })),
    });
  } catch (e) {
    console.error("GET /api/notes/export failed", e);
    return NextResponse.json({ error: "Không xuất được ghi chú" }, { status: 500 });
  }
}
