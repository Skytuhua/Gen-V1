import { describe, expect, it } from 'vitest';
import type { ThreadNavigationRow as Thread } from '../packages/contracts/shell-read-models';
import { dropPatch, orderFor, rebalance, sectionOf, withinGroup } from '../apps/web/src/sidebar-reorder';

const row = (id: string, overrides: Partial<Thread> = {}, presentation?: NonNullable<Thread['presentation']>): Thread => ({
  id,
  title: id,
  status: 'ready',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  kind: 'main',
  ...overrides,
  presentation: presentation ? { ...presentation } : undefined,
} as Thread);

describe('sectionOf', () => {
  it('pins before every other state', () => {
    const item = row('a', { status: 'working', runId: 'r1' }, { pinned: true, settled: true });
    expect(sectionOf(item, true)).toBe('pinned');
  });
  it('routes working rows to the working section only when enabled', () => {
    const item = row('a', { status: 'working' });
    expect(sectionOf(item, true)).toBe('working');
    expect(sectionOf(item, false)).toBe('flat');
  });
  it('treats awaiting_input as working', () => {
    expect(sectionOf(row('a', { status: 'awaiting_input' }), true)).toBe('working');
  });
  it('settled rows land in settled after working evaluation', () => {
    const item = row('a', { status: 'working' }, { settled: true });
    expect(sectionOf(item, true)).toBe('working');
    expect(sectionOf(item, false)).toBe('settled');
  });
  it('applies the patch before evaluating', () => {
    const item = row('a', {}, { pinned: true });
    expect(sectionOf(item, true, { pinned: false })).toBe('flat');
  });
});

describe('orderFor', () => {
  it('returns 1 for an empty list', () => {
    expect(orderFor([], 0)).toBe(1);
  });
  it('uses midpoint between neighbors', () => {
    const list = [row('a', {}, { order: 2 }), row('b', {}, { order: 6 })];
    expect(orderFor(list, 1)).toBe(4);
  });
  it('appends past the last order', () => {
    expect(orderFor([row('a', {}, { order: 3 })], 1)).toBe(4);
  });
  it('prepends below the first order', () => {
    expect(orderFor([row('a', {}, { order: 3 })], 0)).toBe(2);
  });
  it('treats missing orders as zero', () => {
    const list = [row('a'), row('b', {}, { order: 10 })];
    expect(orderFor(list, 1)).toBe(5);
  });
  it('returns null when neighbors leave no gap', () => {
    const list = [row('a', {}, { order: 1 }), row('b', {}, { order: 1 })];
    expect(orderFor(list, 1)).toBeNull();
  });
});

describe('rebalance', () => {
  it('injects the item at index with dense orders', () => {
    const list = [row('a', {}, { order: 1 }), row('b', {}, { order: 2 }), row('c', {}, { order: 3 })];
    expect(rebalance(list, row('d'), 1)).toEqual([
      { id: 'd', order: 2 },
      { id: 'b', order: 3 },
      { id: 'c', order: 4 },
    ]);
  });
  it('reorders inside the same list', () => {
    const list = [row('a', {}, { order: 1 }), row('b', {}, { order: 2 }), row('c', {}, { order: 3 })];
    expect(rebalance(list, list[0]!, 2)).toEqual([
      { id: 'b', order: 1 },
      { id: 'c', order: 2 },
      { id: 'a', order: 3 },
    ]);
  });
  it('only writes changed rows', () => {
    const list = [row('a', {}, { order: 1 }), row('b', {}, { order: 1 })];
    expect(rebalance(list, row('c'), 1)).toEqual([
      { id: 'c', order: 2 },
      { id: 'b', order: 3 },
    ]);
  });
});

describe('dropPatch', () => {
  it('pins on the pinned list', () => {
    expect(dropPatch(row('a'), { list: 'pinned', index: 0 }, true)).toEqual({ pinned: true });
  });
  it('unpins onto the flat list when the row settles there', () => {
    const item = row('a', {}, { pinned: true });
    expect(dropPatch(item, { list: 'flat', index: 0 }, true)).toEqual({ pinned: false });
  });
  it('rejects a flat drop for a settled row', () => {
    const item = row('a', {}, { pinned: true, settled: true });
    expect(dropPatch(item, { list: 'flat', index: 0 }, true)).toBeNull();
    expect(dropPatch(item, { list: 'settled', index: 0 }, true)).toEqual({ pinned: false });
  });
  it('rejects a working drop for an idle row', () => {
    const item = row('a', {}, { pinned: true });
    expect(dropPatch(item, { list: 'working', index: 0 }, true)).toBeNull();
  });
  it('accepts a working drop for a running row', () => {
    const item = row('a', { runId: 'r1' }, { pinned: true });
    expect(dropPatch(item, { list: 'working', index: 0 }, true)).toEqual({ pinned: false });
  });
});

describe('withinGroup', () => {
  const project = (item: Thread) => item.projectId ?? item.projectName ?? 'Conversations';
  const a1 = row('a1', { projectId: 'A' }), a2 = row('a2', { projectId: 'A' });
  const b1 = row('b1', { projectId: 'B' }), b2 = row('b2', { projectId: 'B' });
  const rows = [a1, b1, b2];

  it('clamps a cross-project drop into the row own project run in the flat list', () => {
    expect(withinGroup('flat', rows, a2, 2, project)).toBe(1);
    expect(withinGroup('flat', rows, a2, 0, project)).toBe(0);
    expect(withinGroup('flat', rows, a2, 3, project)).toBe(1);
  });
  it('keeps a within-group position unchanged', () => {
    expect(withinGroup('flat', rows, a2, 1, project)).toBe(1);
  });
  it('leaves interleaved sections at the position the user chose', () => {
    const interleaved = [a1, b1, b2, a2];
    expect(withinGroup('pinned', interleaved, a2, 2, project)).toBe(2);
    expect(withinGroup('settled', interleaved, a2, 1, project)).toBe(1);
    expect(withinGroup('working', interleaved, a2, 3, project)).toBe(3);
  });
  it('leaves positions alone when grouping is off or the row has no group', () => {
    expect(withinGroup('flat', rows, a2, 3)).toBe(3);
    expect(withinGroup('flat', rows, a2, 3, () => null)).toBe(3);
  });
  it('leaves an ungrouped row target alone when no other row shares its group', () => {
    expect(withinGroup('flat', [b1, b2], a2, 2, project)).toBe(2);
  });
});
