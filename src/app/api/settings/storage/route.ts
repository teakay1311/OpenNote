import { NextResponse } from "next/server";
import path from "path";
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

    // Resolve SQLite file from DATABASE_URL (e.g. "file:./db/custom.db")
    let sizeBytes: number | null = null;
    let filePath = "db/custom.db";
    try {
      const url = process.env.DATABASE_URL || "";
      if (url.startsWith("file:")) {
        const rel = url.slice("file:".length).replace(/^\.\//, "");
        filePath = rel;
        const abs = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
        const stat = await fs.stat(abs);
        sizeBytes = stat.size;
      }
    } catch {
      // Không lấy được dung lượng → trả null, UI hiển thị "—"
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
