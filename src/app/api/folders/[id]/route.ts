import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DEFAULT_FOLDER_ID, ensureSystemFolders, TRASH_FOLDER_ID } from "@/lib/opennote-server";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Tên thư mục không được để trống" }, { status: 400 });
    }
    const folder = await db.folder.findUnique({ where: { id } });
    if (!folder) {
      return NextResponse.json({ error: "Không tìm thấy thư mục" }, { status: 404 });
    }
    if (folder.isSystem) {
      return NextResponse.json({ error: "Không thể đổi tên thư mục hệ thống" }, { status: 400 });
    }
    if (folder.name === name) return NextResponse.json(folder);
    const updated = await db.folder.update({ where: { id }, data: { name } });
    return NextResponse.json(updated);
  } catch (e) {
    console.error("PATCH /api/folders/[id] failed", e);
    return NextResponse.json({ error: "Không cập nhật được thư mục" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await ensureSystemFolders();
    return await db.$transaction(async (tx) => {
      const folder = await tx.folder.findUnique({ where: { id } });
      if (!folder) return NextResponse.json({ error: "Không tìm thấy thư mục" }, { status: 404 });
      if (folder.isSystem) {
        return NextResponse.json({ error: "Không thể xóa thư mục hệ thống" }, { status: 400 });
      }
      await tx.note.updateMany({
        where: { folderId: id, deletedAt: null },
        data: { folderId: DEFAULT_FOLDER_ID },
      });
      await tx.note.updateMany({
        where: { folderId: id, deletedAt: { not: null } },
        data: { folderId: TRASH_FOLDER_ID },
      });
      await tx.folder.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    });
  } catch (e) {
    console.error("DELETE /api/folders/[id] failed", e);
    return NextResponse.json({ error: "Không xóa được thư mục" }, { status: 500 });
  }
}
