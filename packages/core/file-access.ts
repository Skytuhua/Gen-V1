import { spawn } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { open, lstat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { HarnessError, type ResourceGrant } from "../contracts/index.ts";
import { assertNotStorage, resolveGrant, PROTECTED_STORAGE_DIRECTORIES } from "./security.ts";

type GuardPath = { path: string; leaf: boolean; dev?: string; ino?: string; empty?: boolean; tree?: boolean; readOnly?: boolean; allowChildWrites?:boolean; childWriteRoot?:string };
export interface GuardEntry { readonly path: string; readonly directory: boolean; readonly dev: string; readonly ino: string; readonly size: number }
interface GuardSession { rpc(request: Record<string, unknown>): Promise<readonly GuardEntry[]>; exited: boolean }
const sessions = new AsyncLocalStorage<GuardSession>();
const denied = () => new HarnessError("CAPABILITY_DENIED", "Cannot establish a stable ordinary filesystem resource guard");
function active(signal: AbortSignal) { if (signal.aborted) throw new HarnessError("CANCELLED", "Filesystem operation cancelled"); }

/** Application-scoped Windows namespace guard; never an OS sandbox for project code. */
export async function withPathGuard<T>(paths: GuardPath[], signal: AbortSignal, action: (manifest: readonly GuardEntry[]) => Promise<T>): Promise<T> {
  if(paths.some(path=>path.allowChildWrites&&path.leaf))throw new HarnessError('CAPABILITY_DENIED','Child-write sharing is supported only for directory namespace guards.');
  active(signal);
  const session = sessions.getStore();
  if (session) {
    const id = randomUUID();
    const manifest = await session.rpc({ command: "acquire", id, paths });
    try { active(signal); const value = await action(manifest); if (session.exited) throw denied(); return value; }
    finally { if (!session.exited) await session.rpc({ command: "release", id }); }
  }
  if (process.platform !== "win32") throw denied();
  // Use the system binary and a fixed script: no shell, profiles, PATH lookup or command interpolation.
  const executable = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const child = spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", fileURLToPath(new URL("./windows-path-guard.ps1", import.meta.url))], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  child.stdout.setEncoding("utf8");
  const current: GuardSession = { exited: false, rpc: async () => [] };
  child.once("exit", () => { current.exited = true; });
  child.once("error", () => { current.exited = true; });
  let diagnostics = "";
  child.stderr.on("data", bytes => { if (diagnostics.length < 1024) diagnostics += String(bytes); });
  const closed = new Promise<void>(finish => child.once("close", () => { current.exited = true; finish(); }));
  let queue = Promise.resolve();
  current.rpc = request => {
    const pending = queue.then(() => new Promise<readonly GuardEntry[]>((accept, reject) => {
      if (current.exited) return reject(denied());
      let output = "";
      const timer = setTimeout(() => finish(denied()), 15_000);
      const failed = () => finish(new HarnessError("CAPABILITY_DENIED", "Cannot establish a stable ordinary filesystem resource guard", { nativeCode: /GUARD_NATIVE_ERROR:([-0-9]+)/.exec(diagnostics)?.[1] ?? "unavailable" }));
      const data = (bytes: string) => {
        output += bytes;
        if (output.length > 16 * 1024 * 1024) return finish(denied());
        if (!output.endsWith("\n")) return;
        if (output.trim() === request.id) return finish();
        try {
          const response = JSON.parse(output);
          if (response.id !== request.id || !Array.isArray(response.entries) || response.entries.length > 10000) return finish(denied());
          for (const entry of response.entries) {
            if (typeof entry.path !== "string" || typeof entry.directory !== "boolean" || !/^\d+$/.test(entry.dev) || !/^\d+$/.test(entry.ino) || !Number.isSafeInteger(entry.size) || entry.size < 0) return finish(denied());
            Object.freeze(entry);
          }
          finish(undefined, Object.freeze(response.entries));
        } catch { finish(denied()); }
      };
      const finish = (error?: Error, manifest: readonly GuardEntry[] = []) => { clearTimeout(timer); child.stdout.removeListener("data", data); child.removeListener("error", failed); child.removeListener("exit", failed); error ? reject(error) : accept(manifest); };
      child.once("error", failed); child.once("exit", failed); child.stdout.on("data", data);
      child.stdin.write(JSON.stringify(request) + "\n");
    }));
    queue = pending.then(() => {}, () => {}); return pending;
  };
  const onError = () => {}; child.stdin.on("error", onError);
  try {
    child.stderr.resume();
    const manifest = await current.rpc({ command: "acquire", id: randomUUID(), paths });
    active(signal); if (current.exited) throw denied();
    const value = await sessions.run(current, () => action(manifest));
    if (current.exited) throw denied();
    return value;
  } finally {
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 2000);
    await closed; clearTimeout(timer);
  }
}

