import { createHash, randomBytes } from "node:crypto";
import type { Note } from "@prisma/client";
import { sanitizeNoteHtml } from "./note-html";

type Access = { id: string; pinHash: string };
const shared = globalThis as typeof globalThis & { openNoteAccess?: Map<string, Access> };
const access = (shared.openNoteAccess ??= new Map<string, Access>());

export const NOTE_ACCESS_HEADER = "x-opennote-access";

export function issueNoteAccess(id: string, pinHash: string) {
  const token = randomBytes(32).toString("hex");
  access.set(token, { id, pinHash });
  return token;
}

export function canReadNote(note: Pick<Note, "id" | "locked" | "pinHash">, token: string | null) {
  if (!note.locked) return true;
  const grant = token ? access.get(token) : undefined;
  return !!grant && grant.id === note.id && grant.pinHash === note.pinHash;
}

export function revokeNoteAccess(id: string, token?: string) {
  if (token) {
    if (access.get(token)?.id === id) access.delete(token);
    return;
  }
  for (const [key, grant] of access) if (grant.id === id) access.delete(key);
}

export function noteRevision(note: Pick<Note, "id" | "title" | "content" | "plainText" | "locked" | "deletedAt">) {
  return createHash("sha256")
    .update(JSON.stringify([note.id, note.title, note.content, note.plainText, note.locked, note.deletedAt]))
    .digest("hex");
}

export function publicNote(note: Note, readable = !note.locked) {
  const { id, title, pinned, locked, folderId, deletedAt, createdAt, updatedAt } = note;
  return {
    id, title, pinned, locked, folderId, deletedAt, createdAt, updatedAt,
    content: readable ? sanitizeNoteHtml(note.content) : "",
    plainText: readable ? note.plainText : "",
    revision: readable ? noteRevision(note) : null,
  };
}
