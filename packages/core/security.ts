import { realpath, stat } from "node:fs/promises";
import { lstatSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, dirname, basename, sep } from "node:path";
import { HarnessError, type ResourceGrant } from "../contracts/index.ts";
export const PROTECTED_STORAGE_DIRECTORIES = ['pi', 'artifacts', 'official'] as const;

export function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel));
}
export async function canonical(path: string, allowNew = false): Promise<string> {
  if (process.platform === "win32") {
    const absolute = resolve(path);
    if (!/^[a-z]:[\\/]/i.test(absolute) || absolute.slice(2).includes(":") || path.includes("\0")) throw new HarnessError("CAPABILITY_DENIED", "Only ordinary local filesystem paths are supported");
  }
  try { return await realpath(resolve(path)); }
  catch (error) {
    if (!allowNew || (error as NodeJS.ErrnoException).code !== "ENOENT") throw new HarnessError("INVALID_RESOURCE", "The selected path is unavailable");
    return resolve(await realpath(dirname(resolve(path))), basename(path));
  }
}
export async function resolveGrant(grant: ResourceGrant, relativePath: string | undefined, write: boolean, dataDir: string): Promise<string> {
  if (write && !grant.writable) throw new HarnessError("CAPABILITY_DENIED", "This resource was granted read-only");
  const base = await canonical(grant.path);
  if (relative(resolve(grant.path), base) !== "") throw new HarnessError("CAPABILITY_DENIED", "The granted root was retargeted; select it again explicitly");
  const info = await stat(base, { bigint: true });
  if (grant.identity && (String(info.dev) !== grant.identity.dev || String(info.ino) !== grant.identity.ino)) throw new HarnessError("CAPABILITY_DENIED", "The granted resource was replaced; select it again explicitly");
  if (relativePath && (!info.isDirectory() || isAbsolute(relativePath))) throw new HarnessError("CAPABILITY_DENIED", "A relative path requires a directory grant");
  const candidate = await canonical(relativePath ? resolve(base, relativePath) : base, write);
  if (!inside(base, candidate)) throw new HarnessError("CAPABILITY_DENIED", "The resolved path leaves its resource grant");
  assertNotStorage(candidate, dataDir);
  return candidate;
}
export function assertNotStorage(path: string, dataDir: string): void {
  let root: string;
  try { root = realpathSync(dataDir); } catch { throw new HarnessError("CAPABILITY_DENIED", "Harness storage is unavailable"); }
  for (const child of PROTECTED_STORAGE_DIRECTORIES) {
    try { if (lstatSync(resolve(root, child)).isSymbolicLink()) throw new HarnessError("CAPABILITY_DENIED", "Protected storage must not be redirected"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const protectedPaths = ["harness.sqlite", "harness.sqlite-wal", "harness.sqlite-shm", ...PROTECTED_STORAGE_DIRECTORIES].map(p => resolve(root, p));
  if (protectedPaths.some(p => inside(p, path))) throw new HarnessError("CAPABILITY_DENIED", "Task tools cannot access harness storage or credentials");
  try { if (statSync(path).isFile() && statSync(path).nlink !== 1) throw new HarnessError("CAPABILITY_DENIED", "Files with multiple hardlinks cannot be granted"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
