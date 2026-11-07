process.stdin.on("end", () => process.kill(process.pid, "SIGTERM"));
process.stdin.resume();
require("./server.js");
