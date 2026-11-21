import { realpath, stat } from "node:fs/promises";
import { lstatSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, dirname, basename, sep } from "node:path";
import { HarnessError, type ResourceGrant } from "../contracts/index.ts";
export const PROTECTED_STORAGE_DIRECTORIES = ['pi', 'artifacts', 'official', 'accounts', 'hermes', 'github', 'git', 'integrations', 'context-results', 'environment', 'network-proxy', 'checkpoint-store', 'effect-authority', 'attachments'] as const;
const MEMORY_DELETION_LEDGER_NAME = /^\.gen-memory-deletions-[a-f0-9]{64}\.jsonl$/i;

/** Outside a profile-only restore set. This is an application storage boundary,
 * not an OS sandbox or a monotonic anchor against whole-machine rollback. */
export function projectMemoryDeletionLedgerPath(dataDir: string): string {
  let root: string;
  try { root = realpathSync(dataDir); } catch { throw new HarnessError("CAPABILITY_DENIED", "Harness storage is unavailable"); }
  const key = process.platform === 'win32' ? root.toLowerCase() : root;
  return resolve(dirname(root), '.gen-memory-deletions-' + createHash('sha256').update(key, 'utf8').digest('hex') + '.jsonl');
}

function assertPrivateMemoryLedger(path: string): void {
  try {
    const info = lstatSync(path), uid = process.getuid?.();
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || process.platform !== 'win32' && ((uid !== undefined && info.uid !== uid) || (info.mode & 0o077) !== 0)) {
      throw new HarnessError("CAPABILITY_DENIED", "Protected deletion storage must remain an ordinary private file");
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

export function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel));
}
export async function canonical(path: string, allowNew = false): Promise<string> {
  if (process.platform === "win32") {
    const absolute = resolve(path);
    if (!/^[a-z]:[\\/]/i.test(absolute) || absolute.slice(2).includes(":") || path.includes("\0")) throw new HarnessError("CAPABILITY_DENIED", "Only ordinary local filesystem paths are supported");
  } else if (path.includes("\0") || path.includes(":") || path.includes("\\")) {
    // Alternate-stream and device-namespace spellings are denied uniformly.
    throw new HarnessError("CAPABILITY_DENIED", "Only ordinary local filesystem paths are supported");
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
  assertNotStorage(candidate, dataDir, base);
  return candidate;
}
export function assertNotStorage(path: string, dataDir: string, grantRoot?: string): void {
  let root: string;
  try { root = realpathSync(dataDir); } catch { throw new HarnessError("CAPABILITY_DENIED", "Harness storage is unavailable"); }
  for (const child of PROTECTED_STORAGE_DIRECTORIES) {
    try { if (lstatSync(resolve(root, child)).isSymbolicLink()) throw new HarnessError("CAPABILITY_DENIED", "Protected storage must not be redirected"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const legacyLedger = resolve(root, 'project-memory-deletions.jsonl'), deletionLedger = projectMemoryDeletionLedgerPath(root);
  assertPrivateMemoryLedger(legacyLedger); assertPrivateMemoryLedger(deletionLedger);
  const protectedPaths = ["harness.sqlite", "harness.sqlite-wal", "harness.sqlite-shm", ".host-lease.sqlite", ".host-lease.sqlite-wal", ".host-lease.sqlite-shm", ...PROTECTED_STORAGE_DIRECTORIES].map(p => resolve(root, p));
  protectedPaths.push(legacyLedger, deletionLedger);
  // Reserve peer-profile ledgers too. Canonicalization resolves symlink aliases;
  // the single-link check below rejects ordinary-name hardlink aliases.
  const reserved = protectedPaths.some(p => inside(p, path)) || resolve(path).split(/[\\/]+/).some(part => MEMORY_DELETION_LEDGER_NAME.test(part));
  if (reserved) {
    // Stored attachments belong to the conversation that uploaded them: only a
    // grant rooted inside that conversation's attachment folder may read them
    // back, so a grant rooted at the profile (or an ancestor) cannot reach
    // another conversation's uploads.
    const attachments = resolve(root, "attachments"), folder = inside(attachments, path) ? relative(attachments, path).split(sep)[0] ?? "" : "";
    const owner = folder && folder !== ".." ? resolve(attachments, folder) : null;
    if (!owner || !grantRoot || !inside(owner, grantRoot) || !inside(owner, path)) throw new HarnessError("CAPABILITY_DENIED", "Task tools cannot access harness storage or credentials");
  }
  try { if (statSync(path).isFile() && statSync(path).nlink !== 1) throw new HarnessError("CAPABILITY_DENIED", "Files with multiple hardlinks cannot be granted"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
