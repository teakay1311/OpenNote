import { NextResponse } from "next/server";
import { revokeNoteAccess } from "@/lib/note-access";
import { db } from "@/lib/db";
import { hashPin } from "@/lib/opennote-server";

export const dynamic = "force-dynamic";

/** POST /api/notes/[id]/remove-lock — verify PIN then remove the lock entirely */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const pin = String(body?.pin || "");
    const note = await db.note.findUnique({ where: { id } });
    if (!note) {
      return NextResponse.json({ error: "Không tìm thấy ghi chú" }, { status: 404 });
    }
    if (!note.locked) {
      return NextResponse.json({ error: "Ghi chú này chưa bị khóa" }, { status: 400 });
    }
    if (!note.pinHash || hashPin(id, pin) !== note.pinHash) {
      return NextResponse.json({ error: "Mã PIN không đúng" }, { status: 401 });
    }
    const { count } = await db.note.updateMany({
      where: { id, locked: true, pinHash: note.pinHash },
      data: { locked: false, pinHash: null },
    });
    if (!count) return NextResponse.json({ error: "Trạng thái khóa đã thay đổi" }, { status: 409 });
    revokeNoteAccess(id);
    return NextResponse.json({ ok: true, locked: false });
  } catch (e) {
    console.error("POST /api/notes/[id]/remove-lock failed", e);
    return NextResponse.json({ error: "Không tắt khóa được ghi chú" }, { status: 500 });
  }
}
