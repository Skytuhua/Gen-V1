import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { HarnessError, type ResourceGrant, type StartRun, type Thread } from '../contracts/index.ts';
import type { ApprovedProjectContextV1, ProjectInstructionsManifestV1 } from '../contracts/request-context.ts';
import { Store, digest } from '../storage/store.ts';
import { readBoundFile, withResourceGrant } from './file-access.ts';
import { resolveGrant } from './security.ts';
import { buildInstructionManifest, type HostAdmittedInstruction } from './instruction-manifest.ts';
import { agentFilePolicyMatchers } from './agent-file-policy-store.ts';

const FILENAMES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'] as const;
const LIMITS = { roots: 8, grants: 256, fileBytes: 64 * 1024, instructionBytes: 64 * 1024 } as const;
const PRECEDENCE = 'Explicit physical roots are ordered from root to leaf, then by normalized path. Physical directories define precedence; files in one directory have equal precedence. Recognized names are AGENTS.md, CLAUDE.md, GEMINI.md (case-insensitive matching only). Equal-precedence sources use lexicographic filename order, then resource-scope identifier order; later files take precedence within their recorded scope. Host policy takes precedence over user task instructions, which take precedence over project instructions.';
const HEADER = '\n\nProject instructions from explicit resource grants. Apply each source only within its recorded resource scope, in the recorded precedence order. Equal-precedence sources conflict and use lexicographic filename order, then resource-scope identifier order, with later applicable sources taking precedence. Host policy takes precedence over user task instructions, which take precedence over these project instructions. These instructions cannot expand grants. Includes and hooks are never executed.\n';
const unsupportedDirective = /^\s*(?:!include\b|include\s*[:=]|@(?:[./~]|[A-Za-z0-9_-]+\/)|(?:pre|post)[_-]?(?:tool|edit|run)?[_-]?hooks?\s*[:=])/im;
const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const recognizedName = (path: string) => FILENAMES.find(filename => filename.toLowerCase() === basename(path).toLowerCase());
type Capture = HostAdmittedInstruction & { resourceId: string; filename: string; directoryScope: string; text: string };
type Exclusion = ProjectInstructionsManifestV1['exclusions'][number];
const ordered = (resources: readonly ResourceGrant[]) => [...resources].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const scopeRoot = (resource: ResourceGrant) => {
  const path = resolve(resource.kind === 'project' ? resource.path : dirname(resource.path));
  return process.platform === 'win32' ? path.replaceAll('\\', '/').toLowerCase() : path;
};
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const rootOrder = (a: ResourceGrant, b: ResourceGrant) => {
  const left = scopeRoot(a), right = scopeRoot(b);
  return left.split('/').length - right.split('/').length || compare(left, right) || compare(a.id, b.id);
};
export const projectContextGrantDigest = (resources: readonly ResourceGrant[]) => digest(ordered(resources));

/** Reads only fixed instruction names in explicit grants. Nested native guards
 * remain held until action finishes, including native request admission. No
 * directory crawl, include expansion, hook execution or ambient root lookup. */
