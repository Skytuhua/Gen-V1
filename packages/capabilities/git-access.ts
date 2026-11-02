import { lstat, mkdir, mkdtemp, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { HarnessError } from "../contracts/index.ts";
import { readBoundFile, removeOwnedFile, withPathGuard } from "../core/file-access.ts";

/** v1 reads ordinary SHA-1 repositories using application config, not repository config. */
export async function withGitMetadata<T>(cwd: string, signal: AbortSignal, action: (metadata: string, worktree: string) => Promise<T>): Promise<T> {
  // The guard freezes only existing names. Git must never enumerate the original
  // namespace: new children (including .git metadata) can still appear there.
  return withPathGuard([{ path: cwd, leaf: false, tree: true, readOnly: true }], signal, async manifest => {
    const deny = () => new HarnessError("CAPABILITY_DENIED", "Git metadata redirects, shared worktrees and executable filters are unsupported");
    const entries = manifest.map(entry => {
      const path = relative(cwd, entry.path);
      if (!path || isAbsolute(path) || path === ".." || path.startsWith(".." + sep)) throw deny();
      return { ...entry, relative: path, key: path.replaceAll("\\", "/").toLowerCase() };
    });
    const byName = new Map(entries.map(entry => [entry.key, entry]));
    if (!byName.get(".git")?.directory || byName.size !== entries.length) throw deny();
    for (const path of ["commondir", "gitdir", "objects/info/alternates", "objects/info/http-alternates"]) {
      if (byName.has(".git/" + path)) throw deny();
    }
    for (const name of ["config", "config.worktree"]) {
      const entry = byName.get(".git/" + name);
      if (!entry) { if (name === "config") throw deny(); continue; }
      const contents = new TextDecoder("utf-8", { fatal: true }).decode(await readBoundFile(entry.path, 1024 * 1024, entry)).replace(/\\\r?\n/g, "");
      if (/\[\s*(?:include(?:if)?|filter|extensions)(?:\s|["\]])/i.test(contents)) throw deny();
      for (const version of contents.matchAll(/^\s*repositoryformatversion\s*=\s*(.*)$/gim)) {
        if (!/^"?0"?\s*(?:[;#].*)?$/.test(version[1])) throw deny();
      }
    }

    // Exclusive, application-owned sibling of ordinary temp grants. Fail closed
    // if the selected grant contains this scratch space. No source re-enumeration.
    const snapshot = await mkdtemp(join(tmpdir(), "harness-git-snapshot-"));
    const owned: { path: string; dev: bigint; ino: bigint; directory: boolean }[] = [];
    const remember = async (path: string, directory: boolean) => { const identity = await lstat(path, { bigint: true }); owned.push({ path, dev: identity.dev, ino: identity.ino, directory }); };
    try {
      await remember(snapshot, true);
      const location = relative(cwd, snapshot);
      if (!isAbsolute(location) && location !== ".." && !location.startsWith(".." + sep)) throw deny();
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
      return await withPathGuard([{ path: snapshot, leaf: false, tree: true, readOnly: true }], signal, () => action(join(snapshot, ".git"), snapshot));
    } finally {
      // Remove only identities created here, leaves first. Never recursively
      // delete a pathname that a concurrent writer might have substituted.
      for (const entry of owned.reverse()) {
        await removeOwnedFile(entry.path, entry, new AbortController().signal, false, entry.directory);
      }
    }
  });
}
