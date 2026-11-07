import { NextResponse } from "next/server";
import { extractTags, tagKey } from "@/lib/note-tags";
import { publicNote } from "@/lib/note-access";
import { db } from "@/lib/db";
import {
  ensureSystemFolders,
  htmlToPlainText,
  DEFAULT_FOLDER_ID,
  TRASH_FOLDER_ID,
} from "@/lib/opennote-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/notes
 * Query params:
 *  - view=folder&folderId=xxx : notes inside a folder (non-deleted)
 *  - view=all                 : all non-deleted notes
 *  - view=trash               : deleted notes
 *  - tag=#cong viec            : filter by tag (uses tag without #)
 *  - q=keyword                : search title + content
 *  - sort=edited|created|title
 */
export async function GET(request: Request) {
  try {
    await ensureSystemFolders();
    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") || "all";
    const folderId = searchParams.get("folderId");
    const tag = searchParams.get("tag");
    const q = (searchParams.get("q") || "").trim();
    const sort = searchParams.get("sort") || "edited";

    const orderBy: Record<string, "asc" | "desc">[] = [
      { pinned: "desc" },
      sort === "created" ? { createdAt: "desc" } : sort === "title" ? { title: "asc" } : { updatedAt: "desc" },
    ];

    let where: Record<string, unknown> = {};
    if (view === "trash") {
      where = { deletedAt: { not: null } };
    } else if (view === "folder" && folderId) {
      where = { folderId, deletedAt: null };
    } else {
      where = { deletedAt: null };
    }

    let notes = await db.note.findMany({
      where,
      orderBy,
      include: { folder: { select: { name: true, isSystem: true } } },
    });

    if (tag) {
      const key = `#${tagKey(tag.replace(/^#+/, ""))}`;
      notes = notes.filter((note) => !note.locked &&
        extractTags(note.plainText).some((item) => tagKey(item) === key));
    }

    if (q) {
      const lower = tagKey(q);
      notes = notes.filter((note) =>
        tagKey(note.title).includes(lower) || (!note.locked && tagKey(note.plainText).includes(lower))
      );
    }

    return NextResponse.json({
      notes: notes.map((n) => ({
        id: n.id,
        title: n.title,
        snippet: n.locked ? "" : n.plainText.replace(/\s+/g, " ").slice(0, 140),
        pinned: n.pinned,
        locked: n.locked,
        folderId: n.folderId,
        folderName: n.folder.name,
        deletedAt: n.deletedAt,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
    });
  } catch (e) {
    console.error("GET /api/notes failed", e);
    return NextResponse.json({ error: "Không tải được danh sách ghi chú" }, { status: 500 });
  }
}

/** POST /api/notes — create a new note (optionally in a folder) */
export async function POST(request: Request) {
  try {
    await ensureSystemFolders();
    const body = await request.json().catch(() => ({}));
    const folderId = body?.folderId || DEFAULT_FOLDER_ID;

    // Make sure folder exists, otherwise fall back to default
    const folder = await db.folder.findUnique({ where: { id: folderId } });
    const note = await db.note.create({
      data: {
        title: "",
        content: "",
        plainText: "",
        folderId: folder && folderId !== TRASH_FOLDER_ID ? folderId : DEFAULT_FOLDER_ID,
      },
    });
    return NextResponse.json(publicNote(note), { status: 201 });
  } catch (e) {
    console.error("POST /api/notes failed", e);
    return NextResponse.json({ error: "Không tạo được ghi chú" }, { status: 500 });
  }
}
