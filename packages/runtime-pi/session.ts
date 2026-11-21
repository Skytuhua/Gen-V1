import { createHash } from "node:crypto";
import { mkdir, open, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { HarnessError, type StartRun } from "../contracts/index.ts";
import { loadSdk } from "./sdk.ts";
import type { ModelPurpose } from "../runtime/model-only.ts";

export function taskPaths(dataDir: string, threadId: string) {
  const agentDir = resolve(dataDir, "pi");
  const taskDir = join(agentDir, "tasks", createHash("sha256").update(threadId).digest("hex"));
  return { agentDir, taskDir, sessionsDir: join(taskDir, "sessions"), authPath: join(agentDir, "auth.json") };
}

function within(root: string, path: string) {
  const part = relative(root, path);
  return part !== "" && !part.startsWith("..") && !isAbsolute(part);
}

const SESSION_HEADER_BYTES = 64 * 1024;
const invalidHeader = () => new HarnessError("PI_SESSION_INVALID", "The selected Pi session has an invalid session header.");

// Resume only needs the first JSONL record. Transcript size must not determine
// the memory cost of this validation.
async function readSessionHeader(path: string): Promise<string> {
  const file = await open(path, "r");
  try {
    const header = Buffer.alloc(SESSION_HEADER_BYTES + 1);
    const decode = (end: number) => {
      try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(header.subarray(0, end)); }
      catch { throw invalidHeader(); }
    };
    let length = 0;
    while (length < header.length) {
      const {bytesRead} = await file.read(header, length, Math.min(4096, header.length - length), length);
      if (!bytesRead) return decode(length);
      const newline = header.subarray(length, length + bytesRead).indexOf(10);
      if (newline !== -1) return decode(length + newline);
      length += bytesRead;
    }
    throw invalidHeader();
  } finally { await file.close(); }
}

export async function validateSessionPath(dataDir: string, sessionPath: string, threadId?: string): Promise<string> {
  const expected = threadId === undefined ? resolve(dataDir, "pi", "tasks") : taskPaths(dataDir, threadId).sessionsDir;
  const path = resolve(sessionPath);
  if (!within(expected, path) || !path.endsWith(".jsonl")) throw new HarnessError("PI_SESSION_MISMATCH", "Pi session does not belong to this task.");
  const [realRoot, realFile] = await Promise.all([realpath(expected), realpath(path)]);
  if (!within(realRoot, realFile) || !(await stat(realFile)).isFile()) throw new HarnessError("PI_SESSION_MISMATCH", "Pi session is outside task storage.");
  const first = await readSessionHeader(realFile);
  try {
    const header = JSON.parse(first);
    if (header.type !== "session" || typeof header.id !== "string" || typeof header.version !== "number") throw new Error();
  } catch { throw invalidHeader(); }
  return realFile;
}

export async function openTaskSession(dataDir: string, input: Pick<StartRun, "threadId" | "sessionPath">, purpose?: ModelPurpose) {
  const sdk = await loadSdk();
  const paths = taskPaths(dataDir, input.threadId);
  if (purpose === 'memory-extraction' || purpose === 'composer-enhance') {
    const code = purpose === 'memory-extraction' ? 'MEMORY_EXTRACTION_SESSION_UNSUPPORTED' : 'ENHANCE_SESSION_UNSUPPORTED';
    if (input.sessionPath !== null) throw new HarnessError(code, 'This isolated purpose cannot resume or persist a native conversation.');
    return sdk.SessionManager.inMemory(paths.taskDir);
  }
  await mkdir(paths.sessionsDir, { recursive: true, mode: 0o700 });
  if (input.sessionPath) {
    const path = await validateSessionPath(dataDir, input.sessionPath, input.threadId);
    return sdk.SessionManager.open(path, dirname(path), paths.taskDir);
  }
  return sdk.SessionManager.create(paths.taskDir, paths.sessionsDir);
}
