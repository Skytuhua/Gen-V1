import { describe, expect, it } from 'vitest';
import { columnWidth, cycleSort, keyboardWidth, moveColumn, reconcileOrder, tableIdentity, tableText, tableView } from '../apps/web/src/task-table-model';
const columns = [{ key: 'value', label: 'Value' }, { key: 'other', label: 'Value' }];
describe('local table controls', () => {
  it('clamps resize and applies the panel keyboard step and endpoints', () => {
    expect([columnWidth(-20), columnWidth(900), columnWidth(500, 600)]).toEqual([90, 420, 600]);
    expect(['ArrowLeft', 'ArrowRight', 'Home', 'End'].map(key => keyboardWidth(140, key))).toEqual([120, 160, 90, 420]);
    expect(keyboardWidth(95, 'ArrowLeft')).toBe(90);
  });
  it('moves every data column by key without changing the input; reconciles live columns', () => {
    const order = Object.freeze(['a', 'b', 'c']);
    expect(moveColumn([...order], 'a', 2)).toEqual(['b', 'c', 'a']);
    expect(moveColumn([...order], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(reconcileOrder(['c', 'removed', 'a'], ['a', 'new', 'c'])).toEqual(['c', 'a', 'new']);
    expect(order).toEqual(['a', 'b', 'c']);
  });
  it('cycles one sort through asc, desc and none, and changes columns by key', () => {
    const asc = cycleSort(null, 'value'), desc = cycleSort(asc, 'value');
    expect(asc?.direction).toBe('ascending'); expect(desc?.direction).toBe('descending');
    expect(cycleSort(desc, 'value')).toBeNull(); expect(cycleSort(desc, 'other')).toEqual({ key: 'other', direction: 'ascending' });
  });
  it('sorts typed numbers and booleans, leaves null/missing last both ways and preserves ties and source order', () => {
    const rows = Object.freeze([{ value: 10 }, { value: null }, { value: 2 }, {}, { value: 2 }]);
    expect(tableView([...rows], columns, '', { key: 'value', direction: 'ascending' }).map(row => row.index)).toEqual([2, 4, 0, 1, 3]);
    expect(tableView([...rows], columns, '', { key: 'value', direction: 'descending' }).map(row => row.index)).toEqual([0, 2, 4, 1, 3]);
    expect(tableView([...rows], columns, '', null).map(row => row.index)).toEqual([0, 1, 2, 3, 4]);
    expect(tableView([{ value: true }, { value: false }], columns, '', { key: 'value', direction: 'ascending' }).map(row => row.index)).toEqual([1, 0]);
    expect(rows[0]?.value).toBe(10);
  });
  it('keeps mixed types in a stable order and compares complex values by displayed text', () => {
    const values = ['2', '10', { nested: 1 }, false, 3];
    const sorted = tableView(values.map(value => ({ value })), columns, '', { key: 'value', direction: 'ascending' });
    expect(sorted.map(row => row.item.value)).toEqual([3, '2', '10', false, { nested: 1 }]);
    expect(tableText(null)).toBe('NULL'); expect(tableText(undefined)).toBe('—');
  });
  it('filters literal displayed values across supplied cells before sorting, ignoring outer whitespace and case', () => {
    const rows = [{ value: 'A.*', other: 'no' }, { value: 'a', other: 'A.*' }, { value: 'aaa' }, { value: { key: 'A.*' } }];
    expect(tableView(rows, columns, '  a.*  ', null).map(row => row.index)).toEqual([0, 1, 3]);
    expect(tableView([{ value: 'Z', other: 'match' }, { value: 'A', other: 'MATCH' }, { value: 'B' }], columns, 'match', { key: 'value', direction: 'ascending' }).map(row => row.index)).toEqual([1, 0]);
    expect(tableView([], columns, 'anything', null)).toEqual([]);
  });
  it('uses the existing custom rowKey and safely falls back for any missing or duplicate id', () => {
    expect(tableIdentity([{ code: 0 }, { code: 2 }], 'code')).toMatchObject({ stable: true, ids: ['0', '2'] });
    for (const rows of [[{ id: 'x' }, {}], [{ id: 1 }, { id: '1' }]]) {
      expect(tableIdentity(rows)).toMatchObject({ stable: false, ids: rows[0]?.id === 'x' ? ['x', '1'] : ['0', 'index:1'] });
      expect(tableIdentity(rows).rowOrderKey).not.toBe(tableIdentity([...rows].reverse()).rowOrderKey);
    }
  });
});

it('QA r1: mixed types have a consistent order for every source permutation in both directions', () => {
  const permutations = [[2, 10, '11'], [2, '11', 10], [10, 2, '11'], [10, '11', 2], ['11', 2, 10], ['11', 10, 2]];
  for (const values of permutations) {
    const rows = values.map(value => ({ value }));
    expect(tableView(rows, columns, '', { key: 'value', direction: 'ascending' }).map(row => row.item.value)).toEqual([2, 10, '11']);
    expect(tableView(rows, columns, '', { key: 'value', direction: 'descending' }).map(row => row.item.value)).toEqual(['11', 10, 2]);
  }
});
it('QA r1: strings sort naturally, dates sort by time, and null/empty stay last in either direction', () => {
  const early = new Date('2026-01-01T00:00:00Z'), late = new Date('+010000-01-01T00:00:00Z');
  for (const direction of ['ascending', 'descending'] as const) {
    const sorted = (values: unknown[]) => tableView(values.map(value => ({ value })), columns, '', { key: 'value', direction }).map(row => row.item.value);
    expect(sorted(['10', '', '2', null, '3', undefined, '  '])).toEqual([...(direction === 'ascending' ? ['2', '3', '10'] : ['10', '3', '2']), '', null, undefined, '  ']);
    expect(sorted([late, early, new Date(NaN)])).toEqual([...(direction === 'ascending' ? [early, late] : [late, early]), new Date(NaN)]);
    expect(sorted([false, 0, '', null])).toEqual([...(direction === 'ascending' ? [0, false] : [false, 0]), '', null]);
  }
});
it('QA r1: valid row ids survive bad neighbors and fallback ids cannot collide with supplied ids', () => {
  expect(tableIdentity([{ id: 'a' }, {}, { id: 'dup' }, { id: 'dup' }, { id: {} }, { id: false }, { id: '' }, { id: NaN }, { id: Infinity }])).toMatchObject({ stable: false, ids: ['a', '1', '2', '3', '4', '5', '6', '7', '8'] });
  const collision = tableIdentity([{}, { id: '0' }, { id: 'index:0' }]);
  expect(new Set(collision.ids).size).toBe(3); expect(collision.ids.slice(1)).toEqual(['0', 'index:0']);
  expect(tableIdentity([{ id: '0' }, { id: '0' }]).ids).not.toContain('0');
});
