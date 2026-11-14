import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import { HarnessError } from '../contracts/index.ts';
import { projectSearchIdSchema, projectSearchPathSchema, searchRequestSchema, type ProjectOwner, type SearchIssue, type SearchMatch, type SearchRequest, type SearchResponse } from '../contracts/project-search.ts';
import { withPathGuard } from '../core/file-access.ts';
import { assertNotStorage, inside } from '../core/security.ts';
import type { ProjectTools } from './tools.ts';

export const PROJECT_SEARCH_LIMITS = Object.freeze({ files: 10_000, bytes: 32 * 1024 * 1024, matches: 1000, timeoutMs: 2000, fileBytes: 1024 * 1024 });
const RESPONSE_BYTES = 512 * 1024, SNAPSHOT_BYTES = 1024 * 1024, TTL = 5 * 60 * 1000;
const EXCLUSIONS = ['.git', 'node_modules', '.harness-directory-guard', 'links/reparse points', 'multiple-hardlink files', 'protected host storage'];
const excludedNames = new Set(['.git', 'node_modules', '.harness-directory-guard']);
type Identity = { dev: string; ino: string };
type Directory = { path: string; identity: Identity };
type Snapshot = { response: SearchResponse; query: string; limit: number; expires: number };
const identity = (info: BigIntStats): Identity => ({ dev: String(info.dev), ino: String(info.ino) });
const equal = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const preview = (value: string) => [...value].slice(0, 512).join('');
// Locale-independent Unicode default caseless matching, including expansions. Cherokee
// folds to uppercase; dotless i remains distinct; capital sharp s also expands to ss.
const foldPoint = (point: string) => {
  const code = point.codePointAt(0)!;
  if (code === 0x131) return point;
  if (code === 0x1e9e) return 'ss';
  if (code >= 0x13a0 && code <= 0x13ff || code >= 0xab70 && code <= 0xabbf) return point.toUpperCase();
  return point.toUpperCase().toLowerCase();
};
const fold = (value: string) => Array.from(value, foldPoint).join('');
// Keep offsets in the original string: Unicode case folding can expand a code point.
function findColumn(line: string, query: string): number | null {
  let folded = '', column = 1;
  const columns: number[] = [];
  for (const point of line) {
    const lower = foldPoint(point);
    for (let i = 0; i < lower.length; i++) columns.push(column);
    folded += lower; column++;
  }
  const offset = folded.indexOf(query);
  return offset < 0 ? null : columns[offset]!;
}
class Stopped extends Error {}

/** No index, persistence, logging or query-derived executable input. One instance per host. */
export class ProjectSearch {
  private readonly secret = randomBytes(32);
  private readonly snapshots = new Map<string, Snapshot>();
  constructor(readonly projects: ProjectTools, private readonly clock: { now(): number; monotonic(): number } = { now: () => Date.now(), monotonic: () => performance.now() }) {}

  private async admission(projectId: string, threadId?: string) {
    const admitted = await this.projects.binding(projectId, threadId), info = await lstat(admitted.path, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink()) throw new HarnessError('CAPABILITY_DENIED', 'Project access changed.');
    const root = identity(info), owner: ProjectOwner = {
      projectId, threadId: threadId ?? null, workingCopyId: admitted.workspace?.id ?? null,
      binding: createHmac('sha256', this.secret).update(JSON.stringify([
        this.projects.store.dataDir, projectId, threadId ?? null, admitted.workspace?.id ?? null, admitted.path, root,
        admitted.workspace?.identity ?? this.projects.store.get('workspaceProjectRoot', projectId),
      ])).digest('hex'),
    };
    return { owner, root, path: admitted.path };
  }

  private cursor(handle: string, offset: number) {
    const payload = handle + '.' + offset;
    return payload + '.' + createHmac('sha256', this.secret).update(payload).digest('hex');
  }
  private invalidCursor(): never { throw new HarnessError('INVALID_CURSOR', 'Search cursor is unavailable. Start a new search.'); }