/** Delete by the opened object's identity, never a pathname check followed by unlink. */
export async function removeOwnedFile(path: string, identity: { dev: bigint | number; ino: bigint | number }, signal: AbortSignal, empty = false, directory = false): Promise<void> {
  await withPathGuard([{ path: dirname(path), leaf: false }], signal, async () => {
    await sessions.getStore()!.rpc({ command: "removeOwned", id: randomUUID(), path, dev: String(identity.dev), ino: String(identity.ino), empty, directory });
  });
}
export async function replaceOwnedFile(source: string, destination: string, identity: { dev: bigint; ino: bigint }, sha256: string, signal: AbortSignal, expectedDestinationHash?: string): Promise<void> {
  const target=expectedDestinationHash===undefined?undefined:await lstat(destination,{bigint:true});
  const paths:GuardPath[]=[{path:dirname(source),leaf:false},{path:dirname(destination),leaf:false}];
  await withPathGuard(paths, signal, async () => {
    active(signal);
    // Catch edits since the capability read. Native verification repeats this
    // on one opened handle and denies in-place writes until the rename ends.
    // An external atomic save can still replace the destination pathname.
    if(target&&createHash('sha256').update(await readBoundFile(destination,8*1024*1024)).digest('hex')!==expectedDestinationHash)throw new HarnessError('PRECONDITION_FAILED','File changed before guarded replacement');
    active(signal);
    await sessions.getStore()!.rpc({ command: "replaceOwned", id: randomUUID(), source, destination, dev: String(identity.dev), ino: String(identity.ino), sha256, targetDev:target&&String(target.dev), targetIno:target&&String(target.ino), targetSha256:expectedDestinationHash });
  });
}

export async function withResourceGrant<T>(grant: ResourceGrant, dataDir: string, relativePath: string | undefined, write: boolean, signal: AbortSignal, action: (path: string) => Promise<T>): Promise<T> {
  const path = await resolveGrant(grant, relativePath, write, dataDir);
  const paths: GuardPath[] = [{ path: resolve(dataDir), leaf: false }, { path, leaf: !write }];
  for (const child of PROTECTED_STORAGE_DIRECTORIES) {
    const protectedPath = join(dataDir, child);
    try { await lstat(protectedPath); paths.push({ path: protectedPath, leaf: false }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return withPathGuard(paths, signal, async () => {
    active(signal);
    const stable = await resolveGrant(grant, relativePath, write, dataDir);
    if (stable !== path) throw denied();
    assertNotStorage(stable, dataDir);
    return action(stable);
  });
}

/** Read and size validation use the same opened file; callers hold the namespace guard. */
export async function readBoundFile(path: string, maxBytes: number, identity?: Pick<GuardEntry, "dev" | "ino" | "size">): Promise<Buffer> {
  const file = await open(path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1) throw denied();
    if (identity) {
      const exact = await file.stat({ bigint: true });
      if (String(exact.dev) !== identity.dev || String(exact.ino) !== identity.ino || exact.size !== BigInt(identity.size)) throw denied();
    }
    if (info.size > maxBytes) throw new HarnessError("RESOURCE_LIMIT", "Resource exceeds its byte limit");
    // Bound allocation even if another editor grows the already opened file.
    const bytes = Buffer.alloc(Math.min(info.size + 1, maxBytes + 1));
    let length = 0;
    while (length < bytes.length) { const part = await file.read(bytes, length, bytes.length - length, length); if (!part.bytesRead) break; length += part.bytesRead; }
    if (length > maxBytes || length > info.size) throw new HarnessError("RESOURCE_LIMIT", "Resource grew during read");
    if ((await file.stat()).nlink !== 1) throw denied();
    return bytes.subarray(0, length);
  } finally { await file.close(); }
}
