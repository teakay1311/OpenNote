/// <reference types="bun-types" />

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { Database } from "bun:sqlite";
import type { Prisma } from "@prisma/client";

const base = "http://127.0.0.1:16347/api";
const fixture = mkdtempSync(join(tmpdir(), "opennote-api-test-"));
const url = "file:" + join(fixture, "fixture.db");
const originalUrl = process.env.DATABASE_URL;
let client: typeof import("../src/lib/db").db;

function post(path: string, payload: unknown) {
  return new Request(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("OpenNote data and request regressions", () => {
  before(async () => {
    process.env.DATABASE_URL = url;
    const schema = execFileSync(process.execPath, [
      "run", "prisma", "migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma/schema.prisma", "--script",
    ], { encoding: "utf8", env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "1" } });
    const sqlite = new Database(url.slice(5), { create: true, readwrite: true });
    try { sqlite.exec(schema); } finally { sqlite.close(); }
    client = (await import("../src/lib/db")).db;
  });

  after(async () => {
    await client?.$disconnect();
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    rmSync(fixture, { recursive: true, force: true });
  });

  test("rejects malformed note creation before writing and accepts an empty body", async () => {
    const { POST } = await import("../src/app/api/notes/route");
    const before = await client.note.count();
    const foldersBefore = await client.folder.count();
    for (const body of ["{", "[]", "null", '{"folderId":12}']) {
      const result = await POST(new Request(base + "/notes", { method: "POST", body }));
      assert.equal(result.status, 400);
    }
    assert.equal(await client.note.count(), before);
    assert.equal(await client.folder.count(), foldersBefore);
    assert.equal((await POST(new Request(base + "/notes", { method: "POST" }))).status, 201);
  });

  test("round-trips same-name folder identities and skips previously imported IDs", async () => {
    const { POST } = await import("../src/app/api/notes/import/route");
    const { GET } = await import("../src/app/api/notes/export/route");
    const folders = [{ id: "source-A", name: "Tên trùng" }, { id: "source-B", name: "Tên trùng" }];
    const createdAt = "2026-10-01T01:00:00.000Z";
    const updatedAt = "2026-10-01T02:00:00.000Z";
    const deletedAt = "2026-10-02T02:00:00.000Z";
    const notes = folders.map(({ id }, index) => ({
      id: "note-" + id,
      folderId: id,
      title: "Tiêu đề " + id,
      content: "<p>Tiếng Việt " + id + "</p>",
      plainText: "Tiếng Việt " + id,
      pinned: index === 0,
      deletedAt: index === 1 ? deletedAt : null,
      createdAt,
      updatedAt,
    }));
    assert.equal((await POST(post("/notes/import", { folders, notes }))).status, 200);
    const snapshot = await (await GET()).json();
    for (const folder of folders) {
      assert.equal(snapshot.folders.find(({ id }: { id: string }) => id === folder.id)?.name, folder.name);
    }
    for (const note of notes) {
      assert.deepEqual(
        snapshot.notes.find(({ id }: { id: string }) => id === note.id),
        { ...note, locked: false },
      );
    }
    await client.folder.update({ where: { id: folders[0].id }, data: { name: "Tên hiện hành" } });
    const result = await (await POST(post("/notes/import", snapshot))).json();
    assert.equal(result.importedFolders, 0);
    assert.equal(result.importedNotes, 0);
    assert.equal((await client.folder.findUniqueOrThrow({ where: { id: folders[0].id } })).name, "Tên hiện hành");
  });

  test("reuses a proven legacy folder for full and partial backup imports", async () => {
    const { POST } = await import("../src/app/api/notes/import/route");
    const { DELETE } = await import("../src/app/api/folders/route");
    const createdAt = new Date("2026-10-01T01:00:00.000Z");
    const updatedAt = new Date("2026-10-01T02:00:00.000Z");
    const legacy = await client.folder.create({ data: { name: "Công việc" } });
    const notes = ["legacy-A", "legacy-B"].map((id) => ({
      id, title: id, folderId: legacy.id, createdAt, updatedAt,
      content: "<p>Nội dung</p>", plainText: "Nội dung",
    }));
    for (const note of notes) await client.note.create({ data: note });
    const backup = {
      app: "OpenNote", version: 1,
      folders: [{ id: "legacy-original-folder", name: "công VIỆC" }],
      notes: notes.map((note) => ({ ...note, folderId: "legacy-original-folder" })),
    };
    const existing = await client.note.findMany({ where: { folderId: legacy.id }, orderBy: { id: "asc" } });
    const complete = await POST(post("/notes/import", backup));
    assert.equal(complete.status, 200);
    assert.deepEqual(await complete.json(), {
      ok: true, importedFolders: 0, skippedFolders: 1, importedNotes: 0, skippedNotes: 2, lockedImported: 0,
    });
    await client.note.delete({ where: { id: "legacy-B" } });
    const partial = await POST(post("/notes/import", backup));
    assert.equal(partial.status, 200);
    assert.equal((await partial.json()).importedNotes, 1);
    assert.equal(await client.folder.count({ where: { id: "legacy-original-folder" } }), 0);
    assert.deepEqual(await client.note.findMany({ where: { folderId: legacy.id }, orderBy: { id: "asc" } }), existing);
    assert.equal((await DELETE(new Request(base + "/folders?" + new URLSearchParams({ id: legacy.id }),
      { method: "DELETE" }))).status, 200);
  });

  test("rolls back uncertain legacy folder mappings without rewriting notes", async () => {
    const { POST } = await import("../src/app/api/notes/import/route");
    const { PATCH } = await import("../src/app/api/notes/[id]/route");
    const createdAt = new Date("2026-10-01T01:00:00.000Z");
    const updatedAt = new Date("2026-10-01T02:00:00.000Z");
    const first = await client.folder.create({ data: { name: "Tên cũ trùng" } });
    const other = await client.folder.create({ data: { name: first.name } });
    const anchor = await client.note.create({ data: { folderId: first.id, createdAt, updatedAt } });
    const second = await client.note.create({ data: { folderId: first.id, createdAt, updatedAt } });
    const inputFolder = { id: "uncertain-source", name: first.name };
    const otherInputFolder = { id: "second-source", name: first.name };
    const anchored = { id: anchor.id, folderId: inputFolder.id, createdAt, updatedAt };
    const anchoredSecond = { id: second.id, folderId: otherInputFolder.id, createdAt, updatedAt };
    const missing = { id: "uncertain-missing", folderId: inputFolder.id, title: "Chưa có" };
    const unrelated = { id: "unrelated-would-create", name: "Kiểm tra hoàn tác giao dịch" };
    async function verifyConflict(folders: object[], notes: object[]) {
      const before = await client.$transaction([client.folder.findMany(), client.note.findMany()]);
      const response = await POST(post("/notes/import", { folders: [unrelated, ...folders], notes: [...notes, missing] }));
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /uncertain-source|second-source/);
      assert.deepEqual(await client.$transaction([client.folder.findMany(), client.note.findMany()]), before);
    }
    await verifyConflict([inputFolder], [{ ...anchored, updatedAt: undefined }]);
    await verifyConflict([inputFolder, otherInputFolder], [anchored, anchoredSecond]);
    await verifyConflict([inputFolder, { id: first.id, name: first.name }], [anchored]);
    const moved = await PATCH(new Request(base + "/notes/" + anchor.id, {
      method: "PATCH", body: JSON.stringify({ folderId: other.id }),
    }), { params: Promise.resolve({ id: anchor.id }) });
    assert.equal(moved.status, 200);
    assert.notEqual((await moved.json()).updatedAt, updatedAt.toISOString());
    await verifyConflict([inputFolder], [anchored]);
  });

  test("reserves existing folder IDs mentioned only by notes, including skipped notes", async () => {
    const { POST } = await import("../src/app/api/notes/import/route");
    const dates = {
      createdAt: new Date("2026-10-04T01:00:00.000Z"),
      updatedAt: new Date("2026-10-04T02:00:00.000Z"),
    };
    const destination = await client.folder.create({ data: { id: "claim-existing", name: "Cùng tên" } });
    const anchor = await client.note.create({
      data: { id: "claim-anchor", folderId: destination.id, title: "Đã nhập", content: "<p>Nội dung</p>", ...dates },
    });
    const sourceId = "claim-legacy";
    const direct = { id: "claim-direct", folderId: destination.id, title: "Ghi chú khác nguồn", ...dates };
    const backup = {
      app: "OpenNote", version: 1,
      folders: [{ id: sourceId, name: destination.name }],
      notes: [
        { ...anchor, folderId: sourceId },
        { id: "claim-missing", folderId: sourceId, title: "Cần khôi phục", ...dates },
        direct,
      ],
    };
    const snapshot = () => client.$transaction([
      client.folder.findMany({ orderBy: { id: "asc" } }),
      client.note.findMany({ orderBy: { id: "asc" } }),
    ]);
    const assertConflict = async () => {
      const before = await snapshot();
      const response = await POST(post("/notes/import", backup));
      assert.equal(response.status, 409);
      const { error } = await response.json();
      assert.match(error, /claim-legacy/);
      assert.match(error, /claim-existing/);
      assert.deepEqual(await snapshot(), before);
    };

    await assertConflict();
    await client.note.create({ data: direct });
    await assertConflict();
  });

  test("imports note-only references without changing folder counts or fallback", async () => {
    const { POST } = await import("../src/app/api/notes/import/route");
    const folder = await client.folder.create({ data: { id: "direct-existing", name: "Thư mục có sẵn" } });
    const dates = {
      createdAt: new Date("2026-10-05T01:00:00.000Z"),
      updatedAt: new Date("2026-10-05T02:00:00.000Z"),
    };
    const metadata = { title: "Tiêu đề", content: "<p>Tiếng Việt</p>", plainText: "Tiếng Việt", pinned: true, ...dates };
    const direct = { id: "direct-keep", folderId: folder.id, ...metadata };
    const fallback = { id: "direct-fallback", folderId: "missing-folder", ...metadata };
    const response = await POST(post("/notes/import", { app: "OpenNote", version: 1, notes: [direct, fallback] }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true, importedFolders: 0, skippedFolders: 0, importedNotes: 2, skippedNotes: 0, lockedImported: 0,
    });
    const select = { id: true, folderId: true, title: true, content: true, plainText: true,
      pinned: true, createdAt: true, updatedAt: true } as const;
    assert.deepEqual(await client.note.findUniqueOrThrow({ where: { id: direct.id }, select }), direct);
    assert.deepEqual(await client.note.findUniqueOrThrow({ where: { id: fallback.id }, select }),
      { ...fallback, folderId: "folder-notes-default" });
  });

  test("passes special folder IDs through query mutations and preserves note links", async () => {
    const { PATCH, DELETE } = await import("../src/app/api/folders/route");
    const legacy = await import("../src/app/api/folders/[id]/route");
    const mutate = (method: string, query: string, body?: object) => new Request(base + "/folders" + query, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const query of ["", "?id="]) {
      assert.equal((await PATCH(mutate("PATCH", query, { name: "Mới" }))).status, 400);
      assert.equal((await DELETE(mutate("DELETE", query))).status, 400);
    }
    for (const id of ["team/qa", "tên #%? +", ".", ".."]) {
      await client.folder.create({ data: { id, name: "Cũ" } });
      const live = await client.note.create({ data: { folderId: id } });
      const trash = await client.note.create({ data: { folderId: id, deletedAt: new Date() } });
      const query = "?" + new URLSearchParams({ id });
      const result = await PATCH(mutate("PATCH", query, { name: "Mới" }));
      assert.equal(result.status, 200);
      assert.equal((await result.json()).id, id);
      assert.equal((await client.note.findUniqueOrThrow({ where: { id: live.id } })).folderId, id);
      assert.equal((await client.note.findUniqueOrThrow({ where: { id: trash.id } })).folderId, id);
      assert.equal((await DELETE(mutate("DELETE", query))).status, 200);
      assert.equal((await client.note.findUniqueOrThrow({ where: { id: live.id } })).folderId, "folder-notes-default");
      assert.equal((await client.note.findUniqueOrThrow({ where: { id: trash.id } })).folderId, "folder-trash-default");
    }
    const normal = await client.folder.create({ data: { name: "URL cũ" } });
    const params = { params: Promise.resolve({ id: normal.id }) };
    assert.equal((await legacy.PATCH(mutate("PATCH", "/" + normal.id, { name: "Đã đổi" }), params)).status, 200);
    assert.equal((await legacy.DELETE(mutate("DELETE", "/" + normal.id), params)).status, 200);
    assert.equal((await DELETE(mutate("DELETE", "?id=folder-notes-default"))).status, 400);
  });

  test("serializes a concurrent move between export reads", async () => {
    const { GET } = await import("../src/app/api/notes/export/route");
    const writer = new Database(url.slice(5));
    writer.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0");
    const originalFolder = await client.folder.create({ data: { name: "Xuất A" } });
    const note = await client.note.create({ data: { folderId: originalFolder.id } });
    const newFolder = "snapshot-folder-B";
    const move = writer.transaction(() => {
      writer.query("INSERT INTO Folder (id, name, updatedAt) VALUES (?, ?, ?)").run(newFolder, "Xuất B", Date.now());
      writer.query("UPDATE Note SET folderId = ? WHERE id = ?").run(newFolder, note.id);
    });
    const transaction = client.$transaction;
    let attempts = 0;
    client.$transaction = (async (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
      transaction.call(client, async (tx: Prisma.TransactionClient) => {
        const findMany = tx.folder.findMany;
        tx.folder.findMany = (async (args?: Prisma.FolderFindManyArgs) => {
          const folders = await findMany.call(tx.folder, args);
          attempts++;
          // Prisma currently uses BEGIN IMMEDIATE, so a second writer must wait.
          assert.throws(() => move.immediate(), { code: "SQLITE_BUSY" });
          return folders;
        }) as typeof findMany;
        try { return await operation(tx); } finally { tx.folder.findMany = findMany; }
      })) as typeof client.$transaction;
    try {
      const first = await GET();
      assert.equal(first.status, 200);
      const snapshot = await first.json();
      assert.equal(attempts, 1);
      assert.equal(snapshot.notes.find(({ id }: { id: string }) => id === note.id).folderId, originalFolder.id);
      assert.ok(snapshot.folders.some(({ id }: { id: string }) => id === originalFolder.id));
      assert.ok(!snapshot.folders.some(({ id }: { id: string }) => id === newFolder));
      client.$transaction = transaction;
      move.immediate();
      const updated = await (await GET()).json();
      assert.equal(updated.notes.find(({ id }: { id: string }) => id === note.id).folderId, newFolder);
      assert.ok(updated.folders.some(({ id }: { id: string }) => id === newFolder));
    } finally {
      client.$transaction = transaction;
      writer.close();
    }
  });

  test("preserves saved titles and folder links when an edit is rejected", async () => {
    const detail = await import("../src/app/api/notes/[id]/route");
    assert.equal("DELETE" in detail, false);
    const folder = await client.folder.create({ data: { name: "Đích thử" } });
    const note = await client.note.create({ data: { folderId: folder.id } });
    const patch = (body: object) => detail.PATCH(
      new Request(base + "/notes/" + note.id, { method: "PATCH", body: JSON.stringify(body) }),
      { params: Promise.resolve({ id: note.id }) },
    );
    for (const title of ["ă".repeat(499), "ă".repeat(498) + "😀"]) {
      const response = await patch({ title });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).title, title);
    }
    const legacyTitle = "ă".repeat(501);
    assert.equal((await patch({ title: legacyTitle })).status, 400);
    assert.equal((await patch({ folderId: "folder-trash-default" })).status, 400);
    const missingFolder = await patch({ folderId: "old-folder" });
    assert.equal(missingFolder.status, 409);
    assert.equal((await missingFolder.json()).code, "FOLDER_NOT_FOUND");
    const unchanged = await client.note.findUniqueOrThrow({ where: { id: note.id } });
    assert.equal(unchanged.title.length, 500);
    assert.equal(unchanged.folderId, folder.id);
    await client.note.update({ where: { id: note.id }, data: { title: legacyTitle } });
    const result = await patch({ title: legacyTitle, content: "<p>Mới</p>" });
    assert.equal(result.status, 200);
    const updated = await result.json();
    assert.equal(updated.content, "<p>Mới</p>");
    assert.equal(updated.title, legacyTitle);
  });

  test("keeps the API loopback-only without disrupting local callers", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("../src/proxy");
    const request = (method: string, headers: Record<string, string>) =>
      proxy(new NextRequest(base + "/notes", { method, headers }));
    assert.equal(request("GET", { host: "127.0.0.1:16347" }).status, 200);
    assert.equal(request("GET", { host: "localhost:16347", "sec-fetch-site": "none" }).status, 200);
    assert.equal(request("POST", {
      host: "127.0.0.1:16347", origin: "http://127.0.0.1:16347", "sec-fetch-site": "same-origin",
    }).status, 200);
    assert.equal(request("GET", { host: "example.test:16347" }).status, 403);
    assert.equal(request("GET", {
      host: "127.0.0.1:16347", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-site",
    }).status, 403);
  });
});