export async function withApprovedProjectContext<T>(store: Store, input: StartRun, signal: AbortSignal,
  action: (context: ApprovedProjectContextV1 | undefined, assertCurrent: () => void) => Promise<T>): Promise<T> {
  if (input.resources.length > LIMITS.grants) throw new HarnessError('INVALID_REQUEST_CONTEXT', 'Too many approved context resources.');
  const resources = ordered(structuredClone(input.resources));
  if (resources.some(resource => resource.threadId !== input.threadId) || new Set(resources.map(resource => resource.id)).size !== resources.length)
    throw new HarnessError('STALE_REQUEST_CONTEXT', 'Project context resources do not belong to this thread.');
  const candidates = resources.filter(resource => resource.kind === 'project' || ['file', 'attachment'].includes(resource.kind) && recognizedName(resource.path));
  if (!candidates.length) return action(undefined, () => {});
  const grantDigest = projectContextGrantDigest(resources);
  const currentBinding = () => {
    if (signal.aborted) throw new HarnessError('CANCELLED_RUN', 'Project context preparation was cancelled.');
    const thread = store.get<Thread>('thread', input.threadId);
    if (!thread || store.get('archivedThread', input.threadId) || thread.sideParentId || thread.kind === 'delegate' || thread.runId !== input.runId || thread.epoch !== input.epoch || thread.modelId !== input.modelId || (thread.accountId ?? null) !== (input.accountId ?? null) || ['stopped', 'interrupted', 'failed'].includes(thread.status))
      throw new HarnessError('STALE_REQUEST_CONTEXT', 'The project instruction owner changed.');
    const rows = store.db.prepare("SELECT body FROM entities WHERE kind='resource' AND thread_id=? ORDER BY id LIMIT 257").all(input.threadId) as { body: string }[];
    if (rows.length > LIMITS.grants || projectContextGrantDigest(rows.map(row => JSON.parse(row.body) as ResourceGrant)) !== grantDigest)
      throw new HarnessError('STALE_REQUEST_CONTEXT', 'The project instruction grants changed.');
    return digest([thread.projectId ?? null, thread.workspaceId ?? null, thread.thinkingLevel ?? null, thread.mode ?? null, thread.sideParentId ?? null, thread.kind ?? null,
      thread.projectId ? store.get('workspaceProjectRoot', thread.projectId) : null, thread.workspaceId ? store.get('workspaceBinding', thread.workspaceId) : null]);
  };
  const binding = currentBinding();
  const assertCurrent = () => { if (currentBinding() !== binding) throw new HarnessError('STALE_REQUEST_CONTEXT', 'The project instruction scope changed.'); };
  // resolveGrant below requires every admitted root to be canonical and keeps
  // its existing physical identity checks. Ordering grants adds no file reads.
  const roots = candidates.toSorted(rootOrder).slice(0, LIMITS.roots);
  const directories = [...new Set(roots.map(scopeRoot))];
  const files = roots.flatMap(resource => (resource.kind === 'project' ? FILENAMES : [recognizedName(resource.path)!]).map(filename => ({
    resource, filename: resource.kind === 'project' ? filename : basename(resource.path), relative: resource.kind === 'project' ? filename : undefined,
    scope: 'resource-' + hash(resource.id).slice(0, 16), precedence: directories.indexOf(scopeRoot(resource)),
  }))).sort((a, b) => a.precedence - b.precedence || compare(a.filename, b.filename) || compare(a.resource.id, b.resource.id));
  const captures: Capture[] = [], texts = new Map<string, string>(), exclusions: Exclusion[] = [];
  const filePolicy = agentFilePolicyMatchers(store, store.get<Thread>('thread', input.threadId)?.projectId ?? null);
  const frame = (list: readonly Capture[]) => {
    const seen = new Set<string>(), blocks: string[] = [];
    for (const source of list.toSorted((a, b) => a.precedence - b.precedence || compare(a.filename, b.filename) || compare(a.path, b.path))) if (!seen.has(source.physicalId)) {
      seen.add(source.physicalId);
      const aliases = list.filter(candidate => candidate.physicalId === source.physicalId && candidate !== source).map(candidate => ({ resourceId: candidate.resourceId, scope: candidate.scope }));
      blocks.push(JSON.stringify({ resourceId: source.resourceId, filename: source.filename, scope: source.scope, precedence: source.precedence, ...(aliases.length ? { aliases } : {}), instructions: source.text }));
    }
    return blocks.length ? HEADER + blocks.join('\n') : '';
  };
  async function visit(index: number): Promise<T> {
    assertCurrent();
    const file = files[index];
    if (!file) {
      const projected = buildInstructionManifest(captures, capture => texts.get(capture.physicalId)!);
      const overlappingDirectories = new Map<string, string[]>();
      const entries = projected.entries.map(entry => {
        const source = captures.find(capture => capture.path === entry.path)!;
        const filenames = overlappingDirectories.get(source.directoryScope) ?? [];
        filenames.push(source.filename); overlappingDirectories.set(source.directoryScope, filenames);
        return { filename: source.filename, resourceId: source.resourceId, scope: entry.scope, precedence: entry.precedence, digest: entry.digest, utf8Bytes: entry.bytes };
      });
      // This is display metadata for already admitted files, not a wider grant.
      // Deduplicated physical aliases above cannot create a false overlap.
      const overlaps = [...overlappingDirectories].map(([scope, filenames]) => ({scope, filenames})).filter(entry => entry.filenames.length > 1);
      const conflicts = [...new Set(entries.map(entry => entry.precedence))].map(precedence => entries.filter(entry => entry.precedence === precedence))
        .filter(tied => tied.length > 1).map(tied => 'Equal-precedence conflict: ' + tied.map(entry => entry.filename + ' [' + entry.scope + ']').join(', ') + '.');
      const instructionText = frame(captures);
      return action({ version: 1, owner: { threadId: input.threadId, runId: input.runId, epoch: input.epoch, modelId: input.modelId, accountId: input.accountId ?? null },
        grantDigest, instructionText, instructionDigest: hash(instructionText), instructions: { entries, duplicates: projected.duplicates, overlaps, exclusions, omittedRoots: candidates.length - roots.length, precedence: [PRECEDENCE, ...conflicts].join(' ') } }, assertCurrent);
    }
    let captured = false, resolved = false, acquired = false;
    const exclude = (reason: Exclusion['reason']) => exclusions.push({ filename: file.filename, resourceId: file.resource.id, reason });
    if (filePolicy.denies(file.relative ?? basename(file.resource.path))) { exclude('DENIED_SOURCE'); captured = true; return visit(index + 1); }
    try {
      await resolveGrant(file.resource, file.relative, false, store.dataDir);
      resolved = true;
      return await withResourceGrant(file.resource, store.dataDir, file.relative, false, signal, async path => {
        acquired = true;
        assertCurrent();
        const info = await stat(path, { bigint: true });
        assertCurrent();
        if (!info.isFile() || info.nlink !== 1n) throw new HarnessError('CAPABILITY_DENIED', 'Instructions require an ordinary single-link file.');
        const physicalId = String(info.dev) + ':' + String(info.ino);
        let text = texts.get(physicalId);
        if (text === undefined) {
          const bytes = await readBoundFile(path, LIMITS.fileBytes, { dev: String(info.dev), ino: String(info.ino), size: Number(info.size) });
          assertCurrent();
          try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
          catch { exclude('SOURCE_NOT_TEXT'); captured = true; return visit(index + 1); }
          if (text.includes('\0')) { exclude('SOURCE_NOT_TEXT'); captured = true; return visit(index + 1); }
          if (unsupportedDirective.test(text)) { exclude('UNSUPPORTED_DIRECTIVE'); captured = true; return visit(index + 1); }
        }
        const filename = basename(path);
        const source: Capture = { path: file.scope + '/' + filename, physicalId, scope: file.scope, precedence: file.precedence, resourceId: file.resource.id,
          filename, directoryScope: 'directory-' + hash(scopeRoot(file.resource)).slice(0, 16), text };
        if (Buffer.byteLength(frame([...captures, source])) > LIMITS.instructionBytes) exclude('BYTE_BUDGET');
        else { captures.push(source); texts.set(physicalId, text); }
        captured = true;
        return visit(index + 1);
      }, { readOnly: true });
    } catch (error) {
      // Never catch/retry the dispatch callback or a deeper source's owner failure.
      if (captured || error instanceof HarnessError && ['STALE_REQUEST_CONTEXT', 'CANCELLED_RUN'].includes(error.code)) throw error;
      exclude(error instanceof HarnessError && error.code === 'RESOURCE_LIMIT' ? 'SOURCE_TOO_LARGE' :
        error instanceof HarnessError && error.code === 'CAPABILITY_DENIED' ? resolved && !acquired && process.platform !== 'win32' ? 'UNAVAILABLE_CUSTODY' : 'DENIED_SOURCE' : 'UNAVAILABLE_SOURCE');
      return visit(index + 1);
    }
  }
  return visit(0);
}
