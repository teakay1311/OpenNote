import { NextResponse } from "next/server";
import { issueNoteAccess, publicNote } from "@/lib/note-access";
import { db } from "@/lib/db";
import { hashPin } from "@/lib/opennote-server";

export const dynamic = "force-dynamic";

/** POST /api/notes/[id]/unlock — verify PIN and return hidden content */
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
    if (!note.locked || !note.pinHash) {
      return NextResponse.json({ error: "Ghi chú này chưa bị khóa" }, { status: 400 });
    }
    if (hashPin(id, pin) !== note.pinHash) {
      return NextResponse.json({ error: "Mã PIN không đúng" }, { status: 401 });
    }
    return NextResponse.json(
      { ok: true, ...publicNote(note, true), accessToken: issueNoteAccess(id, note.pinHash) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("POST /api/notes/[id]/unlock failed", e);
    return NextResponse.json({ error: "Không mở khóa được ghi chú" }, { status: 500 });
  }
}
