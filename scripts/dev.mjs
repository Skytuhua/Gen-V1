import { spawn } from "node:child_process";
await import("./build-widgets.mjs");
// The shared bundle uses production React; dev children keep the caller's mode.
const nodeEnv = process.env.NODE_ENV;
await import("./build-plugin-runtime.mjs");
if (nodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = nodeEnv;
const processes = [
  spawn(process.execPath, ["--import", "tsx", "apps/server/main.ts"], { stdio: "inherit", env: { ...process.env, HARNESS_DEV: "1" } }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js"], { stdio: "inherit" })
];
const active = new Set(processes);
let closing = false, shutdownTimer;
function close(code=0) {
  if (closing) return;
  closing = true;
  process.exitCode = code;
  for (const child of active) child.kill();
  if (active.size) {
    shutdownTimer = setTimeout(() => {
      for (const child of active) child.kill('SIGKILL');
    }, 300);
    shutdownTimer.unref();
  }
}
for (const [index, child] of processes.entries()) {
  const name = index === 0 ? "server" : "vite";
  child.on("error", error => {
    console.error(`Development ${name} process error: ${error.message}`);
    close(1);
  });
  child.once("exit", code => {
    active.delete(child);
    close(code ?? 1);
  });
  child.once("close", () => {
    active.delete(child);
    if (!active.size) clearTimeout(shutdownTimer);
  });
}
process.on("SIGINT",()=>close());process.on("SIGTERM",()=>close());
