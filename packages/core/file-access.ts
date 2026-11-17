import { spawn } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { open, lstat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { HarnessError, type ResourceGrant } from "../contracts/index.ts";
import { assertNotStorage, resolveGrant, PROTECTED_STORAGE_DIRECTORIES, projectMemoryDeletionLedgerPath } from "./security.ts";

type GuardPath = { path: string; leaf: boolean; dev?: string; ino?: string; empty?: boolean; tree?: boolean; readOnly?: boolean; allowChildWrites?:boolean; childWriteRoot?:string; gitMetadataImport?:boolean };
export interface GuardEntry { readonly path: string; readonly directory: boolean; readonly dev: string; readonly ino: string; readonly size: number }
interface GuardSession { rpc(request: Record<string, unknown>): Promise<readonly GuardEntry[]>; exited: boolean; loss:Set<()=>void> }
const sessions = new AsyncLocalStorage<GuardSession>();
const denied = () => new HarnessError("CAPABILITY_DENIED", "File access check failed — the folder could not be opened safely for this action");
// A cold, app-owned Hermes guard may need PowerShell startup and C# initialization.
// Extend only its first acquire, not unrelated reads, writes, or lease releases.
export function pathGuardRpcDeadline(command: unknown, metadataImport: boolean, startupAcquisition: boolean): number {
  return metadataImport ? 120_000 : command === 'acquire' && startupAcquisition ? 45_000 : 15_000;
}

// One guard process is shared for the life of this host process: each Add-Type
// compile is paid once instead of once per guarded operation, and the C# helper
// already multiplexes acquire/release by request id. The first acquire after a
// spawn is provably still initializing, so it counts as a startup acquisition;
// silence on a warm guard keeps the strict ordinary deadline because it can
// only mean the helper is hung.
interface PooledGuard { session: GuardSession; cold: boolean }
let pooled: PooledGuard | undefined;

function sharedGuard(): PooledGuard {
  if (pooled && !pooled.session.exited) return pooled;
  // Use the system binary and a fixed script: no shell, profiles, PATH lookup or command interpolation.
  const executable = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const child = spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", fileURLToPath(new URL("./windows-path-guard.ps1", import.meta.url))], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  child.stdout.setEncoding("utf8");
  // The pooled child must not keep this process alive; it exits when stdin reaches EOF.
  child.unref?.();
  for (const stream of child.stdio ?? []) (stream as unknown as { unref?: () => void }).unref?.();
  const current: GuardSession = { exited: false, rpc: async () => [], loss: new Set() };
  const entry: PooledGuard = { session: current, cold: true };
  pooled = entry;
  const lost = () => { current.exited = true; if (pooled === entry) pooled = undefined; for (const notify of current.loss) try { notify(); } catch { /* A loss observer cannot stop guard teardown. */ } };
  child.once("exit", lost);
  child.once("error", lost);
  let diagnostics = "";
  child.stderr.on("data", bytes => { if (diagnostics.length < 1024) diagnostics += String(bytes); });
  child.once("close", () => { current.exited = true; if (pooled === entry) pooled = undefined; });
  const exit = () => { try { child.kill(); } catch { /* Teardown is best-effort. */ } };
  process.once("exit", exit);
  child.once("close", () => process.removeListener("exit", exit));
  let queue = Promise.resolve();
  current.rpc = request => {
    const pending = queue.then(() => new Promise<readonly GuardEntry[]>((accept, reject) => {
      if (current.exited) return reject(denied());
      let output = "";
      const metadataImport = Array.isArray(request.paths) && (request.paths as GuardPath[]).some(path => path.gitMetadataImport);
      // The deadline is read at dispatch: a request queued while cold keeps the
      // startup budget only if the helper still has not answered when it runs.
      const timer = setTimeout(() => fault(), pathGuardRpcDeadline(request.command, metadataImport, entry.cold));
      const failed = () => finish(new HarnessError(/limit exceeded/i.test(diagnostics) ? "RESOURCE_LIMIT" : "CAPABILITY_DENIED", "File access check failed — the folder could not be opened safely for this action", { nativeCode: /GUARD_NATIVE_ERROR:([-0-9]+)/.exec(diagnostics)?.[1] ?? "unavailable", nativeMessage: /GUARD_NATIVE_MESSAGE:([^\r\n]*)/.exec(diagnostics)?.[1] }));
      const data = (bytes: string) => {
        output += bytes;
        if (output.length > (metadataImport ? 64 : 16) * 1024 * 1024) return fault();
        if (!output.endsWith("\n")) return;
        if (output.trim() === request.id) { entry.cold = false; return finish(); }
        try {
          const response = JSON.parse(output);
          if (response.id !== request.id) return fault();
          // A request-level failure replies as data and leaves the helper alive;
          // only protocol violations (unmatched id, malformed output, silence) are fatal.
          if (typeof response.error === "string") { entry.cold = false; return finish(new HarnessError(/limit exceeded/i.test(response.error) ? "RESOURCE_LIMIT" : "CAPABILITY_DENIED", "File access check failed — the folder could not be opened safely for this action", { nativeCode: String(response.code ?? "unavailable"), nativeMessage: response.error })); }
          if (!Array.isArray(response.entries) || response.entries.length > (metadataImport ? 100000 : 10000)) return fault();
          for (const e of response.entries) {
            if (typeof e.path !== "string" || typeof e.directory !== "boolean" || !/^\d+$/.test(e.dev) || !/^\d+$/.test(e.ino) || !Number.isSafeInteger(e.size) || e.size < 0) return fault();
            Object.freeze(e);
          }
          entry.cold = false;
          finish(undefined, Object.freeze(response.entries));
        } catch { fault(); }
      };
      // A transport-level denial retires the child: a hung or protocol-breaking
      // helper cannot hold orphaned locks or poison later requests with stale replies.
      const fault = (error: Error = denied()) => { try { child.kill(); } catch { /* Teardown is best-effort. */ } finish(error); };
      const finish = (error?: Error, manifest: readonly GuardEntry[] = []) => { clearTimeout(timer); child.stdout.removeListener("data", data); child.removeListener("error", failed); child.removeListener("exit", failed); error ? reject(error) : accept(manifest); };
      child.once("error", failed); child.once("exit", failed); child.stdout.on("data", data);
      child.stdin.write(JSON.stringify(request) + "\n");
    }));
    queue = pending.then(() => {}, () => {}); return pending;
  };
  const onError = () => {}; child.stdin.on("error", onError);
  child.stderr.resume();
  return entry;
}
function active(signal: AbortSignal) { if (signal.aborted) throw new HarnessError("CANCELLED", "Filesystem operation cancelled"); }

/** Application-scoped namespace guard; never an OS sandbox for project code. */
export async function withPathGuard<T>(paths: GuardPath[], signal: AbortSignal, action: (manifest: readonly GuardEntry[]) => Promise<T>,onLoss?:()=>void): Promise<T> {
  if(paths.some(path=>path.allowChildWrites&&path.leaf&&!path.childWriteRoot))throw new HarnessError('CAPABILITY_DENIED','A pinned file requires an explicit ancestor write scope.');
  active(signal);
  const session = sessions.getStore();
  if (session) {
    const id = randomUUID();
    const manifest = await session.rpc({ command: "acquire", id, paths });
    if(onLoss)session.loss.add(onLoss);
    try { active(signal); const value = await action(manifest); if (session.exited) throw denied(); return value; }
    finally { if(onLoss)session.loss.delete(onLoss);if (!session.exited) await session.rpc({ command: "release", id }); }
  }
  if(process.platform==='linux') {
    const {withLinuxDirectoryGuard}=await import('./linux-path-guard.ts');
    return withLinuxDirectoryGuard(paths,signal,(current,manifest)=>sessions.run(current,()=>action(manifest)),onLoss);
  }
  if (process.platform !== "win32") throw denied();
  const shared = sharedGuard().session;
  const id = randomUUID();
  const manifest = await shared.rpc({ command: "acquire", id, paths });
  if (onLoss) shared.loss.add(onLoss);
  try {
    active(signal);
    if (shared.exited) throw denied();
    const value = await sessions.run(shared, () => action(manifest));
    if (shared.exited) throw denied();
    return value;
  } finally {
    if (onLoss) shared.loss.delete(onLoss);
    if (!shared.exited) await shared.rpc({ command: "release", id });
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
  const paths: GuardPath[] = [{ path: resolve(dataDir), leaf: false }, { path: dirname(projectMemoryDeletionLedgerPath(dataDir)), leaf: false }, { path, leaf: !write }];
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

/** Metadata import only: caller holds the captured source's read-only lease. */
export async function copyBoundGitMetadata(entry: GuardEntry, destination: string, signal: AbortSignal, created: (identity: {dev: bigint; ino: bigint}) => void): Promise<void> {
  active(signal);
  const source = await open(entry.path, 'r');
  try {
    const info = await source.stat({bigint:true});
    if (!info.isFile() || info.nlink !== 1n || String(info.dev) !== entry.dev || String(info.ino) !== entry.ino || info.size !== BigInt(entry.size)) throw denied();
    const target = await open(destination, 'wx', 0o600);
    try {
      const targetInfo = await target.stat({bigint:true});created(targetInfo);
      const buffer = Buffer.alloc(1024 * 1024);let offset = 0;
      while(offset < entry.size) {
        active(signal);const {bytesRead} = await source.read(buffer, 0, Math.min(buffer.length, entry.size-offset), offset);
        if(!bytesRead)throw denied();let written=0;
        while(written<bytesRead){const part=await target.write(buffer,written,bytesRead-written,offset+written);if(!part.bytesWritten)throw denied();written+=part.bytesWritten;}
        offset+=bytesRead;
      }
      const after=await source.stat({bigint:true});
      if(after.size!==info.size||after.nlink!==1n)throw denied();
    } finally {await target.close();}
  } finally {await source.close();}
}
