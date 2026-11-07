-- Apply to a backed-up OpenNote database using sqlite3 -bail.
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS "TrashAction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "idsHash" TEXT NOT NULL,
  "sealed" TEXT,
  "count" INTEGER NOT NULL,
  "expiresAt" DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS "TrashAction_expiresAt_idx" ON "TrashAction"("expiresAt");

INSERT OR IGNORE INTO "Folder" ("id", "name", "isSystem", "createdAt", "updatedAt")
SELECT 'folder-notes-default', 'Ghi chú', 1,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE EXISTS (
  SELECT 1 FROM "Note" WHERE "deletedAt" IS NULL AND "folderId" = 'folder-trash-default'
);
UPDATE "Note"
SET "folderId" = 'folder-notes-default'
WHERE "deletedAt" IS NULL AND "folderId" = 'folder-trash-default';

COMMIT;
