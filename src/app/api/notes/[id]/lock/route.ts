import { NextResponse } from "next/server";
import { canReadNote, NOTE_ACCESS_HEADER, revokeNoteAccess } from "@/lib/note-access";
import { db } from "@/lib/db";
import { hashPin } from "@/lib/opennote-server";

export const dynamic = "force-dynamic";

/** POST /api/notes/[id]/lock — lock a note with a PIN */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    if (body?.relock === true) {
      const token = request.headers.get(NOTE_ACCESS_HEADER);
      const note = await db.note.findUnique({ where: { id } });
      if (!note) return NextResponse.json({ error: "Không tìm thấy ghi chú" }, { status: 404 });
      if (!note.locked || !token || !canReadNote(note, token)) {
        return NextResponse.json({ error: "Phiên mở khóa đã hết hiệu lực" }, { status: 401 });
      }
      revokeNoteAccess(id, token);
      return NextResponse.json({ ok: true, locked: true });
    }
    const pin = String(body?.pin || "");
    if (!/^\d{4,8}$/.test(pin)) {
      return NextResponse.json({ error: "Mã PIN gồm 4–8 chữ số" }, { status: 400 });
    }
    const { count } = await db.note.updateMany({
      where: { id, locked: false },
      data: { locked: true, pinHash: hashPin(id, pin) },
    });
    if (!count) {
      const note = await db.note.findUnique({ where: { id }, select: { id: true } });
      return note
        ? NextResponse.json({ error: "Ghi chú đã khóa. Hãy tắt khóa bằng PIN hiện tại trước." }, { status: 409 })
        : NextResponse.json({ error: "Không tìm thấy ghi chú" }, { status: 404 });
    }
    revokeNoteAccess(id);
    return NextResponse.json({ ok: true, locked: true });
  } catch (e) {
    console.error("POST /api/notes/[id]/lock failed", e);
    return NextResponse.json({ error: "Không khóa được ghi chú" }, { status: 500 });
  }
}
