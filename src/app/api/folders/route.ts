import { NextResponse } from "next/server";
import { cleanupExpiredTrashActions } from "@/lib/trash-cleanup";
import { tagKey } from "@/lib/note-tags";
import { db } from "@/lib/db";
import {
  ensureSystemFolders,
  extractTags,
} from "@/lib/opennote-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSystemFolders();
    await cleanupExpiredTrashActions();

    const [folders, notes] = await Promise.all([
      db.folder.findMany({
        orderBy: [{ createdAt: "asc" }],
        include: { notes: { where: { deletedAt: null }, select: { id: true, plainText: true } } },
      }),
      db.note.findMany({
        where: { deletedAt: null, locked: false },
        select: { plainText: true },
      }),
    ]);

    // Collect tags with counts across all notes
    const tagCounts = new Map<string, number>();
    for (const n of notes) {
      for (const tag of extractTags(n.plainText)) {
        const key = tagKey(tag);
        tagCounts.set(key, (tagCounts.get(key) || 0) + 1);
      }
    }

    return NextResponse.json({
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        isSystem: f.isSystem,
        count: f.notes.length,
      })),
      tags: [...tagCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name, "vi")),
    });
  } catch (e) {
    console.error("GET /api/folders failed", e);
    return NextResponse.json({ error: "Không tải được thư mục" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Tên thư mục không được để trống" }, { status: 400 });
    }
    if (body.id !== undefined) {
      const id = body.id;
      if (typeof id !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) {
        return NextResponse.json({ error: "Mã tạo thư mục không hợp lệ" }, { status: 400 });
      }
      const folder = await db.folder.upsert({ where: { id }, update: {}, create: { id, name } });
      if (folder.name !== name) {
        return NextResponse.json({ error: "Thư mục đã được tạo và có tên khác" }, { status: 409 });
      }
      return NextResponse.json(folder, { status: 201 });
    }
    const folder = await db.folder.create({ data: { name } });
    return NextResponse.json(folder, { status: 201 });
  } catch (e) {
    console.error("POST /api/folders failed", e);
    return NextResponse.json({ error: "Không tạo được thư mục" }, { status: 500 });
  }
}
