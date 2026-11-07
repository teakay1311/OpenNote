import { NextResponse } from "next/server";
import { z } from "zod";
import { sanitizeNoteHtml } from "@/lib/note-html";
import { db } from "@/lib/db";
import { DEFAULT_FOLDER_ID, TRASH_FOLDER_ID, ensureSystemFolders, htmlToPlainText } from "@/lib/opennote-server";

export const dynamic = "force-dynamic";

const date = z.string().refine((value) => !Number.isNaN(Date.parse(value)));
const backup = z.object({
  folders: z.array(z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    isSystem: z.boolean().optional(),
  })).optional(),
  notes: z.array(z.object({
    id: z.string().min(1),
    title: z.string().optional(),
    content: z.string().nullable().optional(),
    plainText: z.string().nullable().optional(),
    pinned: z.boolean().optional(),
    locked: z.boolean().optional(),
    folderId: z.string().optional(),
    deletedAt: date.nullable().optional(),
    createdAt: date.optional(),
    updatedAt: date.optional(),
  })),
});

export async function POST(req: Request) {
  const parsed = backup.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dữ liệu sao lưu không hợp lệ" }, { status: 400 });
  const body = parsed.data;
  try {
    const result = await db.$transaction(async (tx) => {
      await ensureSystemFolders(tx);
      const folders = await tx.folder.findMany({ select: { id: true, name: true, isSystem: true } });
      const existingFolderIds = new Set(folders.map((folder) => folder.id));
      const folderMap = new Map([[DEFAULT_FOLDER_ID, DEFAULT_FOLDER_ID], [TRASH_FOLDER_ID, TRASH_FOLDER_ID]]);
      let importedFolders = 0;
      let skippedFolders = 0;
      for (const folder of body.folders ?? []) {
        if (folderMap.has(folder.id)) continue;
        if (folder.isSystem) {
          folderMap.set(folder.id, DEFAULT_FOLDER_ID);
          continue;
        }
        const existing = folders.find((item) => !item.isSystem && item.name.toLowerCase() === folder.name.toLowerCase());
        if (existing) {
          folderMap.set(folder.id, existing.id);
          skippedFolders++;
        } else {
          const created = await tx.folder.create({ data: { name: folder.name } });
          folders.push(created);
          existingFolderIds.add(created.id);
          folderMap.set(folder.id, created.id);
          importedFolders++;
        }
      }

      let importedNotes = 0;
      let skippedNotes = 0;
      let lockedImported = 0;
      for (const note of body.notes) {
        if (await tx.note.findUnique({ where: { id: note.id }, select: { id: true } })) {
          skippedNotes++;
          continue;
        }
        const deletedAt = note.deletedAt ? new Date(note.deletedAt) : null;
        let folderId = folderMap.get(note.folderId ?? "") ??
          (note.folderId && existingFolderIds.has(note.folderId) ? note.folderId : DEFAULT_FOLDER_ID);
        if (!deletedAt && folderId === TRASH_FOLDER_ID) folderId = DEFAULT_FOLDER_ID;
        const raw = note.content ?? "";
        const content = note.locked ? "" : sanitizeNoteHtml(raw);
        const plainText = note.locked ? "" : content === raw && note.plainText?.trim()
          ? note.plainText : htmlToPlainText(content);
        await tx.note.create({
          data: {
            id: note.id, title: note.title ?? "", content, plainText, pinned: note.pinned ?? false, folderId, deletedAt,
            ...(note.createdAt ? { createdAt: new Date(note.createdAt) } : {}),
            ...(note.updatedAt ? { updatedAt: new Date(note.updatedAt) }
              : note.createdAt ? { updatedAt: new Date(note.createdAt) } : {}),
          },
        });
        importedNotes++;
        if (note.locked) lockedImported++;
      }
      return { ok: true, importedNotes, skippedNotes, importedFolders, skippedFolders, lockedImported };
    }, { timeout: 30_000 });
    return NextResponse.json(result);
  } catch (e) {
    console.error("POST /api/notes/import failed", e);
    return NextResponse.json({ error: "Nhập dữ liệu thất bại" }, { status: 500 });
  }
}