  async search(projectId: string, input: SearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
    projectSearchIdSchema.parse(projectId);
    const request = searchRequestSchema.parse(input), query = fold(request.q), limit = request.limit ?? 100;
    if (signal?.aborted) throw new HarnessError('RESOURCE_LIMIT', 'Search was cancelled.');
    for (const [handle, entry] of this.snapshots) if (entry.expires <= this.clock.now()) this.snapshots.delete(handle);
    let handle: string, snapshot: Snapshot, offset = 0;
    if (request.cursor !== undefined) {
      const parts = /^([a-f0-9]{64})\.([0-9]{1,4})\.([a-f0-9]{64})$/.exec(request.cursor);
      if (!parts) return this.invalidCursor();
      handle = parts[1]!; offset = Number(parts[2]);
      if (String(offset) !== parts[2]) return this.invalidCursor();
      if (!timingSafeEqual(Buffer.from(request.cursor), Buffer.from(this.cursor(handle, offset)))) return this.invalidCursor();
      const saved = this.snapshots.get(handle);
      if (!saved || offset < 1 || offset >= saved.response.matches.length || saved.query !== query || saved.limit !== limit || saved.response.owner.projectId !== projectId || saved.response.owner.threadId !== (request.threadId ?? null)) return this.invalidCursor();
      snapshot = saved;
    } else {
      const admitted = await this.admission(projectId, request.threadId);
      const response = await this.scan(admitted, query, signal);
      snapshot = { response, query, limit, expires: this.clock.now() + TTL };
      handle = randomBytes(32).toString('hex');
    }
    let owner: ProjectOwner;
    try { owner = (await this.admission(projectId, request.threadId)).owner; }
    catch (error) { if (request.cursor !== undefined) return this.invalidCursor(); throw error; }
    if (owner.binding !== snapshot.response.owner.binding) {
      if (request.cursor !== undefined) return this.invalidCursor();
      throw new HarnessError('CAPABILITY_DENIED', 'Project access changed during search.');
    }
    if (signal?.aborted) throw new HarnessError('RESOURCE_LIMIT', 'Search was cancelled.');
    const page: SearchResponse = { ...snapshot.response, matches: [], issues: [...snapshot.response.issues] };
    let next = offset;
    for (const match of snapshot.response.matches.slice(offset, offset + limit)) {
      page.matches.push(match);
      page.nextCursor = next + 1 < snapshot.response.matches.length ? this.cursor(handle, next + 1) : null;
      // Reserve metadata for the response-limit issue if the next match will not fit.
      if (bytes(page) + 100 > RESPONSE_BYTES) { page.matches.pop(); break; }
      next++;
    }
    if (next < Math.min(offset + limit, snapshot.response.matches.length)) {
      page.complete = false;
      if (!page.issues.some(issue => issue.reason === 'response_limit')) {
        if (page.issues.length < 100) page.issues.push({ path: null, reason: 'response_limit' });
        else page.issuesTruncated = true;
      }
      snapshot.response.complete = false;
      snapshot.response.issues = [...page.issues]; snapshot.response.issuesTruncated = page.issuesTruncated;
    }
    page.nextCursor = next < snapshot.response.matches.length ? this.cursor(handle, next) : null;
    if (request.cursor === undefined && page.nextCursor !== null) {
      while (this.snapshots.size >= 100) this.snapshots.delete(this.snapshots.keys().next().value!);
      this.snapshots.set(handle, snapshot);
    }
    // Returned objects cannot mutate the retained snapshot, even for in-process consumers.
    return structuredClone(page);
  }

