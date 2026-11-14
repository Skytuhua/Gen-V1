export type TableColumn = { key: string; label: string; type?: 'text' | 'number' };
export type TableSort = { key: string; direction: 'ascending' | 'descending' } | null;
export const tableObject = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const tableText = (value: unknown): string => value == null ? value === null ? 'NULL' : '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
// Reuse locale state across thousands of cells and comparisons in a large table.
const numberFormatter = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 21 });
const naturalOrder = new Intl.Collator(undefined, { numeric: true });

// Declared numeric columns keep all significant digits; String() would switch to exponent notation.
export const tableCellText = (value: unknown, column: Pick<TableColumn, 'type'>): string => column.type === 'number' && typeof value === 'number' ? numberFormatter.format(value) : tableText(value);
export const columnWidth = (width: number, minimum = 90) => Math.round(Math.max(minimum, Math.min(420, width)));
export function keyboardWidth(width: number, key: string, minimum = 90) {
  return key === 'Home' ? minimum : key === 'End' ? Math.max(minimum, 420) : columnWidth(width + (key === 'ArrowRight' ? 20 : -20), minimum);
}
export function reconcileOrder(order: string[], keys: string[]) {
  return [...order.filter(key => keys.includes(key)), ...keys.filter(key => !order.includes(key))];
}
export function moveColumn(order: string[], key: string, position: number) {
  const next = order.filter(value => value !== key);
  next.splice(Math.max(0, Math.min(next.length, position)), 0, key);
  return next;
}
export function cycleSort(sort: TableSort, key: string): TableSort {
  return sort?.key !== key ? { key, direction: 'ascending' } : sort.direction === 'ascending' ? { key, direction: 'descending' } : null;
}
export function tableIdentity(rows: unknown[], rowKey = 'id') {
  const sourceIds = rows.map(row => {
    const value = tableObject(row)[rowKey];
    return typeof value === 'string' && value.trim() || typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
  });
  const counts = new Map<string, number>();
  for (const id of sourceIds) if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
  // Reserve even duplicate source ids so fallback keys cannot steal ambiguous metadata.
  const reserved = new Set(counts.keys());
  const stable = sourceIds.every(id => id !== null && counts.get(id) === 1);
  const ids = sourceIds.map((id, index) => {
    if (id !== null && counts.get(id) === 1) return id;
    let fallback = String(index);
    while (reserved.has(fallback)) fallback = `index:${fallback}`;
    reserved.add(fallback); return fallback;
  });
  return { stable, ids, rowOrderKey: JSON.stringify(stable ? sourceIds : rows) };
}
const emptyValue = (value: unknown) => value == null || typeof value === 'string' && !value.trim()
  || typeof value === 'number' && Number.isNaN(value) || value instanceof Date && Number.isNaN(value.getTime());
// One type order keeps mixed comparisons transitive: number, string, date, boolean, object, other.
const valueType = (value: unknown) => typeof value === 'number' ? 0 : typeof value === 'string' ? 1 : value instanceof Date ? 2 : typeof value === 'boolean' ? 3 : typeof value === 'object' ? 4 : 5;
export function tableView(rows: unknown[], columns: TableColumn[], query: string, sort: TableSort) {
  const needle = query.trim().toLocaleLowerCase();
  const result = rows.map((row, index) => ({ item: tableObject(row), index })).filter(({ item }) => !needle || columns.some(column => tableText(item[column.key]).toLocaleLowerCase().includes(needle)));
  if (!sort) return result;
  return result.sort((a, b) => {
    const left = a.item[sort.key], right = b.item[sort.key];
    const leftEmpty = emptyValue(left), rightEmpty = emptyValue(right);
    if (leftEmpty || rightEmpty) return leftEmpty && rightEmpty ? a.index - b.index : leftEmpty ? 1 : -1;
    const compared = valueType(left) - valueType(right)
      || (typeof left === 'number' && typeof right === 'number' ? left - right
        : left instanceof Date && right instanceof Date ? left.getTime() - right.getTime()
        : typeof left === 'boolean' && typeof right === 'boolean' ? Number(left) - Number(right)
        : naturalOrder.compare(tableText(left), tableText(right)));
    return (sort.direction === 'ascending' ? compared : -compared) || a.index - b.index;
  });
}
