import {sameLogicalOwner, type LogicalOwnerV1, type WorkbenchViewV1} from '../../../packages/contracts/source-selection';

export const MAX_MOUNTED_OUTPUT_ROWS = 300;
export interface WorkbenchOutputRow {readonly id: string; readonly text: string}
export type OutputScrollAnchor = NonNullable<WorkbenchViewV1['scrollAnchor']>;
export interface WorkbenchWindowOptions {scrollTop: number; viewportHeight: number; rowHeight: number; overscan?: number}

function geometry(options: WorkbenchWindowOptions) {
  if (![options.scrollTop, options.viewportHeight, options.rowHeight, options.overscan ?? 12].every(Number.isFinite) || options.rowHeight <= 0 || options.viewportHeight < 0 || (options.overscan ?? 12) < 0) throw Error('Invalid output window geometry.');
}

/** Slice a presentation window. The caller retains its complete immutable model. */
export function windowWorkbenchItems<T>(items: readonly T[], options: WorkbenchWindowOptions) {
  geometry(options);
  const {rowHeight, viewportHeight} = options, totalHeight = items.length * rowHeight;
  const scrollTop = Math.max(0, Math.min(options.scrollTop, Math.max(0, totalHeight - viewportHeight)));
  const first = Math.min(Math.floor(scrollTop / rowHeight), Math.max(0, items.length - 1));
  const visible = Math.min(MAX_MOUNTED_OUTPUT_ROWS, Math.ceil((viewportHeight + scrollTop % rowHeight) / rowHeight));
  const overscan = Math.min(Math.floor(options.overscan ?? 12), Math.floor((MAX_MOUNTED_OUTPUT_ROWS - visible) / 2));
  const start = Math.max(0, first - overscan), end = Math.min(items.length, first + visible + overscan, start + MAX_MOUNTED_OUTPUT_ROWS);
  return {start, end, items: items.slice(start, end), topSpacer: start * rowHeight, bottomSpacer: (items.length - end) * rowHeight, totalHeight};
}

export function captureOutputAnchor(rows: readonly Pick<WorkbenchOutputRow, 'id'>[], scrollTop: number, rowHeight: number): OutputScrollAnchor | null {
  geometry({scrollTop, viewportHeight: 0, rowHeight});
  if (!rows.length) return null;
  const top = Math.max(0, Math.min(scrollTop, rows.length * rowHeight - 1)), index = Math.floor(top / rowHeight);
  return {itemId: rows[index].id, offset: top - index * rowHeight};
}

export function restoreOutputAnchor(rows: readonly Pick<WorkbenchOutputRow, 'id'>[], anchor: OutputScrollAnchor | null | undefined, rowHeight: number, fallbackScrollTop = 0): number {
  geometry({scrollTop: fallbackScrollTop, viewportHeight: 0, rowHeight});
  const index = anchor ? rows.findIndex(row => row.id === anchor.itemId) : -1;
  if (index < 0 || !anchor || !Number.isFinite(anchor.offset)) return Math.max(0, Math.min(fallbackScrollTop, Math.max(0, rows.length * rowHeight - 1)));
  return index * rowHeight + Math.max(0, Math.min(anchor.offset, rowHeight - 1));
}

export interface WorkbenchOutputIdentity {logicalOwner: LogicalOwnerV1; sourceId: string; sourceRevision: string}
export interface AuthorizedOutputReadModel {
  identity: WorkbenchOutputIdentity;
  rows: readonly WorkbenchOutputRow[];
  complete: boolean;
  trailingNewline?: boolean;
}
/** This callback must use the authenticated host read path on every invocation.
 * Passing a full array from mounted DOM is never a substitute for that read. */
export type AuthorizedOutputReader = (signal: AbortSignal) => Promise<AuthorizedOutputReadModel>;
export const sameOutputIdentity = (a: WorkbenchOutputIdentity, b: WorkbenchOutputIdentity) => sameLogicalOwner(a.logicalOwner, b.logicalOwner) && a.sourceId === b.sourceId && a.sourceRevision === b.sourceRevision;

export async function readAuthorizedOutput(identity: WorkbenchOutputIdentity, read: AuthorizedOutputReader, signal = new AbortController().signal): Promise<AuthorizedOutputReadModel> {
  signal.throwIfAborted();
  const model = await read(signal);
  signal.throwIfAborted();
  if (!sameOutputIdentity(identity, model.identity)) throw Error('Output owner, identity or revision changed during the full read.');
  if (model.complete !== true) throw Error('The full result is incomplete. Copy and search require a complete authorized read.');
  const ids = new Set<string>();
  for (const row of model.rows) {
    if (!row.id || typeof row.text !== 'string' || ids.has(row.id)) throw Error('The full output has invalid or repeated logical row IDs.');
    ids.add(row.id);
  }
  return model;
}

export function fullOutputText(model: AuthorizedOutputReadModel): string {
  if (!model.complete) throw Error('A partial result cannot be copied as a full result.');
  return model.rows.map(row => row.text).join('\n') + (model.trailingNewline ? '\n' : '');
}

export interface OutputSearchMatch {itemId: string; index: number; offset: number}
export function searchOutputRows(model: AuthorizedOutputReadModel, query: string): OutputSearchMatch[] {
  if (!model.complete) throw Error('A partial result cannot be searched as a full result.');
  if (!query) return [];
  const needle = query.toLowerCase(), matches: OutputSearchMatch[] = [];
  model.rows.forEach((row, index) => {const offset = row.text.toLowerCase().indexOf(needle); if (offset >= 0) matches.push({itemId: row.id, index, offset});});
  return matches;
}
