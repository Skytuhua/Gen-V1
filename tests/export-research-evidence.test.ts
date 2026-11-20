import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HarnessError, type Operation, type ResourceGrant } from '../packages/contracts/index.ts';
import { documentExportEvidence, sameDocumentLocation, type DocumentLocation } from '../packages/ui-catalog/document-export-evidence.ts';
import { currentResearchGrant, researchDenied, researchHash } from '../packages/research/capture.ts';
import type { ResearchContext } from '../packages/contracts/research.ts';
import { Store } from '../packages/storage/store.ts';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const DENIAL = 'could not be verified';

const baseOperation = (): Operation => ({
  id: 'op-1', threadId: 'thread-a', revision: 1, kind: 'pdf.export', description: 'export',
  args: { resourceId: 'res-src', exportResourceId: 'res-out', outputPath: 'out/report.pdf' },
  resourceIds: ['res-src', 'res-out'],
  preconditions: { sha256: sha('source-bytes'), outputSha256: sha('output-bytes') },
  status: 'succeeded', approved: true, createdAt: '2026-01-01T00:00:00.000Z',
  result: { resourceId: 'res-out', path: 'out/report.pdf', sha256: sha('output-bytes') },
});

const grant = (id: string, path = '/work/x.pdf'): ResourceGrant => ({ id, threadId: 'thread-a', kind: 'file', path, label: 'x', writable: true, createdAt: '2026-01-01T00:00:00.000Z' });
const destination = (): DocumentLocation => ({ resourceId: 'res-out', resourcePath: 'out/report.pdf' });
const verify = (over: { operation?: Operation; operations?: Operation[]; resources?: ResourceGrant[]; destination?: DocumentLocation; previous?: DocumentLocation; threadId?: string; operationId?: string } = {}) =>
  documentExportEvidence(over.threadId ?? 'thread-a', over.operationId ?? 'op-1', over.operations ?? [over.operation ?? baseOperation()], over.resources ?? [grant('res-src'), grant('res-out')], over.destination ?? destination(), over.previous);

describe('sameDocumentLocation', () => {
  it('compares resourceId and optional path, treating missing and empty as equal', () => {
    expect(sameDocumentLocation({ resourceId: 'a' }, { resourceId: 'a', resourcePath: '' })).toBe(true);
    expect(sameDocumentLocation({ resourceId: 'a', resourcePath: 'p' }, { resourceId: 'a', resourcePath: 'p' })).toBe(true);
    expect(sameDocumentLocation({ resourceId: 'a', resourcePath: 'p' }, { resourceId: 'a' })).toBe(false);
    expect(sameDocumentLocation({ resourceId: 'a' }, { resourceId: 'b' })).toBe(false);
    expect(sameDocumentLocation({ resourceId: 'a' }, { resourceId: 'a', resourcePath: undefined })).toBe(true);
  });
});

describe('documentExportEvidence', () => {
  it('returns verified evidence for a well-formed export', () => {
    const evidence = verify();
    expect(evidence).toEqual({
      operationId: 'op-1',
      source: { resourceId: 'res-src' },
      destination: { resourceId: 'res-out', resourcePath: 'out/report.pdf' },
      sourceSha256: sha('source-bytes'),
      outputSha256: sha('output-bytes'),
    });
  });
  it('carries a source resourcePath when args.path is set', () => {
    const operation = baseOperation();
    operation.args = { ...operation.args, path: 'docs/in.pdf' };
    expect(verify({ operation, operations: [operation] }).source).toEqual({ resourceId: 'res-src', resourcePath: 'docs/in.pdf' });
  });
  it.each([
    ['missing operation', { operations: [] }],
    ['unknown operationId', { operationId: 'op-404' }],
    ['wrong thread', { threadId: 'thread-b' }],
    ['unapproved', { operation: { ...baseOperation(), approved: false } }],
    ['not succeeded', { operation: { ...baseOperation(), status: 'failed' as const } }],
    ['not a pdf.export kind', { operation: { ...baseOperation(), kind: 'write' } }],
    ['different thread on the operation', { operation: { ...baseOperation(), threadId: 'thread-b' } }],
  ])('denies evidence for %s', (_name, over) => {
    expect(() => verify(over as Parameters<typeof verify>[0])).toThrowError(DENIAL);
  });
  it.each([
    ['missing result', (op: Operation) => { delete op.result; }],
    ['non-object result', (op: Operation) => { op.result = 'x'; }],
    ['missing resourceId arg', (op: Operation) => { delete op.args.resourceId; }],
    ['missing exportResourceId arg', (op: Operation) => { delete op.args.exportResourceId; }],
    ['empty outputPath', (op: Operation) => { op.args.outputPath = ''; }],
    ['non-string args.path', (op: Operation) => { op.args.path = 4; }],
    ['result resourceId mismatch', (op: Operation) => { (op.result as Record<string, unknown>).resourceId = 'other'; }],
    ['result path mismatch', (op: Operation) => { (op.result as Record<string, unknown>).path = 'else.pdf'; }],
    ['result sha256 mismatch', (op: Operation) => { (op.result as Record<string, unknown>).sha256 = sha('different'); }],
    ['bad source sha format', (op: Operation) => { op.preconditions.sha256 = 'zzz'; }],
    ['missing outputSha256', (op: Operation) => { delete op.preconditions.outputSha256; }],
  ])('denies when %s', (_name, mutate) => {
    const operation = baseOperation();
    mutate(operation);
    expect(() => verify({ operation, operations: [operation] })).toThrowError(DENIAL);
  });
  it('denies a destination that does not match the approved args', () => {
    expect(() => verify({ destination: { resourceId: 'res-out', resourcePath: 'other.pdf' } })).toThrowError(DENIAL);
    expect(() => verify({ destination: { resourceId: 'res-src', resourcePath: 'out/report.pdf' } })).toThrowError(DENIAL);
    expect(() => verify({ destination: { resourceId: 'res-out' } })).toThrowError(DENIAL);
  });
  it('denies when either resource is not bound to the operation or thread', () => {
    const operation = baseOperation();
    operation.resourceIds = ['res-src'];
    expect(() => verify({ operation, operations: [operation] })).toThrowError(DENIAL);
    expect(() => verify({ resources: [grant('res-src'), { ...grant('res-out'), threadId: 'other' }] })).toThrowError(DENIAL);
    expect(() => verify({ resources: [grant('res-src')] })).toThrowError(DENIAL);
  });
  it('accepts a previous location equal to source or destination and rejects any other', () => {
    expect(verify({ previous: { resourceId: 'res-src' } }).operationId).toBe('op-1');
    expect(verify({ previous: { resourceId: 'res-out', resourcePath: 'out/report.pdf' } }).operationId).toBe('op-1');
    expect(() => verify({ previous: { resourceId: 'res-out', resourcePath: 'other.pdf' } })).toThrowError(DENIAL);
    expect(() => verify({ previous: { resourceId: 'res-src', resourcePath: 'extra' } })).toThrowError(DENIAL);
  });
});

