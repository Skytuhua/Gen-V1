import { describe, expect, it } from 'vitest';
import { CAPABILITIES, SURFACE_LIMITS, validateSurface } from '../packages/ui-catalog';
import { disclosureData, mapData, relationshipData, tableChangesData } from '../packages/ui-catalog/workflow';

const surface = (type: string, props: Record<string, unknown>) => ({ root: 'view', elements: { view: { type, props } } });

describe('reusable source-bound task surfaces', () => {
  it('admits independent graph layouts and bounded source metadata', () => {
    for (const orientation of ['vertical', 'horizontal']) expect(() => validateSurface(surface('RelationshipGraph', { dataBinding: 'history', orientation }))).not.toThrow();
    expect(relationshipData.safeParse({ nodes: [{ id: 'head', label: 'Release review', status: 'merged', hash: '04f8b23', author: 'Jules', time: '2m ago', branch: 'release', conflictCount: 2, excerpts: [{ label: 'Current', text: 'retry()' }, { label: 'Incoming', text: 'await retry()' }], checks: [{ label: 'Tests', status: 'success', detail: 'Synthetic: 24 assertions' }] }], edges: [] }).success).toBe(true);
    expect(relationshipData.safeParse({ nodes: [{ id: 'a', label: 'A', excerpts: Array.from({ length: 5 }, () => ({ label: 'x', text: 'x' })) }], edges: [] }).success).toBe(false);
    expect(() => validateSurface(surface('RelationshipGraph', { dataBinding: 'history', orientation: 'diagonal' }))).toThrow();
  });
  it('keeps disclosure loading and table changes source-bound', () => {
    expect(() => validateSurface(surface('Disclosure', { title: 'Can delivery be split?', stateKey: 'deliveryOpen', dataBinding: 'answer', onOpenActionId: 'expand', payload: { topic: 'delivery' } }))).not.toThrow();
    expect(disclosureData.safeParse({ status: 'ready', answer: 'Yes, choose destinations before confirming.' }).success).toBe(true);
    expect(disclosureData.safeParse({ status: 'ready', answer: 'yes', execute: 'fetch()' }).success).toBe(false);
    expect(() => validateSurface(surface('Table', { rowsBinding: 'rows', columns: [{ key: 'owner', label: 'Owner' }], changesBinding: 'changes' }))).not.toThrow();
    expect(tableChangesData.safeParse({ revision: 3, activeRowId: 'row-1', rows: [{ id: 'row-1', status: 'updated', cells: [{ key: 'owner', status: 'updated', before: null, detail: 'Bound source correction' }] }] }).success).toBe(true);
    expect(tableChangesData.safeParse({ rows: [{ id: 'row-1', cells: [{ key: '/inputs/secret' }] }] }).success).toBe(false);
  });
  it('admits a linked local map and rejects unbounded or executable map inputs', () => {
    expect(() => validateSurface(surface('MapView', { dataBinding: 'places', stateKey: 'selectedPlace', themeStateKey: 'mapTheme', feedbackActionId: 'feedback' }))).not.toThrow();
    expect(mapData.safeParse({ points: [{ id: 'north', label: 'North entrance', x: 25, y: 40 }, { id: 'east', label: 'East entrance', x: 80, y: 55 }], routes: [{ id: 'walk', pointIds: ['north', 'east'] }], source: 'Synthetic local plan' }).success).toBe(true);
    expect(mapData.safeParse({ points: [{ id: 'x', label: 'Outside', x: 101, y: 0 }] }).success).toBe(false);
    expect(mapData.safeParse({ points: [{ id: 'x', label: 'A', x: 1, y: 1 }], routes: [{ id: 'broken', pointIds: ['x', 'missing'] }] }).success).toBe(false);
    expect(() => validateSurface(surface('MapView', { dataBinding: 'places', stateKey: 'selectedPlace', tileUrl: 'https://example.test/{x}' }))).toThrow();
    expect(() => validateSurface(surface('Form', { actionId: 'ask', clearOnSuccess: ['question'] }))).not.toThrow();
  });
  it('publishes descriptions with composition guidance without relaxing graph custody limits', () => {
    expect(SURFACE_LIMITS).toEqual({ nodes: 200, depth: 12, bytes: 131072 });
    for (const name of ['Disclosure', 'RelationshipGraph', 'Table', 'MapView']) expect(CAPABILITIES.find(capability => capability.name === name)?.description.length).toBeGreaterThan(200);
  });
});
