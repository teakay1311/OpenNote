import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { htmlToPlainText, replaceHtmlTag } from "@/lib/note-html-text";
import { normalizeTag, replaceTag, tagKey } from "@/lib/note-tags";
import { sanitizeNoteHtml } from "@/lib/note-html";

export const dynamic = "force-dynamic";

async function changeTag(from: string, to: string | null) {
  try {
    const updated = await db.$transaction(async (tx) => {
      const notes = await tx.note.findMany({
        where: { locked: false },
        select: { id: true, title: true, content: true, plainText: true },
      });
      let count = 0;
      for (const note of notes) {
        const title = replaceTag(note.title, from, to);
        const text = replaceTag(note.plainText, from, to);
        const changed = note.content.includes("#") ? replaceHtmlTag(note.content, from, to) : note.content;
        if (title === note.title && text === note.plainText && changed === note.content) continue;
        const clean = sanitizeNoteHtml(changed);
        await tx.note.update({
          where: { id: note.id },
          data: {
            title,
            content: changed === note.content ? changed : clean,
            plainText: changed !== note.content ? htmlToPlainText(clean) : text,
          },
        });
        count++;
      }
      return count;
    }, { timeout: 30_000 });
    return NextResponse.json({ ok: true, updated });
  } catch (e) {
    console.error("Tag update failed", e);
    return NextResponse.json({ error: "Không cập nhật được thẻ" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const from = normalizeTag(body?.from);
  const to = normalizeTag(body?.to);
  if (!from || !to || tagKey(from) === tagKey(to)) {
    return NextResponse.json({ error: "Tên thẻ không hợp lệ hoặc trùng tên cũ" }, { status: 400 });
  }
  return changeTag(`#${tagKey(from)}`, to);
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const from = normalizeTag(body?.tag);
  if (!from) return NextResponse.json({ error: "Thẻ không hợp lệ" }, { status: 400 });
  return changeTag(`#${tagKey(from)}`, null);
}
