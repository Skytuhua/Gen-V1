import { execFile, type ChildProcess } from "node:child_process";
import { HarnessError } from "../contracts/index.ts";

/** Workers are process-group leaders on POSIX; Windows requires taskkill /T. */
export async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exit = new Promise<void>(resolve => child.once("exit", () => resolve()));
  if (process.platform === "win32") {
    const error = await new Promise<Error | null>(resolve => execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 }, error => resolve(error)));
    if (error && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      throw new HarnessError("PI_CANCEL_UNCONFIRMED", "Windows could not confirm Pi process-tree cancellation. Inspect the run before resuming.");
    }
  } else {
    try { process.kill(-child.pid, "SIGKILL"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([exit, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new HarnessError("PI_CANCEL_UNCONFIRMED", "Pi process exit could not be confirmed after cancellation.")), 5000);
    })]);
  } finally { clearTimeout(timer); }
}
