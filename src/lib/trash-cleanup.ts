import { db } from "@/lib/db";

const shared = globalThis as typeof globalThis & { openNoteTrashCleanupAt?: number };

export async function cleanupExpiredTrashActions() {
  const now = Date.now();
  if ((shared.openNoteTrashCleanupAt ?? 0) > now) return;
  shared.openNoteTrashCleanupAt = now + 60 * 60 * 1000;
  // Older databases can still open the app before the additive upgrade.
  await db.trashAction.deleteMany({ where: { expiresAt: { lte: new Date(now) } } }).catch(() => {});
}
