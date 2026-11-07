import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { createHash } from "crypto";

export const DEFAULT_FOLDER_ID = "folder-notes-default";
export const TRASH_FOLDER_ID = "folder-trash-default";

export const DEFAULT_FOLDER_NAME = "Ghi chú";
export const TRASH_FOLDER_NAME = "Đã xóa gần đây";

/**
 * Ensures the two system folders exist (Notes inbox + Recently Deleted).
 * Safe to call on every request (upsert avoids race conditions).
 */
export async function ensureSystemFolders(client: Pick<Prisma.TransactionClient, "folder"> = db) {
  await client.folder.upsert({
    where: { id: DEFAULT_FOLDER_ID },
    update: {},
    create: { id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME, isSystem: true },
  });
  await client.folder.upsert({
    where: { id: TRASH_FOLDER_ID },
    update: {},
    create: { id: TRASH_FOLDER_ID, name: TRASH_FOLDER_NAME, isSystem: true },
  });
}

export { extractTags } from "./note-tags";
export { htmlToPlainText } from "./note-html-text";

export function hashPin(noteId: string, pin: string): string {
  return createHash("sha256").update(`${noteId}::${pin}`).digest("hex");
}
