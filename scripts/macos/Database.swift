import CryptoKit
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
        try withWorkFile(install: publish, operation)
    }

    private func withWorkFile(install: (URL) throws -> Void, _ operation: (URL) throws -> Void) throws {
        let work = path.appendingPathComponent(".staging-\(UUID().uuidString).db")
        defer {
            for suffix in ["", "-journal", "-wal", "-shm"] {
                try? FileManager.default.removeItem(atPath: work.path + suffix)
            }
        }
        try operation(work)
        try install(work)
    }

    func prepare(schema: URL) throws {
        if FileManager.default.fileExists(atPath: database.path) {
            if try isLegacyDatabase(database) {
                throw LaunchError("Hãy đóng OpenNote cũ và chạy --migrate-from \"\(database.path)\" để nâng cấp SQLite.")
            }
            try validate(database)
            return
        }
        try requireVacantDestination()
        try withWorkFile { work in
            try execute(work, String(contentsOf: schema, encoding: .utf8))
            try validate(work)
        }
    }

    func migrate(from source: URL, upgrade: URL) throws -> URL? {
        let inPlace = source.standardizedFileURL.resolvingSymlinksInPath()
            == database.standardizedFileURL.resolvingSymlinksInPath()
        let original: DatabaseFingerprint?
        if inPlace {
            try requireNoJournal(database)
            let file = try openDatabaseFile(database)
            defer { try? file.close() }
            let fingerprint = try DatabaseFingerprint(database, file: file)
            try requireUnlockedDatabase(file)
            let isCurrent = try inspectInPlaceSchema(database)
            if isCurrent {
                guard try DatabaseFingerprint(database, file: file) == fingerprint else {
                    throw LaunchError("SQLite nguồn đã thay đổi trong lúc kiểm tra.")
                }
                try requireNoJournal(database)
                try requireUnlockedDatabase(file)
                try requireNoJournal(database)
                return nil
            }
            try requireNoJournal(database)
            try requireRollbackJournal(file)
            original = fingerprint
        } else {
            try requireVacantDestination()
            original = nil
        }
        let backups = path.appendingPathComponent("Backups")
        try FileManager.default.createDirectory(at: backups, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let archive = backups.appendingPathComponent("before-\(UUID().uuidString).db")
        do {
            try copyDatabase(from: inPlace ? database : source, to: archive)
            try validate(archive, requiresTrashAction: false)
            if inPlace {
                try syncPath(archive)
                try syncPath(backups)
                try syncPath(path)
            }
        } catch {
            try? FileManager.default.removeItem(at: archive)
            throw error
        }
        try withWorkFile(install: { work in
            if let original {
                try replaceLegacyDatabase(with: work, original: original, archive: archive)
            } else {
                try publish(work)
            }
        }) { work in
            try copyDatabase(from: archive, to: work)
            try execute(work, String(contentsOf: upgrade, encoding: .utf8))
            try validate(work)
            try verifyMigration(original: archive, upgraded: work)
        }
        return archive
    }

    private func replaceLegacyDatabase(with work: URL, original: DatabaseFingerprint, archive: URL) throws {
        try syncPath(work)
        try requireNoJournal(database)
        let file = try openDatabaseFile(database)
        defer { try? file.close() }
        guard try DatabaseFingerprint(database, file: file) == original else {
            throw LaunchError("SQLite nguồn đã thay đổi. Dữ liệu hiện hành và bản sao được giữ nguyên.")
        }
        // Closing another descriptor for this inode can release SQLite's POSIX locks.
        // Keep the fingerprint descriptor open until after the exclusive transaction ends.
        try withDatabase(database, SQLITE_OPEN_READWRITE) { source in
            guard try first(source, "PRAGMA journal_mode") == "delete" else {
                throw LaunchError("Hãy đóng OpenNote cũ và hoàn tất nhật ký SQLite trước khi nâng cấp.")
            }
            try sql(source, "BEGIN EXCLUSIVE")
            defer { try? sql(source, "ROLLBACK") }
            try requireNoJournal(database)
            guard try DatabaseFingerprint(database, file: file) == original else {
                throw LaunchError("SQLite nguồn đã thay đổi. Dữ liệu hiện hành và bản sao được giữ nguyên.")
            }
            guard rename(work.path, database.path) == 0 else {
                throw LaunchError("Không thay được SQLite. Dữ liệu hiện hành và bản sao được giữ nguyên.")
            }
            do {
                try syncPath(path)
            } catch {
                throw LaunchError("Đã thay SQLite nhưng chưa xác nhận đồng bộ thư mục. Bản sao: \(archive.path)")
            }
        }
    }
}

