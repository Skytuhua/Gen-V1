import { describe, expect, it } from 'vitest';
import { admitArtifactContents } from '../packages/core/ui-admission';
import type { ArtifactRecord, Operation, ResourceGrant, SurfaceSpec } from '../packages/contracts';
import type { Store } from '../packages/storage/store';

const sourceHash = 'a'.repeat(64), outputHash = 'b'.repeat(64);
const operation: Operation = { id: 'export', threadId: 'thread', revision: 1, kind: 'pdf.export', description: 'Export agreement', args: { resourceId: 'input', exportResourceId: 'output', outputPath: 'signed.pdf' }, resourceIds: ['input', 'output'], preconditions: { sha256: sourceHash, outputSha256: outputHash }, approved: true, status: 'succeeded', result: { resourceId: 'output', path: 'signed.pdf', sha256: outputHash }, createdAt: '2026-10-30' };
const grants: ResourceGrant[] = ['input', 'output'].map(id => ({ id, threadId: 'thread', kind: id === 'input' ? 'file' : 'export', path: 'C:/fixture/' + id, label: id, writable: id === 'output', createdAt: '2026-10-30' }));
function admit(op: Operation = operation, resources = grants, previousResourceId?: string) {
  const store = { get: (kind: string, id: string) => kind === 'operation' ? id === op.id ? op : undefined : resources.find(resource => resource.id === id) } as unknown as Store;
  const spec: SurfaceSpec = { root: 'pdf', elements: { pdf: { type: 'DocumentPreview', props: { resourceId: 'output', resourcePath: 'signed.pdf', exportOperationId: 'export' } } } };
  const previous = previousResourceId ? { bindings: {}, actions: {}, spec: { root: 'pdf', elements: { pdf: { type: 'DocumentPreview', props: { resourceId: previousResourceId, ...(previousResourceId === 'output' ? { resourcePath: 'signed.pdf' } : {}) } } } } } as unknown as ArtifactRecord : null;
  return admitArtifactContents(store, 'thread', {}, spec, previous);
}
describe('explicit PDF export continuity admission', () => {
  it('admits only successful approved same-thread exact export evidence', () => { expect(() => admit()).not.toThrow(); });
  it.each([
    ['unapproved', { approved: false }], ['unknown', { status: 'unknown' }], ['cross-thread', { threadId: 'other' }], ['wrong kind', { kind: 'file.replace' }],
    ['wrong destination', { result: { resourceId: 'output', path: 'different.pdf', sha256: outputHash } }], ['wrong hash', { result: { resourceId: 'output', path: 'signed.pdf', sha256: sourceHash } }],
  ])('rejects %s evidence', (_name, patch) => { expect(() => admit({ ...operation, ...patch } as Operation)).toThrow(); });
  it('rejects an absent original grant', () => { expect(() => admit(operation, grants.filter(grant => grant.id !== 'input'))).toThrow(); });
  it('does not stitch an export onto an unrelated previous preview', () => { expect(() => admit(operation, grants, 'unrelated')).toThrow(); });
  it('admits repeated updates of the already exported destination', () => { expect(() => admit(operation, grants, 'output')).not.toThrow(); });
});
