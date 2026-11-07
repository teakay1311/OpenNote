import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ensureSystemFolders, TRASH_FOLDER_ID } from "@/lib/opennote-server";
import { revokeNoteAccess } from "@/lib/note-access";

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const token = z.string().regex(/^[0-9a-f]{64}$/);
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("purge"), token, ids: z.array(z.string().min(1)).min(1), issuedAt: z.number().int() }),
  z.object({ action: z.literal("undo"), token }),
]);

class TrashError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function seal(key: Buffer, aad: string, snapshot: unknown) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(snapshot), "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url");
}

function unseal(key: Buffer, aad: string, sealed: string): Prisma.NoteCreateManyInput[] {
  const bytes = Buffer.from(sealed, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
}

export async function POST(request: Request) {
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Thao tác thùng rác không hợp lệ" }, { status: 400 });

  const command = parsed.data;
  const now = Date.now();
  const id = digest(command.token);
  const key = Buffer.from(command.token, "hex");
  try {
    await ensureSystemFolders();
    await db.trashAction.deleteMany({ where: { expiresAt: { lte: new Date(now) } } });
    const result = await db.$transaction(async (tx) => {
      const receipt = await tx.trashAction.findUnique({ where: { id } });
      if (command.action === "purge") {
        const ids = [...new Set(command.ids)].sort();
        const idsHash = digest(JSON.stringify(ids));
        if (receipt) {
          if (receipt.idsHash !== idsHash) throw new TrashError("Mã thao tác đã dùng cho tập ghi chú khác", 409);
          if (!receipt.sealed) throw new TrashError("Thao tác xóa này đã được hoàn tác", 409);
          return { count: receipt.count, revoked: [] as string[] };
        }
        if (command.issuedAt > now + 60_000 || command.issuedAt + SEVEN_DAYS <= now) {
          throw new TrashError("Mã thao tác đã hết hiệu lực", 410);
        }
        const notes = await tx.note.findMany({ where: { id: { in: ids }, deletedAt: { not: null } } });
        if (notes.length !== ids.length) throw new TrashError("Danh sách thùng rác đã thay đổi. Hãy kiểm tra lại.", 409);
        await tx.trashAction.create({
          data: {
            id, idsHash, count: notes.length, expiresAt: new Date(now + SEVEN_DAYS),
            sealed: seal(key, id + idsHash, notes),
          },
        });
        const { count } = await tx.note.deleteMany({ where: { id: { in: ids }, deletedAt: { not: null } } });
        if (count !== notes.length) throw new TrashError("Danh sách thùng rác đã thay đổi. Hãy kiểm tra lại.", 409);
        return { count, revoked: ids };
      }

      if (!receipt) throw new TrashError("Mục hoàn tác đã hết hạn hoặc không tồn tại", 410);
      if (!receipt.sealed) return { count: receipt.count, revoked: [] as string[] };
      const notes = unseal(key, id + receipt.idsHash, receipt.sealed);
      const ids = notes.map((note) => note.id!);
      if (await tx.note.count({ where: { id: { in: ids } } })) {
        throw new TrashError("Có ghi chú đã xuất hiện lại. Hoàn tác chưa thay đổi dữ liệu.", 409);
      }
      const folders = new Set((await tx.folder.findMany({ select: { id: true } })).map((folder) => folder.id));
      await tx.note.createMany({
        data: notes.map((note) => ({ ...note, folderId: folders.has(note.folderId) ? note.folderId : TRASH_FOLDER_ID })),
      });
      await tx.trashAction.update({ where: { id }, data: { sealed: null } });
      return { count: receipt.count, revoked: ids };
    }, { timeout: 30_000 });
    for (const noteId of result.revoked) revokeNoteAccess(noteId);
    return NextResponse.json({ ok: true, count: result.count });
  } catch (e) {
    if (e instanceof TrashError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2021") {
      return NextResponse.json({ error: "Cần nâng cấp cơ sở dữ liệu trước khi xóa vĩnh viễn." }, { status: 503 });
    }
    console.error("POST /api/notes/trash-actions failed", e);
    return NextResponse.json({ error: "Không thực hiện được thao tác thùng rác" }, { status: 500 });
  }
}
