import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DEFAULT_FOLDER_ID, htmlToPlainText, TRASH_FOLDER_ID } from "@/lib/opennote-server";
import { canReadNote, NOTE_ACCESS_HEADER, noteRevision, publicNote } from "@/lib/note-access";
import { sanitizeNoteHtml } from "@/lib/note-html";
import { MAX_NOTE_TITLE_LENGTH } from "@/lib/note-title";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
type Route = { params: Promise<{ id: string }> };

function noteResponse(note: Parameters<typeof publicNote>[0], readable: boolean) {
  return NextResponse.json(publicNote(note, readable), { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request, { params }: Route) {
  try {
    const { id } = await params;
    const note = await db.note.findUnique({ where: { id } });
    if (!note) return NextResponse.json({ error: "Không tìm thấy ghi chú" }, { status: 404 });
    return noteResponse(note, canReadNote(note, request.headers.get(NOTE_ACCESS_HEADER)));
  } catch (e) {
    console.error("GET /api/notes/[id] failed", e);
    return NextResponse.json({ error: "Không tải được ghi chú" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: Route) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Dữ liệu ghi chú không hợp lệ" }, { status: 400 });
    }
    if ("folderId" in body && (typeof body.folderId !== "string" || !body.folderId || body.folderId === TRASH_FOLDER_ID)) {
      return NextResponse.json({ error: "Thư mục đích không hợp lệ" }, { status: 400 });
    }
    if ("deletedAt" in body && body.deletedAt !== null &&
        (typeof body.deletedAt !== "string" || Number.isNaN(Date.parse(body.deletedAt)))) {
      return NextResponse.json({ error: "Thời điểm xóa không hợp lệ" }, { status: 400 });
    }

    return await db.$transaction(async (tx) => {
      const note = await tx.note.findUnique({ where: { id } });
      if (!note) return NextResponse.json({ error: "Không tìm thấy ghi chú" }, { status: 404 });
      const readable = canReadNote(note, request.headers.get(NOTE_ACCESS_HEADER));
      const editsContent = typeof body.title === "string" || typeof body.content === "string";
      if (editsContent && !readable) {
        return NextResponse.json({ error: "Mở khóa ghi chú trước khi lưu" }, { status: 401 });
      }

      const data: Prisma.NoteUncheckedUpdateInput = {};
      if (typeof body.title === "string" && body.title !== note.title) {
        if (body.title.length > MAX_NOTE_TITLE_LENGTH) {
          return NextResponse.json({ error: "Tiêu đề ghi chú vượt quá giới hạn 500 ký tự" }, { status: 400 });
        }
        data.title = body.title;
      }
      if (typeof body.content === "string") {
        const content = sanitizeNoteHtml(body.content);
        data.content = content;
        data.plainText = content === body.content && typeof body.plainText === "string"
          ? body.plainText : htmlToPlainText(content);
      }
      const contentChanged = (data.title !== undefined && data.title !== note.title)
        || (data.content !== undefined && data.content !== note.content)
        || (data.plainText !== undefined && data.plainText !== note.plainText);
      if (editsContent && body.baseRevision !== undefined && body.baseRevision !== noteRevision(note)) {
        if (!contentChanged && !("deletedAt" in body || "folderId" in body || "pinned" in body)
            && body.baseLocked === note.locked && body.baseDeletedAt === (note.deletedAt?.toISOString() ?? null)) {
          return noteResponse(note, readable);
        }
        return NextResponse.json({ error: "Ghi chú đã thay đổi. Bản sửa của bạn chưa được lưu." }, { status: 409 });
      }

      if (typeof body.pinned === "boolean") data.pinned = body.pinned;
      if (typeof body.folderId === "string") {
        const folder = await tx.folder.findUnique({ where: { id: body.folderId } });
        if (!folder) return NextResponse.json({
          error: "Thư mục đích không còn tồn tại",
          code: "FOLDER_NOT_FOUND",
        }, { status: 409 });
        data.folderId = folder.id;
      }
      if ("deletedAt" in body) {
        data.deletedAt = body.deletedAt ? new Date(body.deletedAt) : null;
        if (data.deletedAt === null && !data.folderId && note.folderId === TRASH_FOLDER_ID) {
          data.folderId = DEFAULT_FOLDER_ID;
        }
      }
      if (editsContent && !contentChanged && Object.keys(data).every((key) => ["title", "content", "plainText"].includes(key))) {
        return noteResponse(note, readable);
      }
      const updated = await tx.note.update({ where: { id }, data });
      return noteResponse(updated, readable);
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return NextResponse.json({ error: "Ghi chú vừa thay đổi. Hãy kiểm tra lại trước khi lưu." }, { status: 409 });
    }
    console.error("PATCH /api/notes/[id] failed", e);
    return NextResponse.json({ error: "Không lưu được ghi chú" }, { status: 500 });
  }
}
