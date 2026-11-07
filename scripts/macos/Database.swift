import Darwin
import Foundation
import SQLite3

struct LaunchError: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
}

final class DataDirectory {
    let path: URL
    let database: URL
    private let lock: Int32

    init(_ path: URL) throws {
        self.path = path
        database = path.appendingPathComponent("custom.db")
        try FileManager.default.createDirectory(at: path, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let descriptor = open(path.appendingPathComponent(".opennote.lock").path,
                              O_CREAT | O_CLOEXEC | O_NOFOLLOW | O_RDWR, 0o600)
        guard descriptor >= 0 else { throw LaunchError("Không mở được khóa thư mục dữ liệu.") }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            let busy = errno == EWOULDBLOCK
            close(descriptor)
            throw LaunchError(busy ? "OpenNote đang dùng thư mục dữ liệu này." : "Không khóa được thư mục dữ liệu.")
        }
        lock = descriptor
    }

    deinit { close(lock) }

    private func requireVacantDestination() throws {
        for suffix in ["", "-wal", "-shm", "-journal"] {
            var info = stat()
            let present = lstat(database.path + suffix, &info) == 0
            guard !present && errno == ENOENT else {
                throw LaunchError("Đích đã có SQLite hoặc tệp nhật ký. Hãy giữ nguyên dữ liệu đang có.")
            }
        }
    }

    private func publish(_ work: URL) throws {
        try requireVacantDestination()
        guard link(work.path, database.path) == 0 else {
            throw LaunchError("Không đặt được SQLite vào vị trí đích. Dữ liệu đang có vẫn được giữ.")
        }
    }

    private func withWorkFile(_ operation: (URL) throws -> Void) throws {
        let work = path.appendingPathComponent(".staging-\(UUID().uuidString).db")
        defer {
            for suffix in ["", "-journal", "-wal", "-shm"] {
                try? FileManager.default.removeItem(atPath: work.path + suffix)
            }
        }
        try operation(work)
        try publish(work)
    }

    func prepare(schema: URL) throws {
        if FileManager.default.fileExists(atPath: database.path) {
            try validate(database)
            return
        }
        try requireVacantDestination()
        try withWorkFile { work in
            try execute(work, String(contentsOf: schema, encoding: .utf8))
            try validate(work)
        }
    }