private struct DatabaseFingerprint: Equatable {
    let device: dev_t
    let inode: ino_t
    let digest: SHA256.Digest

    init(_ url: URL, file: FileHandle) throws {
        var info = stat()
        var entry = stat()
        guard fstat(file.fileDescriptor, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
              lstat(url.path, &entry) == 0, info.st_dev == entry.st_dev, info.st_ino == entry.st_ino else {
            throw LaunchError("SQLite đích đã thay đổi hoặc không phải tệp thông thường.")
        }
        device = info.st_dev
        inode = info.st_ino
        try file.seek(toOffset: 0)
        var hash = SHA256()
        while let bytes = try file.read(upToCount: 1 << 20), !bytes.isEmpty {
            hash.update(data: bytes)
        }
        digest = hash.finalize()
    }
}

private func openDatabaseFile(_ url: URL) throws -> FileHandle {
    let descriptor = open(url.path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK)
    guard descriptor >= 0 else { throw LaunchError("Không mở được tệp SQLite đích: \(url.path)") }
    return FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
}

private func requireUnlockedDatabase(_ file: FileHandle) throws {
    // Query for a conflicting write lock across the file without acquiring one.
    var probe = flock(l_start: 0, l_len: 0, l_pid: 0, l_type: Int16(F_WRLCK), l_whence: Int16(SEEK_SET))
    var result: Int32
    repeat {
        result = fcntl(file.fileDescriptor, F_GETLK, &probe)
    } while result == -1 && errno == EINTR
    guard result != -1 else {
        throw LaunchError("Không kiểm tra được khóa SQLite.")
    }
    guard probe.l_type == Int16(F_UNLCK) else {
        throw LaunchError("SQLite đang bị khóa. Hãy đóng tiến trình đang dùng SQLite rồi thử lại.")
    }
}

private func requireRollbackJournal(_ file: FileHandle) throws {
    try file.seek(toOffset: 18)
    if let version = try file.read(upToCount: 2), version.contains(2) {
        throw LaunchError("SQLite còn dùng chế độ WAL. Hãy chuyển dữ liệu từ bản sao SQLite đã đóng sang đích trống.")
    }
}

private func requireNoJournal(_ url: URL) throws {
    for suffix in ["-wal", "-shm", "-journal"] {
        let sidecar = url.path + suffix
        var info = stat()
        guard lstat(sidecar, &info) != 0 && errno == ENOENT else {
            throw LaunchError("Hãy đóng OpenNote cũ và hoàn tất tệp nhật ký SQLite: \(sidecar)")
        }
    }
}

private func syncPath(_ url: URL) throws {
    let file = open(url.path, O_RDONLY | O_CLOEXEC)
    guard file >= 0 else { throw LaunchError("Không mở được để đồng bộ: \(url.path)") }
    defer { close(file) }
    guard fsync(file) == 0 else { throw LaunchError("Không đồng bộ được: \(url.path)") }
}

private func isLegacyDatabase(_ url: URL) throws -> Bool {
    try withDatabase(url, SQLITE_OPEN_READONLY) { db in
        guard try first(db, "SELECT name FROM sqlite_schema WHERE name='TrashAction' AND type='table'") == nil else {
            return false
        }
        let folderColumns = "id,name,isSystem,createdAt,updatedAt"
        let noteColumns = "id,title,content,plainText,pinned,locked,pinHash,folderId,deletedAt,createdAt,updatedAt"
        for (table, expected) in [("Folder", folderColumns), ("Note", noteColumns)] {
            let columns = try first(db, "SELECT group_concat(name, ',') FROM (SELECT name FROM pragma_table_info('\(table)') ORDER BY name)")
            guard columns == expected.split(separator: ",").sorted().joined(separator: ",") else { return false }
        }
        return true
    }
}

private func withDatabase<T>(_ url: URL, _ flags: Int32, asURI: Bool = false, _ operation: (OpaquePointer) throws -> T) throws -> T {
    var handle: OpaquePointer?
    let result = sqlite3_open_v2(asURI ? url.absoluteString : url.path, &handle, flags, nil)
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

private func inspectInPlaceSchema(_ url: URL) throws -> Bool {
    // The caller checks for active locks and journal sidecars around schema inspection.
    guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
        throw LaunchError("Không tạo được đường dẫn kiểm tra SQLite.")
    }
    components.queryItems = [URLQueryItem(name: "mode", value: "ro"), URLQueryItem(name: "immutable", value: "1")]
    guard let snapshot = components.url else {
        throw LaunchError("Không tạo được đường dẫn kiểm tra SQLite.")
    }
    return try withDatabase(snapshot, SQLITE_OPEN_READONLY | SQLITE_OPEN_URI, asURI: true) { db in
        let isCurrent = try first(db, "SELECT 1 FROM sqlite_schema WHERE type='table' AND name='TrashAction'") != nil
        try verifyTableLayout(db, table: "Folder", columns: [
            ("id", .text, true), ("name", .text, true), ("isSystem", .numeric, true),
            ("createdAt", .numeric, true), ("updatedAt", .numeric, true),
        ])
        try verifyTableLayout(db, table: "Note", columns: [
            ("id", .text, true), ("title", .text, true), ("content", .text, true),
            ("plainText", .text, true), ("pinned", .numeric, true), ("locked", .numeric, true),
            ("pinHash", .text, false), ("folderId", .text, true), ("deletedAt", .numeric, false),
            ("createdAt", .numeric, true), ("updatedAt", .numeric, true),
        ])
        if isCurrent {
            try verifyTableLayout(db, table: "TrashAction", columns: [
                ("id", .text, true), ("idsHash", .text, true), ("sealed", .text, false),
                ("count", .integer, true), ("expiresAt", .numeric, true),
            ])
        }
        let foreignKey = """
            SELECT 1
            FROM pragma_foreign_key_list('Note') AS fk
            WHERE fk."from"='folderId' AND fk."table"='Folder' AND fk."to"='id'
              AND fk.on_update='CASCADE' AND fk.on_delete='CASCADE'
              AND (SELECT count(*) FROM pragma_foreign_key_list('Note') WHERE id=fk.id)=1
            """
        guard try first(db, foreignKey) != nil,
              try first(db, "PRAGMA integrity_check") == "ok",
              try first(db, "PRAGMA foreign_key_check") == nil else {
            throw LaunchError("SQLite không đạt kiểm tra quan hệ ghi chú–thư mục hoặc toàn vẹn dữ liệu.")
        }
        return isCurrent
    }
}

private enum SQLiteAffinity {
    case integer, text, blob, real, numeric