describe('researchHash', () => {
  it('computes the sha256 hex of the exact bytes', () => {
    expect(researchHash(new TextEncoder().encode('abc'))).toBe(sha('abc'));
    expect(researchHash(new Uint8Array())).toBe(sha(''));
    expect(researchHash(new TextEncoder().encode('é'))).toBe(createHash('sha256').update(Buffer.from([0xc3, 0xa9])).digest('hex'));
  });
});

describe('currentResearchGrant', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => { for (const fn of cleanups.splice(0)) fn(); });
  const context: ResearchContext = { authority: { kind: 'personal' }, threadId: 'thread-a', projectId: null };
  const setup = (over: Partial<ResourceGrant> = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'gen-research-'));
    const store = new Store(dir);
    cleanups.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
    const resource: ResourceGrant = { id: 'res-1', threadId: 'thread-a', kind: 'file', path: '/work/doc.txt', label: 'doc', writable: false, createdAt: '2026-01-01T00:00:00.000Z', identity: { dev: '1', ino: '2' }, ...over };
    store.internal('fixture.grant', 'thread-a', () => store.put('resource', resource.id, resource.threadId, resource));
    return { store, resource };
  };
  it('returns the grant when it is well bound to the thread', () => {
    const { store, resource } = setup();
    expect(currentResearchGrant(store, context, 'res-1')).toEqual(resource);
  });
  it.each([['project' as const], ['attachment' as const]])('accepts the %s kind', kind => {
    const { store } = setup({ kind });
    expect(currentResearchGrant(store, context, 'res-1').kind).toBe(kind);
  });
  it.each([
    ['a missing grant', (s: Store) => { s.internal('fixture', 'thread-a', () => s.remove('resource', 'res-1')); }],
    ['a grant for another thread', (s: Store) => { s.internal('fixture', 'thread-b', () => s.put('resource', 'res-1', 'thread-b', { ...grant('res-1'), threadId: 'thread-b', identity: { dev: '1', ino: '2' } })); }],
    ['a grant without file identity', (s: Store) => { s.internal('fixture', 'thread-a', () => s.put('resource', 'res-1', 'thread-a', { ...grant('res-1'), identity: undefined })); }],
    ['a non-document kind', (s: Store) => { s.internal('fixture', 'thread-a', () => s.put('resource', 'res-1', 'thread-a', { ...grant('res-1'), kind: 'database' as const, identity: { dev: '1', ino: '2' } })); }],
  ])('denies %s', (_name, mutate) => {
    const { store } = setup();
    mutate(store);
    expect(() => currentResearchGrant(store, context, 'res-1')).toThrowError(HarnessError);
  });
  it.each([
    '/work/../secret.txt', '/work/.env', '/work/.env.local', '/home/u/.ssh/id_rsa', '/a/.git/config',
    '/a/credentials.json', '/a/auth.json', '/a/.npmrc', '/a/.netrc', '/a/id_ed25519', '/a/key.pem',
    '/a/key.key', '/a/cert.pfx', '/a/vault.kdbx', '/a/.aws/credentials', 'nul\0byte',
  ])('denies sensitive path %s', path => {
    const { store } = setup({ path });
    expect(() => currentResearchGrant(store, context, 'res-1')).toThrowError(/not authorized/);
  });
  it('denies denied paths even inside allowed parents, case-insensitively', () => {
    const { store } = setup({ path: '/WORK/Sub/.ENV' });
    expect(() => currentResearchGrant(store, context, 'res-1')).toThrowError(/not authorized/);
  });
  it('normalizes backslashes before checking path components', () => {
    const { store } = setup({ path: 'C:\\work\\..\\secret.txt' });
    expect(() => currentResearchGrant(store, context, 'res-1')).toThrowError(/not authorized/);
  });
  it('throws CAPABILITY_DENIED via researchDenied', () => {
    try {
      researchDenied();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe('CAPABILITY_DENIED');
    }
  });
});
