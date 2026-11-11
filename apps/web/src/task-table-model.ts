export type TableColumn = { key: string; label: string };
export type TableSort = { key: string; direction: 'ascending' | 'descending' } | null;
export const tableObject = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const tableText = (value: unknown): string => value == null ? value === null ? 'NULL' : '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
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
  const ids = rows.map(row => tableObject(row)[rowKey]);
  const stable = ids.every(id => id != null) && new Set(ids.map(String)).size === ids.length;
  return { stable, ids: stable ? ids.map(String) : rows.map((_, index) => String(index)), rowOrderKey: JSON.stringify(stable ? ids.map(String) : rows) };
}
export function tableView(rows: unknown[], columns: TableColumn[], query: string, sort: TableSort) {
  const needle = query.trim().toLocaleLowerCase();
  const result = rows.map((row, index) => ({ item: tableObject(row), index })).filter(({ item }) => !needle || columns.some(column => tableText(item[column.key]).toLocaleLowerCase().includes(needle)));
  if (!sort) return result;
  return result.sort((a, b) => {
    const left = a.item[sort.key], right = b.item[sort.key];
    if (left == null || right == null) return left == null && right == null ? a.index - b.index : left == null ? 1 : -1;
    const compared = typeof left === 'number' && typeof right === 'number' ? left - right
      : typeof left === 'boolean' && typeof right === 'boolean' ? Number(left) - Number(right)
      : tableText(left).localeCompare(tableText(right));
    return (sort.direction === 'ascending' ? compared : -compared) || a.index - b.index;
  });
}
