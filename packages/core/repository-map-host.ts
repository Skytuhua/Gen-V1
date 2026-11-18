import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { HarnessError, type ResourceGrant, type RunContext, type Thread } from '../contracts/index.ts';
import { Store, digest } from '../storage/store.ts';
import { readBoundFile, withResourceGrant } from './file-access.ts';
import { resolveGrant } from './security.ts';
import { repositoryMapArgs } from './repository-map-tool.ts';
import type { RepoMappedFile } from '../workspace/repo-map.ts';

const LIMITS = { fileBytes: 64 * 1024, readBytes: 256 * 1024, resultBytes: 15 * 1024, cacheEntries: 64, calls: 4 } as const;
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
type CapturedFile = RepoMappedFile & { sha256: string | null; sourceRevision: string | null; sourceBytes: number; reason?: string };
interface MapAccess { store: Store; ctx: RunContext; signal: AbortSignal; owner: () => Thread }

/** Host-owned read tool. Cache contains bounded parsed metadata only. Every
 * invocation rechecks grants and reads current bytes under native custody. */
export function createRepositoryMapReader() {
  const cache = new Map<string, RepoMappedFile>();
  let active = 0;
  return {
    clear() { cache.clear(); },
    async read<T>(access: MapAccess, rawArgs: unknown, publish: (value: unknown, provenance: string) => T | Promise<T>): Promise<T> {
      const parsed = repositoryMapArgs.safeParse(rawArgs);
      if (!parsed.success) throw new HarnessError('INVALID_TOOL_ARGUMENTS', 'Choose at most eight explicit relative paths inside a current resource grant.');
      if (active >= LIMITS.calls) throw new HarnessError('CONTEXT_READ_LIMIT', 'Wait for a repository map read to finish.');
      active++;
      try {
        const { store, ctx, signal } = access, args = parsed.data;
        const grant = store.get<ResourceGrant>('resource', args.resourceId);
        if (!grant || grant.threadId !== ctx.threadId || !['project', 'file', 'attachment'].includes(grant.kind)) throw new HarnessError('CAPABILITY_DENIED', 'A current project or exact file grant is required.');
        if (grant.kind === 'project' ? !args.paths?.length : args.paths !== undefined) throw new HarnessError('INVALID_TOOL_ARGUMENTS', 'Name project paths explicitly, or omit paths for an exact file grant.');
        const current = () => {
          if (signal.aborted) throw new HarnessError('CANCELLED_RUN', 'Repository map read was cancelled.');
          const owner = access.owner();
          if (owner.id !== ctx.threadId || owner.runId !== ctx.runId || owner.epoch !== ctx.epoch || !['working', 'awaiting_input'].includes(owner.status) || owner.sideParentId || owner.kind === 'delegate' || store.get('archivedThread', ctx.threadId))
            throw new HarnessError('CANCELLED_RUN', 'Repository map owner changed.');
          return digest([store.dataDir, owner.id, owner.runId, owner.epoch, owner.modelId, owner.accountId ?? null, owner.thinkingLevel ?? null, owner.mode ?? null,
            owner.sessionPath, owner.projectId ?? null, owner.workspaceId ?? null, store.get('resource', grant.id),
            owner.projectId ? store.get('workspaceProjectRoot', owner.projectId) : null, owner.workspaceId ? store.get('workspaceBinding', owner.workspaceId) : null]);
        };
        const binding = current(), assertCurrent = () => { if (current() !== binding) throw new HarnessError('STALE_REQUEST_CONTEXT', 'Repository map source authority changed.'); };
        // Load the pinned compiler only for this explicitly requested tool.
        const mapper = await import('../workspace/repo-map.ts'); assertCurrent();
        const paths = [...new Set(grant.kind === 'project' ? args.paths! : [basename(grant.path)])].sort();
        const files: CapturedFile[] = [], exclusions: { path: string; reason: string }[] = [];
        let readBytes = 0, reusedFiles = 0, parsedFiles = 0;
        async function visit(index: number): Promise<T> {
          assertCurrent();
          const path = paths[index];
          if (path === undefined) {
            const symbols = new Set(args.symbols ?? []), ranked = mapper.rankRepoMap({ files }, { paths: args.focusPaths, symbols: args.symbols }).files;
            const bounded = ranked.map(file => ({ ...file, imports: [] as string[], exports: [] as { name: string; line: number }[], matchedSymbols: undefined,
              omittedImports: file.imports.length, omittedExports: file.exports.length }));
            const value = { resourceId: grant!.id, parser: mapper.REPO_MAP_PARSER, measurement: 'BYTE_ONLY' as const, files: bounded, exclusions, readBytes,
              mapDigest: '0'.repeat(64), localParseCache: { reusedFiles, parsedFiles } };
            let remaining = LIMITS.resultBytes - Buffer.byteLength(JSON.stringify(value)) - 256;
            for (let index = 0; index < ranked.length; index++) {
              const source = ranked[index]!, target = bounded[index]!;
              const exports = source.exports.toSorted((a, b) => Number(symbols.has(b.name)) - Number(symbols.has(a.name)) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || a.line - b.line);
              for (const item of exports) { const bytes = Buffer.byteLength(JSON.stringify(item)) + 1; if (bytes <= remaining) { target.exports.push(item); target.omittedExports--; remaining -= bytes; } }
              for (const item of source.imports) { const bytes = Buffer.byteLength(JSON.stringify(item)) + 1; if (bytes <= remaining) { target.imports.push(item); target.omittedImports--; remaining -= bytes; } }
            }
            value.mapDigest = hash(JSON.stringify([grant!.id, value.parser, bounded, exclusions]));
            if (Buffer.byteLength(JSON.stringify(value)) > LIMITS.resultBytes) throw new HarnessError('RESOURCE_LIMIT', 'Repository map metadata exceeds its bounded result limit.');
            assertCurrent();
            const result = await publish(value, `resource:${grant!.id}; repository map; sha256:${value.mapDigest}; captured source revisions, not an execution grant`);
            assertCurrent(); return result;
          }
          if (!mapper.repoMapPathAllowed(path) || grant!.path.split(/[\\/]/).some(mapper.repoMapPrivateSegment)) { exclusions.push({ path, reason: 'PRIVATE_OR_UNSUPPORTED_PATH' }); return visit(index + 1); }
          let captured = false, acquired = false, resolvedGrant = false;
          try {
            await resolveGrant(grant!, grant!.kind === 'project' ? path : undefined, false, store.dataDir); assertCurrent(); resolvedGrant = true;
            return await withResourceGrant(grant!, store.dataDir, grant!.kind === 'project' ? path : undefined, false, signal, async resolved => {
              acquired = true; assertCurrent();
              // An ordinary logical alias may resolve to an excluded private file
              // inside the grant. Check the physical target while custody is held.
              if (resolved.split(/[\\/]/).some(mapper.repoMapPrivateSegment)) throw new HarnessError('CAPABILITY_DENIED', 'Private repository sources are excluded.');
              const info = await stat(resolved, { bigint: true }); assertCurrent();
              if (!info.isFile() || info.nlink !== 1n) throw new HarnessError('CAPABILITY_DENIED', 'Repository maps require ordinary single-link files.');
              const sourceBytes = Number(info.size), identity = [String(info.dev), String(info.ino), sourceBytes];
              let entry: CapturedFile = { path, mode: 'FILE_LIST_ONLY', imports: [], exports: [], sourceBytes, sha256: null, sourceRevision: null };
              if (sourceBytes > LIMITS.fileBytes || sourceBytes > LIMITS.readBytes - readBytes) entry.reason = sourceBytes > LIMITS.fileBytes ? 'SOURCE_TOO_LARGE' : 'READ_BYTE_BUDGET';
              else {
                const bytes = await readBoundFile(resolved, Math.min(LIMITS.fileBytes, LIMITS.readBytes - readBytes), { dev: identity[0] as string, ino: identity[1] as string, size: sourceBytes });
                assertCurrent(); readBytes += bytes.length;
                const sha256 = hash(bytes), sourceRevision = hash(JSON.stringify([...identity, sha256]));
                entry = { ...entry, sha256, sourceRevision };
                if (!mapper.repoMapLanguageSupported(path)) entry.reason = 'LANGUAGE_UNSUPPORTED';
                else {
                  let text: string | undefined;
                  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); if (text.includes('\0')) text = undefined; } catch { /* Binary content stays file-list only. */ }
                  if (text === undefined) entry.reason = 'SOURCE_NOT_TEXT';
                  else {
                    const key = hash(JSON.stringify([binding, path, sourceRevision])), cached = cache.get(key);
                    const mapped = cached ? structuredClone(cached) : mapper.buildRepoMap([path], () => text!).files[0]!;
                    if (cached) reusedFiles++; else {
                      parsedFiles++;
                      if (Buffer.byteLength(JSON.stringify(mapped)) <= LIMITS.resultBytes) { cache.set(key, structuredClone(mapped)); while (cache.size > LIMITS.cacheEntries) cache.delete(cache.keys().next().value!); }
                    }
                    entry = { ...entry, ...mapped, ...(mapped.mode === 'FILE_LIST_ONLY' ? { reason: 'PARSE_UNAVAILABLE' } : {}) };
                  }
                }
              }
              files.push(entry); captured = true; return visit(index + 1);
            }, { readOnly: true });
          } catch (error) {
            if (captured) throw error;
            assertCurrent();
            if (error instanceof HarnessError && ['CANCELLED_RUN', 'STALE_REQUEST_CONTEXT'].includes(error.code)) throw error;
            exclusions.push({ path, reason: error instanceof HarnessError && error.code === 'CAPABILITY_DENIED' ? resolvedGrant && !acquired && process.platform !== 'win32' ? 'UNAVAILABLE_CUSTODY' : 'DENIED_SOURCE' : 'UNAVAILABLE_SOURCE' });
            return visit(index + 1);
          }
        }
        return await visit(0);
      } finally { active--; }
    },
  };
}