    func migrate(from source: URL, upgrade: URL) throws -> URL {
        try requireVacantDestination()
        let backups = path.appendingPathComponent("Backups")
        try FileManager.default.createDirectory(at: backups, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let archive = backups.appendingPathComponent("before-\(UUID().uuidString).db")
        do {
            try copyDatabase(from: source, to: archive)
            try validate(archive, requiresTrashAction: false)
        } catch {
            try? FileManager.default.removeItem(at: archive)
            throw error
        }
        try withWorkFile { work in
            try copyDatabase(from: archive, to: work)
            try execute(work, String(contentsOf: upgrade, encoding: .utf8))
            try validate(work)
            try verifyMigration(original: archive, upgraded: work)
        }
        return archive
    }
}

private func withDatabase<T>(_ url: URL, _ flags: Int32, _ operation: (OpaquePointer) throws -> T) throws -> T {
    var handle: OpaquePointer?
    let result = sqlite3_open_v2(url.path, &handle, flags, nil)
    defer { sqlite3_close(handle) }
    guard result == SQLITE_OK, let handle else {
        throw LaunchError("Không mở được SQLite tại \(url.path).")
    }
    sqlite3_busy_timeout(handle, 2_000)
    return try operation(handle)
}

private func sql(_ database: OpaquePointer, _ command: String) throws {
    guard sqlite3_exec(database, command, nil, nil, nil) == SQLITE_OK else {
        throw LaunchError("Thao tác SQLite thất bại: \(String(cString: sqlite3_errmsg(database)))")
    }
}

private func first(_ database: OpaquePointer, _ query: String) throws -> String? {
    var statement: OpaquePointer?
    defer { sqlite3_finalize(statement) }
    guard sqlite3_prepare_v2(database, query, -1, &statement, nil) == SQLITE_OK else {
        throw LaunchError("Lược đồ SQLite không hợp lệ: \(String(cString: sqlite3_errmsg(database)))")
    }
    switch sqlite3_step(statement) {
    case SQLITE_ROW:
        guard let text = sqlite3_column_text(statement, 0) else { return nil }
        return String(cString: text)
    case SQLITE_DONE: return nil
    default: throw LaunchError("Không đọc được SQLite: \(String(cString: sqlite3_errmsg(database)))")
    }
}

private func execute(_ url: URL, _ command: String) throws {
    try withDatabase(url, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE) { try sql($0, command) }
}

private func copyDatabase(from source: URL, to destination: URL) throws {
    try withDatabase(source, SQLITE_OPEN_READONLY) { original in
        try withDatabase(destination, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE) { copy in
            guard let backup = sqlite3_backup_init(copy, "main", original, "main") else {
                throw LaunchError("Không bắt đầu được sao lưu SQLite.")
            }
            let result = sqlite3_backup_step(backup, -1)
            let finish = sqlite3_backup_finish(backup)
            guard result == SQLITE_DONE && finish == SQLITE_OK else {
                throw LaunchError("Sao lưu SQLite chưa hoàn tất. Hãy đóng ứng dụng cũ rồi thử lại.")
            }
            guard try first(copy, "PRAGMA journal_mode=DELETE") == "delete" else {
                throw LaunchError("Không hoàn tất được nhật ký của bản sao SQLite.")
            }
        }
    }
}

private func validate(_ url: URL, requiresTrashAction: Bool = true) throws {
    try withDatabase(url, SQLITE_OPEN_READONLY) { db in
        let required = requiresTrashAction ? "'Folder','Note','TrashAction'" : "'Folder','Note'"
        guard try first(db, "SELECT count(*) FROM sqlite_schema WHERE type='table' AND name IN (\(required))")
                == (requiresTrashAction ? "3" : "2"),
              try first(db, "PRAGMA integrity_check") == "ok",
              try first(db, "PRAGMA foreign_key_check") == nil else {
            throw LaunchError("SQLite không đạt kiểm tra lược đồ, toàn vẹn hoặc khóa ngoại.")
        }
    }
}

private func verifyMigration(original: URL, upgraded: URL) throws {
    try withDatabase(upgraded, SQLITE_OPEN_READONLY | SQLITE_OPEN_URI) { db in
        let escapedPath = original.absoluteString.replacingOccurrences(of: "'", with: "''")
        try sql(db, "ATTACH DATABASE '\(escapedPath)?mode=ro' AS original")
        let fields = "id, title, content, plainText, pinned, locked, pinHash, createdAt, updatedAt, deletedAt"
        let expected = """
        SELECT \(fields), CASE WHEN folderId='folder-trash-default' AND deletedAt IS NULL
                               THEN 'folder-notes-default' ELSE folderId END FROM original.Note
        """
        let actual = "SELECT \(fields), folderId FROM main.Note"
        guard try first(db, "SELECT 1 FROM (\(expected) EXCEPT \(actual)) LIMIT 1") == nil,
              try first(db, "SELECT 1 FROM (\(actual) EXCEPT \(expected)) LIMIT 1") == nil,
              try first(db, "SELECT 1 FROM (SELECT * FROM original.Folder EXCEPT SELECT * FROM main.Folder) LIMIT 1") == nil,
              try first(db, """
                SELECT id FROM (SELECT * FROM main.Folder EXCEPT SELECT * FROM original.Folder)
                WHERE id <> 'folder-notes-default' OR name <> 'Ghi chú' OR isSystem <> 1
                LIMIT 1
                """) == nil else {
            throw LaunchError("Đối chiếu SQLite sau nâng cấp phát hiện dữ liệu sai khác.")
        }
        if try first(db, "SELECT name FROM original.sqlite_schema WHERE name='TrashAction' AND type='table'") != nil {
            guard try first(db, "SELECT 1 FROM (SELECT * FROM original.TrashAction EXCEPT SELECT * FROM main.TrashAction) LIMIT 1") == nil,
                  try first(db, "SELECT 1 FROM (SELECT * FROM main.TrashAction EXCEPT SELECT * FROM original.TrashAction) LIMIT 1") == nil else {
                throw LaunchError("Đối chiếu lịch sử thùng rác phát hiện dữ liệu sai khác.")
            }
        }
    }
}
