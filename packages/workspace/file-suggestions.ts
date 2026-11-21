import type { Dirent } from 'node:fs';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { assertNotStorage, inside } from '../core/security.ts';
import { withPathGuard } from '../core/file-access.ts';
import type { ProjectTools } from './tools.ts';

// Composer @-mention file picks: a bounded breadth-first file-name index per
// bound project root. The walk mirrors the project-search exclusion policy and
// collects paths only — never file contents. The renderer's query stays an
// untrusted filter applied to host-collected paths.
const EXCLUDED_DIRECTORIES = new Set([
  'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', 'out',
  '.next', 'coverage', 'target', '.turbo', '.cache',
]);
const MAX_ENTRIES = 20_000;
const WALK_BUDGET_MS = 1_500;
const CACHE_TTL_MS = 15_000;
const CACHE_KEYS = 4;

interface SuggestionIndex { paths: string[]; complete: boolean; limitReason?: 'entries' | 'time' }
export interface FileSuggestionItem { path: string; name: string; directory: string }
export interface FileSuggestionsResult { items: FileSuggestionItem[]; complete: boolean; limitReason?: 'entries' | 'time' }

function subsequence(haystack: string, needle: string): boolean {
  let at = 0;
  for (let i = 0; i < haystack.length && at < needle.length; i++) if (haystack[i] === needle[at]) at++;
  return at === needle.length;
}

const codePoint = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const segments = (path: string) => path.split('/').length;
const item = (path: string): FileSuggestionItem => {
  const at = path.lastIndexOf('/');
  return { path, name: at < 0 ? path : path.slice(at + 1), directory: at < 0 ? '' : path.slice(0, at) };
};

/** Pure ranking: basename tiers first, then path match, then fuzzy subsequence.
 * A query containing '/' skips the basename tiers and matches the full path. */
export function rankFileSuggestions(paths: readonly string[], query: string, limit: number): FileSuggestionItem[] {
  const q = query.toLowerCase();
  if (!q) return paths.slice().sort((a, b) => segments(a) - segments(b) || codePoint(a, b)).slice(0, limit).map(item);
  const scoped = q.includes('/');
  const scored: { tier: number; length: number; path: string }[] = [];
  for (const path of paths) {
    const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase(), lower = path.toLowerCase();
    const tier = scoped ? (lower.includes(q) ? 3 : subsequence(lower, q) ? 4 : -1)
      : base === q ? 0 : base.startsWith(q) ? 1 : base.includes(q) ? 2 : lower.includes(q) ? 3 : subsequence(lower, q) ? 4 : -1;
    if (tier >= 0) scored.push({ tier, length: path.length, path });
  }
  scored.sort((a, b) => a.tier - b.tier || a.length - b.length || codePoint(a.path, b.path));
  return scored.slice(0, limit).map(entry => item(entry.path));
}

export class FileSuggestions {
  private readonly cache = new Map<string, { at: number; index: SuggestionIndex | Promise<SuggestionIndex> }>();
  constructor(readonly tools: ProjectTools, private readonly clock: () => number = Date.now) {}

  async suggest(projectId: string, threadId: string, query: string, limit: number, signal: AbortSignal): Promise<FileSuggestionsResult> {
    const binding = await this.tools.binding(projectId, threadId); // all binding errors propagate unchanged
    const root = await stat(binding.path, { bigint: true });
    const key = `${projectId}|${threadId}|${binding.path}|${root.dev}:${root.ino}`;
    let entry = this.cache.get(key);
    if (entry && this.clock() - entry.at > CACHE_TTL_MS) { this.cache.delete(key); entry = undefined; }
    if (!entry) {
      const pending = this.walk(binding.path, signal);
      entry = { at: this.clock(), index: pending };
      this.remember(key, entry);
      try { entry = { at: this.clock(), index: await pending }; this.remember(key, entry); }
      catch (error) { if (this.cache.get(key)?.index === pending) this.cache.delete(key); throw error; }
    }
    else this.remember(key, entry);
    const index = await entry.index;
    return { items: rankFileSuggestions(index.paths, query, limit), complete: index.complete, ...(index.limitReason ? { limitReason: index.limitReason } : {}) };
  }

  private remember(key: string, entry: { at: number; index: SuggestionIndex | Promise<SuggestionIndex> }): void {
    this.cache.delete(key); this.cache.set(key, entry);
    while (this.cache.size > CACHE_KEYS) this.cache.delete(this.cache.keys().next().value!);
  }

  private async walk(root: string, signal: AbortSignal): Promise<SuggestionIndex> {
    return withPathGuard([{ path: root, leaf: false }], signal, async () => {
      const paths: string[] = [], queue: { abs: string; rel: string }[] = [{ abs: root, rel: '' }];
      const started = this.clock(); let visited = 0;
      let complete = true, limitReason: 'entries' | 'time' | undefined;
      const budget = () => {
        signal.throwIfAborted();
        if (visited >= MAX_ENTRIES) { complete = false; limitReason = 'entries'; return false; }
        if (this.clock() - started > WALK_BUDGET_MS) { complete = false; limitReason = 'time'; return false; }
        return true;
      };
      outer:
      while (queue.length) {
        if (!budget()) break;
        const current = queue.shift()!;
        // Re-verify a queued directory before opening it: an entry swapped for a
        // symlink or an outside path between listing and descent must not escape
        // the bound root.
        try {
          if (current.rel && (await realpath(current.abs) !== current.abs || !(await lstat(current.abs)).isDirectory())) continue;
        } catch { continue; }
        let entries: Dirent<Buffer>[];
        try { entries = await readdir(current.abs, { encoding: 'buffer', withFileTypes: true }); }
        catch { continue; } // a directory that vanished or cannot be listed simply yields no suggestions
        entries.sort((a, b) => codePoint(String(a.name), String(b.name)));
        const seen = new Set<string>();
        for (const entry of entries) {
          if (++visited > MAX_ENTRIES) { complete = false; limitReason = 'entries'; break outer; }
          if (visited % 64 === 0 && !budget()) break outer;
          let name: string;
          try { name = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(entry.name); }
          catch { continue; } // undecodable names are never offered
          const lower = name.toLowerCase();
          if (lower === '.git' || name === '.harness-directory-guard' || seen.has(lower)) continue;
          seen.add(lower);
          if (entry.isSymbolicLink()) continue;
          const rel = current.rel ? current.rel + '/' + name : name, path = join(current.abs, name);
          try {
            if (inside(join(this.tools.store.dataDir, 'checkpoints'), path)) continue;
            assertNotStorage(path, this.tools.store.dataDir);
            if (entry.isDirectory()) { if (!EXCLUDED_DIRECTORIES.has(lower)) queue.push({ abs: path, rel }); continue; }
            if (!entry.isFile()) continue;
            const info = await lstat(path, { bigint: true });
            if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1n) continue;
            paths.push(rel);
          } catch (error) {
            const code = (error as { code?: string }).code;
            if (code === 'CANCELLED') throw error;
            continue; // changed, replaced or unreadable entries are skipped like the search walk
          }
        }
      }
      paths.sort(codePoint);
      return { paths, complete, ...(limitReason ? { limitReason } : {}) };
    });
  }
}
