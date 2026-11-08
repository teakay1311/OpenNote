process.stdin.on("end", () => process.kill(process.pid, "SIGTERM"));
process.stdin.resume();
// eslint-disable-next-line @typescript-eslint/no-require-imports -- The standalone Next.js entry point is CommonJS.
require("./server.js");