  private async scan(admitted: Awaited<ReturnType<ProjectSearch['admission']>>, query: string, external?: AbortSignal): Promise<SearchResponse> {
    const response: SearchResponse = { owner: admitted.owner, matches: [], nextCursor: null, complete: true, issues: [], issuesTruncated: false, exclusions: [...EXCLUSIONS], limits: { ...PROJECT_SEARCH_LIMITS } };
    const controller = new AbortController(), signal = controller.signal, started = this.clock.monotonic();
    let stopped = false, files = 0, readBytes = 0, retainedBytes = bytes(response);
    const issue = (path: string | null, reason: SearchIssue['reason']) => {
      const safe = path !== null && projectSearchPathSchema.safeParse(path).success ? path : null;
      if (!['excluded', 'binary', 'too_large'].includes(reason)) response.complete = false;
      if (response.issues.length < 100) {
        const entry = { path: safe, reason }, size = bytes(entry) + 1;
        if (retainedBytes + size + 128 > SNAPSHOT_BYTES) {
          response.complete = false; stopped = true; response.issuesTruncated = true;
          response.issues.push({ path: null, reason: 'response_limit' });
        } else { response.issues.push(entry); retainedBytes += size; }
      }
      else response.issuesTruncated = true;
    };
    const stop = (reason: SearchIssue['reason']) => { if (!stopped) { stopped = true; issue(null, reason); } };
    const deadline = () => { stop('timeout'); controller.abort(); };
    const cancel = () => { stop('timeout'); controller.abort(); };
    const loss = () => { stop('changed'); controller.abort(); };
    external?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(deadline, PROJECT_SEARCH_LIMITS.timeoutMs); timer.unref();
    const check = () => {
      if (!stopped && this.clock.monotonic() - started >= PROJECT_SEARCH_LIMITS.timeoutMs) deadline();
      if (external?.aborted) cancel();
      if (stopped || signal.aborted) throw new Stopped();
    };
    // A pending native read cannot always be interrupted. Its continuation checks cancellation
    // before doing any more work; a late guard acquisition never starts a scan.
    const pending = async <T>(work: Promise<T>): Promise<T> => {
      let abort!: () => void;
      const cancelled = new Promise<never>((_, reject) => { abort = () => reject(new Stopped()); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); });
      try { const value = await Promise.race([work, cancelled]); check(); return value; }
      finally { signal.removeEventListener('abort', abort); }
    };
    const guard = async (path: string, info: Identity, leaf: boolean, action: () => Promise<void>) => {
      check();
      await pending(withPathGuard([{ path, leaf, ...info, ...(leaf ? { readOnly: true } : {}) }], signal, async () => { check(); await action(); check(); }, loss));
    };
    const verify = async (directories: Directory[]) => {
      for (const directory of directories) {
        check(); const current = await lstat(directory.path, { bigint: true }); check();
        if (!current.isDirectory() || current.isSymbolicLink() || !equal(identity(current), directory.identity)) throw new HarnessError('CAPABILITY_DENIED', 'Search directory changed.');
      }
    };
    const add = (match: SearchMatch) => {
      check();
      if (response.matches.length >= PROJECT_SEARCH_LIMITS.matches) { stop('match_limit'); throw new Stopped(); }
      const size = bytes(match) + 1;
      // Reserve the final truncation issue and metadata, counted in UTF-8 bytes.
      if (retainedBytes + size + 128 > SNAPSHOT_BYTES) { stop('response_limit'); throw new Stopped(); }
      response.matches.push(match); retainedBytes += size;
    };
    const read = async (path: string, relative: string, before: BigIntStats, directories: Directory[]) => {
      await guard(path, identity(before), true, async () => {
        await verify(directories); check(); assertNotStorage(path, this.projects.store.dataDir);
        const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        let data: Buffer;
        try {
          check(); const info = await file.stat({ bigint: true }); check();
          if (!info.isFile() || info.nlink !== 1n || !equal(identity(before), identity(info)) || info.size !== before.size) throw new HarnessError('CAPABILITY_DENIED', 'Search file changed.');
          data = Buffer.alloc(Number(info.size));
          let offset = 0;
          while (offset < data.length) {
            check(); const part = await file.read(data, offset, Math.min(64 * 1024, data.length - offset), offset);
            readBytes += part.bytesRead; check();
            if (!part.bytesRead) throw new HarnessError('CAPABILITY_DENIED', 'Search file changed.');
            offset += part.bytesRead;
          }
          const after = await file.stat({ bigint: true }), named = await lstat(path, { bigint: true });
          check(); await verify(directories);
          if (!named.isFile() || named.isSymbolicLink() || after.nlink !== 1n || named.nlink !== 1n || !equal(identity(info), identity(named)) || after.size !== info.size || after.mtimeNs !== info.mtimeNs || after.ctimeNs !== info.ctimeNs) throw new HarnessError('CAPABILITY_DENIED', 'Search file changed.');
          assertNotStorage(path, this.projects.store.dataDir);
        } finally { await file.close(); }
        check();
        let text: string;
        try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data); }
        catch { issue(relative, 'binary'); return; }
        if (data.includes(0)) { issue(relative, 'binary'); return; }
        const sha256 = createHash('sha256').update(data).digest('hex');
        if (fold(relative).includes(query)) add({ path: relative, kind: 'path', line: null, column: null, preview: preview(relative), sha256 });
        let line = 1, start = 0;
        // Avoid allocating an array for up to a million tiny lines.
        for (let end = 0; end <= text.length; end++) {
          if (end < text.length && text[end] !== '\n' && text[end] !== '\r') continue;
          check(); const value = text.slice(start, end), column = findColumn(value, query);
          if (column !== null) add({ path: relative, kind: 'text', line, column, preview: preview(value), sha256 });
          if (text[end] === '\r' && text[end + 1] === '\n') end++;
          start = end + 1; line++;
        }
      });
    };
    const walk = async (directory: Directory, relative: string, ancestors: Directory[]) => {
      await guard(directory.path, directory.identity, false, async () => {
        const directories = [...ancestors, directory]; await verify(directories); check();
        const dir = await opendir(directory.path, { encoding: 'buffer' as BufferEncoding });
        try {
          const names = new Set<string>();
          for (;;) {
            check(); const entry = await dir.read(); check(); if (!entry) break;
            let name: string;
            try { name = typeof entry.name === 'string' ? entry.name : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(entry.name); }
            catch { issue(null, 'excluded'); continue; }
            const child = relative ? relative + '/' + name : name, path = join(directory.path, name), key = name.toLowerCase();
            if (excludedNames.has(key) || !projectSearchPathSchema.safeParse(child).success || names.has(key)) { issue(child, 'excluded'); continue; }
            names.add(key);
            try {
              check();
              // Never inspect or descend into private host storage, even for an injected binding.
              if (inside(join(this.projects.store.dataDir, 'checkpoints'), path)) { issue(child, 'excluded'); continue; }
              const info = await lstat(path, { bigint: true }); check();
              if (info.isSymbolicLink() || !info.isDirectory() && (!info.isFile() || info.nlink !== 1n)) { issue(child, 'excluded'); continue; }
              try { assertNotStorage(path, this.projects.store.dataDir); }
              catch { issue(child, 'excluded'); continue; }
              if (info.isDirectory()) { await walk({ path, identity: identity(info) }, child, directories); continue; }
              if (files >= PROJECT_SEARCH_LIMITS.files) { stop('file_limit'); throw new Stopped(); }
              files++;
              if (info.size > BigInt(PROJECT_SEARCH_LIMITS.fileBytes)) { issue(child, 'too_large'); continue; }
              if (readBytes + Number(info.size) > PROJECT_SEARCH_LIMITS.bytes) { stop('byte_limit'); throw new Stopped(); }
              await read(path, child, info, directories);
            } catch (error) {
              if (error instanceof Stopped) throw error;
              const code = (error as { code?: string }).code;
              issue(child, ['CAPABILITY_DENIED', 'ENOENT', 'ENOTDIR', 'ELOOP'].includes(code ?? '') ? 'changed' : 'unreadable');
            }
          }
        } finally { await dir.close(); }
      });
    };
    try { check(); await walk({ path: admitted.path, identity: admitted.root }, '', []); }
    catch (error) {
      if (!stopped && !(error instanceof Stopped)) issue(null, (error as { code?: string }).code === 'CAPABILITY_DENIED' ? 'changed' : 'unreadable');
    } finally { clearTimeout(timer); external?.removeEventListener('abort', cancel); }
    response.matches.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : a.kind === b.kind ? (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0) : a.kind === 'path' ? -1 : 1);
    return response;
  }

  dispose() { this.snapshots.clear(); }
}