    init(_ declaration: String) {
        let type = declaration.uppercased()
        if type.contains("INT") { self = .integer }
        else if type.contains("CHAR") || type.contains("CLOB") || type.contains("TEXT") { self = .text }
        else if type.isEmpty || type.contains("BLOB") { self = .blob }
        else if type.contains("REAL") || type.contains("FLOA") || type.contains("DOUB") { self = .real }
        else { self = .numeric }
    }
}

private func verifyTableLayout(
    _ db: OpaquePointer, table: String, columns: [(name: String, affinity: SQLiteAffinity, required: Bool)]
) throws {
    let info = "pragma_table_info('\(table)')"
    guard try first(db, "SELECT 1 FROM sqlite_schema WHERE type='table' AND name='\(table)'") != nil,
          try first(db, "SELECT count(*) FROM \(info) WHERE pk>0") == "1" else {
        throw LaunchError("Lược đồ SQLite của bảng \(table) không tương thích.")
    }
    for column in columns {
        let query = """
            SELECT type FROM \(info)
            WHERE name='\(column.name)' AND "notnull"=\(column.required ? 1 : 0) AND pk=\(column.name == "id" ? 1 : 0)
            """
        guard let type = try first(db, query), SQLiteAffinity(type) == column.affinity else {
            throw LaunchError("Cột SQLite \(table).\(column.name) bị thiếu hoặc không tương thích.")
        }
    }
    let knownColumns = columns.map { "'\($0.name)'" }.joined(separator: ",")
    guard try first(db, "SELECT name FROM \(info) WHERE name NOT IN (\(knownColumns)) AND \"notnull\"=1 AND dflt_value IS NULL") == nil else {
        throw LaunchError("Bảng SQLite \(table) có cột bắt buộc ngoài lược đồ OpenNote.")
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
