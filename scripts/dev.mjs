import { spawn } from "node:child_process";
await import("./build-widgets.mjs");
const processes = [
  spawn(process.execPath, ["--import", "tsx", "apps/server/main.ts"], { stdio: "inherit", env: { ...process.env, HARNESS_DEV: "1" } }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js"], { stdio: "inherit" })
];
let closing = false;
function close(code=0) { if(closing)return; closing=true; for(const child of processes) child.kill(); setTimeout(()=>process.exit(code),300).unref(); }
for(const child of processes) child.on("exit", code=>close(code??1));
process.on("SIGINT",()=>close());process.on("SIGTERM",()=>close());
