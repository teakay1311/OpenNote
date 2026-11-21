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

class FolderMappingConflict extends Error {}

export async function POST(req: Request) {
  const mediaType = req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return NextResponse.json({ error: "Dữ liệu sao lưu phải được gửi dưới dạng JSON" }, { status: 415 });
  }

  const parsed = backup.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dữ liệu sao lưu không hợp lệ" }, { status: 400 });
  const body = parsed.data;
  try {
    const result = await db.$transaction(async (tx) => {
      await ensureSystemFolders(tx);
      const folders = await tx.folder.findMany({ select: { id: true, name: true, isSystem: true } });
      const existingFolders = new Map(folders.map((folder) => [folder.id, folder]));
      const folderMap = new Map([[DEFAULT_FOLDER_ID, DEFAULT_FOLDER_ID], [TRASH_FOLDER_ID, TRASH_FOLDER_ID]]);
      const claimed = new Set(folderMap.values());
      const pendingFolders = new Map<string, { id: string; name: string }>();
      let importedFolders = 0;
      let skippedFolders = 0;

      for (const folder of body.folders ?? []) {
        if (folderMap.has(folder.id) || pendingFolders.has(folder.id)) continue;
        if (folder.isSystem) {
          folderMap.set(folder.id, DEFAULT_FOLDER_ID);
        } else if (existingFolders.has(folder.id)) {
          folderMap.set(folder.id, folder.id);
          claimed.add(folder.id);
          skippedFolders++;
        } else {
          pendingFolders.set(folder.id, folder);
        }
      }

      // Older backups can reference an existing folder without listing it in folders.
      for (const { folderId } of body.notes) {
        if (!folderId || folderMap.has(folderId) || !existingFolders.has(folderId)) continue;
        folderMap.set(folderId, folderId);
        claimed.add(folderId);
      }

      const noteIds = [...new Set(body.notes.map(({ id }) => id))];
      const existingNotes = new Map<string, { folderId: string; createdAt: Date; updatedAt: Date }>();
      for (let offset = 0; offset < noteIds.length; offset += 500) {
        const notes = await tx.note.findMany({
          where: { id: { in: noteIds.slice(offset, offset + 500) } },
          select: { id: true, folderId: true, createdAt: true, updatedAt: true },
        });
        for (const note of notes) existingNotes.set(note.id, note);
      }

      const legacyMatches = new Map<string, string>();
      for (const note of body.notes) {
        const source = note.folderId === undefined ? undefined : pendingFolders.get(note.folderId);
        const existing = existingNotes.get(note.id);
        if (!source || !existing) continue;
        const destination = existingFolders.get(existing.folderId);
        const matchedId = legacyMatches.get(source.id);
        if (!destination || destination.isSystem ||
            destination.name.toLowerCase() !== source.name.toLowerCase() ||
            existing.createdAt.getTime() !== Date.parse(note.createdAt ?? "") ||
            existing.updatedAt.getTime() !== Date.parse(note.updatedAt ?? "") ||
            (matchedId !== undefined && matchedId !== destination.id)) {
          throw new FolderMappingConflict(
            'Không xác định được thư mục đã nhập cho “' + source.name + '” (' + source.id + '). Dữ liệu chưa thay đổi.',
          );
        }
        legacyMatches.set(source.id, destination.id);
      }

      // Resolve every claim before creating any user folder.
      for (const source of pendingFolders.values()) {
        const destinationId = legacyMatches.get(source.id);
        if (destinationId === undefined) continue;
        if (claimed.has(destinationId)) {
          throw new FolderMappingConflict(
            'Không thể ánh xạ thư mục nguồn “' + source.name + '” (' + source.id +
              ') vì thư mục đích (' + destinationId + ') đã được tham chiếu bởi một ID khác. Dữ liệu chưa thay đổi.',
          );
        }
        claimed.add(destinationId);
        folderMap.set(source.id, destinationId);
        skippedFolders++;
      }

      for (const folder of pendingFolders.values()) {
        if (folderMap.has(folder.id)) continue;
        await tx.folder.create({ data: { id: folder.id, name: folder.name } });
        folderMap.set(folder.id, folder.id);
        importedFolders++;
      }

      const seenNoteIds = new Set(existingNotes.keys());
      let importedNotes = 0;
      let skippedNotes = 0;
      let lockedImported = 0;
      for (const note of body.notes) {
        if (seenNoteIds.has(note.id)) {
          skippedNotes++;
          continue;
        }
        const deletedAt = note.deletedAt ? new Date(note.deletedAt) : null;
        let folderId = folderMap.get(note.folderId ?? "") ??
          (note.folderId && existingFolders.has(note.folderId) ? note.folderId : DEFAULT_FOLDER_ID);
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
        seenNoteIds.add(note.id);
        importedNotes++;
        if (note.locked) lockedImported++;
      }
      return { ok: true, importedNotes, skippedNotes, importedFolders, skippedFolders, lockedImported };
    }, { timeout: 30_000 });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof FolderMappingConflict) return NextResponse.json({ error: e.message }, { status: 409 });
    console.error("POST /api/notes/import failed", e);
    return NextResponse.json({ error: "Nhập dữ liệu thất bại" }, { status: 500 });
  }
}
