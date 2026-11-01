import { spawn } from "node:child_process";
import { join } from "node:path";
import { HarnessError } from "../contracts/index.ts";
export interface ProcessResult { status: "succeeded" | "failed" | "cancelled"; exitCode: number | null; signal: string | null; cancelled: boolean; timedOut: boolean; stdout: string; stderr: string; truncated: boolean }
export function processEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) if (process.env[name]) env[name] = process.env[name];
  return { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1" };
}
export async function runProcess(command: string, args: string[], cwd: string, signal: AbortSignal, progress: (message: string) => void, timeoutMs = 120_000): Promise<ProcessResult> {
  if (signal.aborted) throw new HarnessError("CANCELLED", "Operation cancelled before process start");
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: processEnvironment(), shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", truncated = false, cancelled = false, timedOut = false, settled = false;
    const append = (current: string, data: Buffer) => { const next = current + data.toString("utf8"); if (Buffer.byteLength(next) > 256 * 1024) { truncated = true; return next.slice(0, 128 * 1024); } return next; };
    child.stdout.on("data", data => { stdout = append(stdout, data); }); child.stderr.on("data", data => { stderr = append(stderr, data); });
    let treeKill: Promise<void> | undefined;
    function stop() {
      if (!child.pid || settled || treeKill) return;
      progress("Terminating process tree");
      if (process.platform === "win32") {
        const executable = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
        treeKill = new Promise(done => {
          const killer = spawn(executable, ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, shell: false, stdio: "ignore" });
          killer.once("error", () => { child.kill(); done(); }); killer.once("close", () => done());
        });
      } else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } treeKill = Promise.resolve(); }
    }
    const onAbort = () => { cancelled = true; stop(); };
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs); timer.unref();
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); };
    child.once("spawn", () => { progress(`Started ${command === process.execPath ? "node --test" : "git"} (PID ${child.pid})`); if (signal.aborted) onAbort(); });
    child.once("error", error => { settled = true; cleanup(); reject(error); });
    child.once("close", async (exitCode, terminationSignal) => { cleanup(); await treeKill; settled = true; progress(`Process exited: ${exitCode ?? terminationSignal ?? "unknown"}`); resolve({ status: cancelled ? "cancelled" : !timedOut && exitCode === 0 ? "succeeded" : "failed", exitCode, signal: terminationSignal, cancelled, timedOut, stdout, stderr, truncated }); });
  });
}
