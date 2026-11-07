import AppKit
import Darwin
import Foundation

private let port = 16347
private let address = URL(string: "http://127.0.0.1:\(port)")!

private struct Options {
    var directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("OpenNote", isDirectory: true)
    var source: URL?
    var testing = false

    init() throws {
        var args = Array(CommandLine.arguments.dropFirst())
        if args.first == "--test-data-dir", args.count >= 2 {
            let candidate = URL(fileURLWithPath: args[1]).standardizedFileURL.resolvingSymlinksInPath()
            guard candidate.path.hasPrefix("/private/tmp/") || candidate.path.hasPrefix("/tmp/") else {
                throw LaunchError("Thư mục kiểm thử phải nằm trong /private/tmp.")
            }
            directory = candidate
            testing = true
            args.removeFirst(2)
        }
        if args.count == 2 && args[0] == "--migrate-from", args[1].hasPrefix("/") {
            source = URL(fileURLWithPath: args[1])
        } else if !args.isEmpty {
            throw LaunchError("Cú pháp: OpenNote --migrate-from <đường dẫn tuyệt đối tới SQLite>")
        }
    }
}

private func listener(_ pid: Int32? = nil) -> Bool {
    let probe = Process()
    probe.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
    var args = ["-nP", "-iTCP:\(port)", "-sTCP:LISTEN"]
    if let pid { args += ["-a", "-p", String(pid)] }
    probe.arguments = args
    let output = Pipe()
    probe.standardOutput = output
    probe.standardError = FileHandle.nullDevice
    do { try probe.run() } catch { return false }
    let contents = output.fileHandleForReading.readDataToEndOfFile()
    probe.waitUntilExit()
    if pid != nil {
        return probe.terminationStatus == 0 &&
            String(decoding: contents, as: UTF8.self).contains("127.0.0.1:\(port) (LISTEN)")
    }
    return probe.terminationStatus == 0
}

private final class Launcher: NSObject, NSApplicationDelegate {
    let options: Options
    let resources: URL
    var data: DataDirectory?
    var server: Process?
    var lifeline: Pipe?
    var check: Timer?
    var requestPending = false
    var ready = false
    var ending = false
    var deadline: TimeInterval = 0

    init(options: Options, resources: URL) {
        self.options = options
        self.resources = resources
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            guard !listener() else { throw LaunchError("Cổng \(port) đang được sử dụng. Hãy giải phóng cổng rồi mở lại OpenNote.") }
            let data = try DataDirectory(options.directory)
            self.data = data
            try data.prepare(schema: resources.appendingPathComponent("empty-schema.sql"))
            let process = Process()
            let input = Pipe()
            let serverDirectory = resources.appendingPathComponent("server")
            process.executableURL = resources.deletingLastPathComponent().appendingPathComponent("Helpers/bun")
            process.currentDirectoryURL = serverDirectory
            process.arguments = ["--no-env-file", "server-lifetime.cjs"]
            process.environment = [
                "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
                "HOSTNAME": "127.0.0.1",
                "PORT": String(port),
                "NODE_ENV": "production",
                "NEXT_TELEMETRY_DISABLED": "1",
                "DATABASE_URL": "file:" + data.database.path,
            ]
            process.standardInput = input
            process.standardOutput = FileHandle.nullDevice
            process.standardError = options.testing ? FileHandle.standardError : FileHandle.nullDevice
            process.terminationHandler = { [weak self] _ in
                DispatchQueue.main.async {
                    guard let self, !self.ending else { return }
                    self.fail(LaunchError("Máy chủ OpenNote đã dừng ở cổng \(port). Hãy mở lại ứng dụng."))
                }
            }
            try process.run()
            server = process
            lifeline = input
            deadline = ProcessInfo.processInfo.systemUptime + 15
            check = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.poll() }
        } catch {
            fail(error)
        }
    }

    func poll() {
        guard let server, server.isRunning else { return }
        if ProcessInfo.processInfo.systemUptime >= deadline {
            fail(LaunchError("Máy chủ OpenNote chưa sẵn sàng sau 15 giây tại cổng \(port)."))
            return
        }
        guard !requestPending, listener(server.processIdentifier) else { return }
        requestPending = true
        var request = URLRequest(url: address.appendingPathComponent("api"))
        request.timeoutInterval = 0.8
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                self.requestPending = false
                guard !self.ending, self.server?.isRunning == true,
                      (response as? HTTPURLResponse)?.statusCode == 200 else { return }
                self.check?.invalidate()
                self.ready = true
                self.openBrowser()
            }
        }.resume()
    }

    @objc func openBrowser() {
        guard ready, !options.testing else { return }
        if !NSWorkspace.shared.open(address) {
            show("Mở OpenNote tại \(address.absoluteString) trong trình duyệt.")
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openBrowser()
        return false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard ready, !ending, !options.testing else { return .terminateNow }
        let alert = NSAlert()
        alert.messageText = "Thoát OpenNote?"
        alert.informativeText = "Hãy đợi lưu xong và đóng các tab OpenNote trước khi dừng máy chủ."
        alert.addButton(withTitle: "Ở lại")
        alert.addButton(withTitle: "Thoát")
        return alert.runModal() == .alertSecondButtonReturn ? .terminateNow : .terminateCancel
    }

    func applicationWillTerminate(_ notification: Notification) { stop() }

    private func stop() {
        ending = true
        check?.invalidate()
        try? lifeline?.fileHandleForWriting.close()
        if let server, server.isRunning {
            let deadline = ProcessInfo.processInfo.systemUptime + 2
            while server.isRunning && ProcessInfo.processInfo.systemUptime < deadline {
                Thread.sleep(forTimeInterval: 0.025)
            }
            if server.isRunning { kill(server.processIdentifier, SIGKILL) }
            server.waitUntilExit()
        }
        data = nil
    }

    private func show(_ message: String) {
        if options.testing {
            FileHandle.standardError.write(Data((message + "\n").utf8))
            return
        }
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "OpenNote"
        alert.informativeText = message
        alert.runModal()
    }

    private func fail(_ error: Error) {
        stop()
        show(error.localizedDescription)
        exit(EXIT_FAILURE)
    }
}

umask(0o077)
do {
    let options = try Options()
    guard let resources = Bundle.main.resourceURL else { throw LaunchError("Không tìm thấy tài nguyên OpenNote.") }
    if let source = options.source {
        let directory = try DataDirectory(options.directory)
        let backup = try directory.migrate(from: source, upgrade: resources.appendingPathComponent("upgrade-trash-undo.sql"))
        print("Đã chuyển SQLite vào \(directory.database.path)\nBản sao trước nâng cấp: \(backup.path)")
    } else {
        let app = NSApplication.shared
        app.setActivationPolicy(options.testing ? .prohibited : .regular)
        let launcher = Launcher(options: options, resources: resources)
        let bar = NSMenu()
        let item = NSMenuItem()
        let menu = NSMenu()
        let openItem = menu.addItem(withTitle: "Mở OpenNote", action: #selector(Launcher.openBrowser), keyEquivalent: "o")
        openItem.target = launcher
        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle: "Thoát OpenNote", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.submenu = menu
        bar.addItem(item)
        app.mainMenu = bar
        app.delegate = launcher
        withExtendedLifetime(launcher) { app.run() }
    }
} catch {
    FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
    exit(EXIT_FAILURE)
}
