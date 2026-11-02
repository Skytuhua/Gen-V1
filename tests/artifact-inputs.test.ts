import { describe, expect, it } from 'vitest';
import type { ArtifactRecord, DataRecord, Snapshot } from '../packages/contracts/index.ts';
import { createArtifactInputResolver } from '../apps/web/src/artifact-inputs';

type InputArtifact = Pick<ArtifactRecord, 'id' | 'threadId' | 'stateId' | 'bindings'>;
const source = (revision = 1): DataRecord => ({ id: 'source', threadId: 'one', revision, value: { rows: [{ id: 'row', label: `Revision ${revision}` }], summary: 'Source summary' }, provenance: 'Synthetic input fixture', createdAt: '2026-10-31T00:00:00Z' });
function fixture() {
  const artifact: InputArtifact = { id: 'artifact', threadId: 'one', stateId: 'state', bindings: { rows: { mode: 'live', id: 'source', pointer: '/rows' } } };
  const snapshot: Pick<Snapshot, 'data'> = { data: [source()] };
  return { artifact, snapshot };
}

describe('revision-bound artifact inputs', () => {
  it('retains input and source identities through fresh snapshots of unchanged versions', () => {
    const resolve = createArtifactInputResolver(), { artifact, snapshot } = fixture();
    const inputs = resolve(artifact, snapshot);
    expect(resolve(structuredClone(artifact), structuredClone(snapshot))).toBe(inputs);
    expect(resolve(artifact, snapshot).rows).toBe(inputs.rows);
  });

  it('updates live sources while retaining an unchanged pinned source object', () => {
    const resolve = createArtifactInputResolver(), { artifact, snapshot } = fixture();
    artifact.bindings.pinned = { mode: 'snapshot', ref: { id: 'source', revision: 1, pointer: '/rows' } };
    const before = resolve(artifact, snapshot), next = { data: [structuredClone(snapshot.data[0]!), source(2)] };
    const inputs = resolve(structuredClone(artifact), next);
    expect(inputs).not.toBe(before);
    expect(inputs.rows).toEqual([{ id: 'row', label: 'Revision 2' }]);
    expect(inputs.pinned).toBe(before.pinned);
    expect(resolve(artifact, { data: [...next.data].reverse() })).toBe(inputs);
  });

  it('honors changed pointers and pinned-version retargeting', () => {
    const resolve = createArtifactInputResolver(), { artifact, snapshot } = fixture();
    resolve(artifact, snapshot);
    artifact.bindings.rows = { mode: 'live', id: 'source', pointer: '/summary' };
    expect(resolve(artifact, snapshot).rows).toBe('Source summary');
    artifact.bindings.rows = { mode: 'snapshot', ref: { id: 'source', revision: 2, pointer: '/rows' } };
    expect(resolve(artifact, snapshot).rows).toBeUndefined();
    expect(resolve(artifact, { data: [source(2), source()] }).rows).toEqual([{ id: 'row', label: 'Revision 2' }]);
  });

  it('clears removed sources and bindings instead of retaining their payloads', () => {
    const resolve = createArtifactInputResolver(), { artifact, snapshot } = fixture();
    const before = resolve(artifact, snapshot);
    expect(resolve(artifact, { data: [] })).toEqual({ rows: undefined });
    const restored = resolve(artifact, structuredClone(snapshot));
    expect(restored).not.toBe(before);
    artifact.bindings = {};
    expect(resolve(artifact, snapshot)).toEqual({});
  });

  it('scopes cached versions to the artifact, state owner and thread', () => {
    const resolve = createArtifactInputResolver(), { artifact, snapshot } = fixture();
    const before = resolve(artifact, snapshot);
    expect(resolve({ ...artifact, id: 'another-artifact' }, snapshot)).not.toBe(before);
    const changedOwner = resolve({ ...artifact, stateId: 'another-state' }, snapshot);
    expect(changedOwner).not.toBe(before);
    expect(resolve(artifact, { data: [{ ...source(), threadId: 'other' }] })).toEqual({ rows: undefined });
    expect(resolve({ ...artifact, threadId: 'other' }, snapshot)).toEqual({ rows: undefined });
  });

  it('preserves escaped JSON pointers and rejects prototype traversal', () => {
    const resolve = createArtifactInputResolver(), { artifact, snapshot } = fixture();
    snapshot.data[0]!.value = { 'a/b': { '~label': 'Escaped field' }, constructor: { value: 'hidden' } };
    artifact.bindings = { escaped: { mode: 'live', id: 'source', pointer: '/a~1b/~0label' }, rejected: { mode: 'live', id: 'source', pointer: '/constructor/value' } };
    expect(resolve(artifact, snapshot)).toEqual({ escaped: 'Escaped field', rejected: undefined });
  });
});
