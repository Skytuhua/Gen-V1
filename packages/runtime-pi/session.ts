import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { HarnessError, type StartRun } from "../contracts/index.ts";
import { loadSdk } from "./sdk.ts";

export function taskPaths(dataDir: string, threadId: string) {
  const agentDir = resolve(dataDir, "pi");
  const taskDir = join(agentDir, "tasks", createHash("sha256").update(threadId).digest("hex"));
  return { agentDir, taskDir, sessionsDir: join(taskDir, "sessions"), authPath: join(agentDir, "auth.json") };
}

function within(root: string, path: string) {
  const part = relative(root, path);
  return part !== "" && !part.startsWith("..") && !isAbsolute(part);
}

export async function validateSessionPath(dataDir: string, sessionPath: string, threadId?: string): Promise<string> {
  const expected = threadId === undefined ? resolve(dataDir, "pi", "tasks") : taskPaths(dataDir, threadId).sessionsDir;
  const path = resolve(sessionPath);
  if (!within(expected, path) || !path.endsWith(".jsonl")) throw new HarnessError("PI_SESSION_MISMATCH", "Pi session does not belong to this task.");
  const [realRoot, realFile] = await Promise.all([realpath(expected), realpath(path)]);
  if (!within(realRoot, realFile) || !(await stat(realFile)).isFile()) throw new HarnessError("PI_SESSION_MISMATCH", "Pi session is outside task storage.");
  const first = (await readFile(realFile, "utf8")).split(/\r?\n/, 1)[0];
  try {
    const header = JSON.parse(first);
    if (header.type !== "session" || typeof header.id !== "string" || typeof header.version !== "number") throw new Error();
  } catch { throw new HarnessError("PI_SESSION_INVALID", "The selected Pi session has an invalid session header."); }
  return realFile;
}

export async function openTaskSession(dataDir: string, input: Pick<StartRun, "threadId" | "sessionPath">) {
  const sdk = await loadSdk();
  const paths = taskPaths(dataDir, input.threadId);
  await mkdir(paths.sessionsDir, { recursive: true, mode: 0o700 });
  if (input.sessionPath) {
    const path = await validateSessionPath(dataDir, input.sessionPath, input.threadId);
    return sdk.SessionManager.open(path, dirname(path), paths.taskDir);
  }
  return sdk.SessionManager.create(paths.taskDir, paths.sessionsDir);
}
