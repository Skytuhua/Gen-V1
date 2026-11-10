import { lstat, mkdir, mkdtemp, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { HarnessError } from "../contracts/index.ts";
import { readBoundFile, removeOwnedFile, withPathGuard, type GuardEntry } from "../core/file-access.ts";
import {withPrivateGitFamily,type PrivateGitAttestation} from '../workspace/git-storage.ts';

type Identity = { dev: string; ino: string };
/** Host-owned attestation, resolved only from the current thread's stored binding. */
export interface ManagedGitFamily {
  path: string;
  gitDirectory: string;
  commonDirectory: string;
  identity: Identity;
  gitDirectoryIdentity: Identity;
  commonDirectoryIdentity: Identity;
}
const deny = () => new HarnessError("CAPABILITY_DENIED", "Git metadata redirects, unverified shared worktrees and executable filters are unsupported");
const key = (path: string) => path.replaceAll("\\", "/").toLowerCase();
function child(root: string, path: string) {
  const name = relative(root, path);
  return name && !isAbsolute(name) && name !== ".." && !name.startsWith(".." + sep) ? name : undefined;
}
type SnapshotEntry = GuardEntry & { relative: string; key: string };
function named(entry: GuardEntry, name: string): SnapshotEntry { return { ...entry, relative: name, key: key(name) }; }
async function validateConfig(entry: GuardEntry) {
  const contents = new TextDecoder("utf-8", { fatal: true }).decode(await readBoundFile(entry.path, 1024 * 1024, entry)).replace(/\\\r?\n/g, "");
  if (/\[\s*(?:include(?:if)?|filter|extensions)(?:\s|["\]])/i.test(contents)) throw deny();
  for (const version of contents.matchAll(/^\s*repositoryformatversion\s*=\s*(.*)$/gim)) {
    if (!/^"?0"?\s*(?:[;#].*)?$/.test(version[1])) throw deny();
  }
}

async function managedEntries(cwd: string, family: ManagedGitFamily, manifest: readonly GuardEntry[]): Promise<SnapshotEntry[]> {
  // Check identities while all ancestors and captured leaves are held by the native guard.
  for (const [path, expected] of [[cwd, family.identity], [family.commonDirectory, family.commonDirectoryIdentity], [family.gitDirectory, family.gitDirectoryIdentity]] as const) {
    const info = await lstat(path, { bigint: true });
    if (!expected || !info.isDirectory() || info.isSymbolicLink() || String(info.dev) !== expected.dev || String(info.ino) !== expected.ino) throw deny();
  }
  const worktree = new Map<string, GuardEntry>(), common = new Map<string, GuardEntry>();
  for (const entry of manifest) {
    const source = child(cwd, entry.path), metadata = child(family.commonDirectory, entry.path);
    const map = source ? worktree : metadata ? common : undefined, name = source ?? metadata;
    if (!map || !name || map.has(key(name))) throw deny();
    map.set(key(name), entry);
  }
  const text = async (entry: GuardEntry | undefined) => {
    if (!entry || entry.directory) throw deny();
    return new TextDecoder("utf-8", { fatal: true }).decode(await readBoundFile(entry.path, 4096, entry)).replace(/\r?\n$/, "");
  };
  const pointer = await text(worktree.get(".git"));
  if (!["gitdir: " + family.gitDirectory, "gitdir: " + family.gitDirectory.replaceAll("\\", "/")].includes(pointer)) throw deny();
  const per = key(relative(family.commonDirectory, family.gitDirectory));
  if (await text(common.get(per + "/commondir")) !== "../..") throw deny();
  const backref = await text(common.get(per + "/gitdir"));
  if (![join(cwd, ".git"), join(cwd, ".git").replaceAll("\\", "/")].includes(backref)) throw deny();
  for (const redirect of ["commondir", "gitdir", "objects/info/alternates", "objects/info/http-alternates"]) if (common.has(redirect)) throw deny();
  if (!common.get(per + "/head") || common.get(per + "/head")!.directory) throw deny();
  // Validate the common config before a worktree-specific copy can shadow it.
  if (common.has("config.worktree")) await validateConfig(common.get("config.worktree")!);

  const directory = await lstat(family.commonDirectory, { bigint: true });
  const result = new Map<string, SnapshotEntry>();
  const add = (entry: GuardEntry, name: string) => { const value = named(entry, name); result.set(value.key, value); };
  add({path:family.commonDirectory,directory:true,dev:String(directory.dev),ino:String(directory.ino),size:0}, ".git");
  for (const [name, entry] of worktree) if (name !== ".git") add(entry, child(cwd, entry.path)!);
  for (const [name, entry] of common) {
    if (["worktrees", "head", "index", "logs/head"].includes(name) || name.startsWith("worktrees/")) continue;
    add(entry, join(".git", child(family.commonDirectory, entry.path)!));
  }
  // Git stores these independently for each linked worktree. Never inherit the
  // base checkout's HEAD, index or HEAD reflog when building a standalone copy.
  for (const [name, entry] of common) {
    if (!name.startsWith(per + "/")) continue;
    const local = name.slice(per.length + 1);
    if (local === "head" || local === "index" || local === "config.worktree" || local === "logs" || local.startsWith("logs/")) add(entry, join(".git", relative(family.gitDirectory, entry.path)));
  }
  return [...result.values()].sort((a,b) => a.relative.split(sep).length - b.relative.split(sep).length || a.relative.localeCompare(b.relative));
}

/** v1 reads ordinary SHA-1 repositories using application config, not repository config. */
export async function withGitMetadata<T>(cwd: string, signal: AbortSignal, action: (metadata: string, worktree: string, signal:AbortSignal) => Promise<T>, family?: ManagedGitFamily): Promise<T> {
  if(family && 'privateFamily' in family) {
    if(family.path!==cwd)throw deny();
    return withPrivateGitFamily(family as PrivateGitAttestation,signal,(metadata,worktree,active)=>action(metadata,worktree,active));
  }
  // The guard freezes only existing names. Git must never enumerate the original
  // namespace: new children (including .git metadata) can still appear there.
  if (family && (
    family.path !== cwd || !isAbsolute(family.commonDirectory) || !isAbsolute(family.gitDirectory) ||
    resolve(family.commonDirectory) !== family.commonDirectory || resolve(family.gitDirectory) !== family.gitDirectory ||
    !/^worktrees\/[A-Za-z0-9_.-]+$/.test(key(relative(family.commonDirectory, family.gitDirectory))) ||
    child(cwd, family.commonDirectory) || child(family.commonDirectory, cwd) || cwd === family.commonDirectory
  )) throw deny();
  const controller=new AbortController();signal=AbortSignal.any([signal,controller.signal]);
  return withPathGuard([{ path: cwd, leaf: false, tree: true, readOnly: true }, ...(family ? [{ path: family.commonDirectory, leaf: false, tree: true, readOnly: true }] : [])], signal, async manifest => {
    if (manifest.length > 10000 || manifest.reduce((bytes, entry) => bytes + entry.size, 0) > 64 * 1024 * 1024) throw new HarnessError("RESOURCE_LIMIT", "Git snapshot exceeds its entry or byte limit");
    const entries = family ? await managedEntries(cwd, family, manifest) : manifest.map(entry => {
      const path = relative(cwd, entry.path);
      if (!path || isAbsolute(path) || path === ".." || path.startsWith(".." + sep)) throw deny();
      return named(entry, path);
    });
    const byName = new Map(entries.map(entry => [entry.key, entry]));
    if (!byName.get(".git")?.directory || byName.size !== entries.length) throw deny();
    for (const path of ["commondir", "gitdir", "objects/info/alternates", "objects/info/http-alternates"]) {
      if (byName.has(".git/" + path)) throw deny();
    }
    for (const name of ["config", "config.worktree"]) {
      const entry = byName.get(".git/" + name);
      if (!entry) { if (name === "config") throw deny(); continue; }
      await validateConfig(entry);
    }

    // Exclusive, application-owned sibling of ordinary temp grants. Fail closed
    // if the selected grant contains this scratch space. No source re-enumeration.
    const snapshot = await mkdtemp(join(tmpdir(), "harness-git-snapshot-"));
    const owned: { path: string; dev: bigint; ino: bigint; directory: boolean }[] = [];
    const remember = async (path: string, directory: boolean) => { const identity = await lstat(path, { bigint: true }); owned.push({ path, dev: identity.dev, ino: identity.ino, directory }); };
    try {
      await remember(snapshot, true);
      if (snapshot === cwd || child(cwd, snapshot) || family && (snapshot === family.commonDirectory || child(family.commonDirectory, snapshot))) throw deny();
      let total = 0;
      for (const entry of entries) {
        if (signal.aborted) throw new HarnessError("CANCELLED", "Git snapshot cancelled");
        // Do not install hooks or nested repository redirects in the snapshot.
        if (entry.key.startsWith(".git/hooks/") || entry.key === ".git/hooks" || entry.key.startsWith(".git/modules/") || entry.key === ".git/modules" || entry.key.split("/").slice(1).includes(".git")) continue;
        if ((total += entry.size) > 64 * 1024 * 1024) throw new HarnessError("RESOURCE_LIMIT", "Git snapshot exceeds 64 MiB");
        const destination = join(snapshot, entry.relative);
        if (entry.directory) { await mkdir(destination); await remember(destination, true); }
        else {
          // Repository config has path-valued settings beyond includes (for
          // example diff.orderFile). Install no untrusted config at all.
          const bytes = entry.key === ".git/config" ? Buffer.from("[core]\nrepositoryformatversion = 0\nbare = false\nfilemode = false\nignorecase = true\nsymlinks = false\n") : entry.key === ".git/config.worktree" ? Buffer.alloc(0) : await readBoundFile(entry.path, entry.size, entry);
          const file = await open(destination, "wx", 0o600);
          try {
            const identity = await file.stat({ bigint: true }); owned.push({ path: destination, dev: identity.dev, ino: identity.ino, directory: false });
            await file.writeFile(bytes);
          } finally { await file.close(); }
        }
      }
      return await withPathGuard([{ path: snapshot, leaf: false, tree: true, readOnly: true }], signal, () => action(join(snapshot, ".git"), snapshot,signal),()=>controller.abort());
    } finally {
      // Remove only identities created here, leaves first. Never recursively
      // delete a pathname that a concurrent writer might have substituted.
      for (const entry of owned.reverse()) {
        await removeOwnedFile(entry.path, entry, new AbortController().signal, false, entry.directory);
      }
    }
  },()=>controller.abort());
}
