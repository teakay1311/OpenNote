import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { db } from "@/lib/db";
import { ensureSystemFolders } from "@/lib/opennote-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/settings/storage
 * Thông tin nơi lưu trữ cho tab "Cài đặt → Lưu trữ".
 */
export async function GET() {
  try {
    await ensureSystemFolders();

    const [noteCount, folderCount, trashCount] = await Promise.all([
      db.note.count({ where: { deletedAt: null } }),
      db.folder.count({ where: { isSystem: false } }),
      db.note.count({ where: { deletedAt: { not: null } } }),
    ]);

    let sizeBytes: number | null = null;
    let filePath: string | null = null;
    try {
      const databases = await db.$queryRaw<{ name: string; file: string }[]>`PRAGMA database_list`;
      filePath = databases.find(({ name }) => name === "main")?.file || null;
      if (filePath) sizeBytes = (await fs.stat(filePath)).size;
    } catch {
      // Thông tin tệp không ảnh hưởng đến số đếm đã đọc từ SQLite.
    }

    return NextResponse.json({
      storageType: "Cục bộ — SQLite (Prisma)",
      path: filePath,
      sizeBytes,
      noteCount,
      folderCount,
      trashCount,
    });
  } catch (e) {
    console.error("GET /api/settings/storage failed", e);
    return NextResponse.json(
      { error: "Không lấy được thông tin lưu trữ" },
      { status: 500 }
    );
  }
}
