import { useCallback, useRef, useState } from 'react';
import type { DatabaseQueryResultV1 } from '../../../../packages/contracts/database.ts';

export type ResultCell = DatabaseQueryResultV1['rows'][number][number];

export const formatBytes = (length: number) => length >= 1024 ? `${(length / 1024).toFixed(1)} KB` : `${length} B`;
export const cellText = (cell: ResultCell) =>
	cell === null ? 'NULL' : typeof cell === 'object' ? (cell.kind === 'bytes' ? `<bytes ${formatBytes(cell.length)}>` : cell.preview) : String(cell);
export const rowsTsv = (result: Pick<DatabaseQueryResultV1, 'columns' | 'rows'>) =>
	[result.columns.map(column => column.name).join('\t'), ...result.rows.map(row => row.map(cellText).join('\t'))].join('\n');

const ROW_HEIGHT = 32, HEADER_HEIGHT = 32, GUTTER = 44, DEFAULT_COL_WIDTH = 160, MIN_COL_WIDTH = 64, OVERSCAN = 10, COLUMN_VIRTUALIZE_AT = 30;

export interface ResultDraft { edits: Record<string, string>; onEdit(rowIndex: number, columnIndex: number, value: string): void }

/** Virtualized results grid shared by the Database panel and the in-thread card.
 * Renders only visible rows + overscan; columns above 30 are windowed too.
 * `draft` is the T10 edit-mode seam: keyed `row:column` draft text, edited inline. */
export function QueryResultGrid({ result, draft, labelledBy, height }: { result: DatabaseQueryResultV1; draft?: ResultDraft; labelledBy?: string; height?: number }) {
	const scroll = useRef<HTMLDivElement>(null);
	const [top, setTop] = useState(0), [left, setLeft] = useState(0), [viewH, setViewH] = useState(320), [viewW, setViewW] = useState(640);
	const [widths, setWidths] = useState<Record<number, number>>({});
	const measured = useRef(false);

	const colWidth = (index: number) => widths[index] ?? DEFAULT_COL_WIDTH;
	const rows = result.rows;
	const totalH = rows.length * ROW_HEIGHT;
	const start = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
	const end = Math.min(rows.length, Math.ceil((top + viewH) / ROW_HEIGHT) + OVERSCAN);
	const virtualCols = result.columns.length > COLUMN_VIRTUALIZE_AT;
	const offsets = useCallback((until: number) => { let sum = 0; for (let index = 0; index < until; index++) sum += colWidth(index); return sum; }, [widths]); // eslint-disable-line react-hooks/exhaustive-deps
	const totalW = offsets(result.columns.length);
	const colStart = virtualCols ? Math.max(0, result.columns.findIndex((_, index) => offsets(index + 1) > left) - 4) : 0;
	const firstPast = virtualCols ? result.columns.findIndex((_, index) => offsets(index) > left + viewW) : -1;
	const colEnd = virtualCols ? (firstPast < 0 ? result.columns.length : Math.min(result.columns.length, firstPast + 4)) : result.columns.length;

	const resize = (index: number) => (event: React.PointerEvent) => {
		event.preventDefault(); event.stopPropagation();
		const startX = event.clientX, startWidth = colWidth(index);
		const move = (moveEvent: PointerEvent) => setWidths(current => ({ ...current, [index]: Math.max(MIN_COL_WIDTH, startWidth + moveEvent.clientX - startX) }));
		const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
		window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
	};

	return <div className="query-result-grid" style={height ? { height } : undefined}>
		<div className="query-result-scroll" role="grid" aria-labelledby={labelledBy} aria-rowcount={rows.length + 1} aria-colcount={result.columns.length + 1}
			onScroll={event => { const element = event.currentTarget; setTop(element.scrollTop); setLeft(element.scrollLeft); setViewH(element.clientHeight); setViewW(element.clientWidth); }}
			ref={node => { scroll.current = node; if (node && !measured.current) { measured.current = true; setViewH(node.clientHeight || 320); setViewW(node.clientWidth || 640); } }}>
			<div style={{ height: totalH + HEADER_HEIGHT, width: GUTTER + totalW, position: 'relative' }}>
				<div className="query-result-header" role="row" aria-rowindex={1} style={{ width: GUTTER + totalW }}>
					{result.columns.map((column, index) => index >= colStart && index < colEnd
						? <span key={index} role="columnheader" aria-colindex={index + 2} className="query-result-th" style={{ width: colWidth(index), left: GUTTER + offsets(index) }}>
							<span className="query-result-th-label" title={`${column.name} · ${column.type}`}>{column.name} <span className="schema-type">{column.type}</span></span>
							<span className="query-result-col-resize" role="separator" aria-orientation="vertical" aria-label={`Resize ${column.name}`} onPointerDown={resize(index)}/>
						</span>
						: null)}
					<span className="row-number" role="columnheader" aria-colindex={1} style={{ width: GUTTER }}>#</span>
				</div>
				{rows.slice(start, end).map((row, offset) => {
					const rowIndex = start + offset;
					return <div key={rowIndex} role="row" aria-rowindex={rowIndex + 2} className="query-result-tr" style={{ top: HEADER_HEIGHT + rowIndex * ROW_HEIGHT, width: GUTTER + totalW }}>
						{row.map((cell, columnIndex) => columnIndex >= colStart && columnIndex < colEnd
							? <ResultCellView key={columnIndex} cell={cell} rowIndex={rowIndex} columnIndex={columnIndex} draft={draft} style={{ width: colWidth(columnIndex), left: GUTTER + offsets(columnIndex) }}/>
							: null)}
						<span className="row-number" role="rowheader" aria-colindex={1} style={{ width: GUTTER }}>{rowIndex + 1}</span>
					</div>;
				})}
			</div>
		</div>
		{rows.length === 0 && <p className="database-empty muted">No rows</p>}
	</div>;
}

function ResultCellView({ cell, rowIndex, columnIndex, draft, style }: { cell: ResultCell; rowIndex: number; columnIndex: number; draft?: ResultDraft; style: React.CSSProperties }) {
	const text = cellText(cell), key = `${rowIndex}:${columnIndex}`, edited = draft && Object.hasOwn(draft.edits, key);
	if (draft && edited !== undefined && Object.hasOwn(draft.edits, key))
		return <span role="gridcell" aria-colindex={columnIndex + 2} className="query-result-td editing" style={style}><input aria-label={`Edit row ${rowIndex + 1} column ${columnIndex + 1}`} value={draft.edits[key]} onChange={event => draft.onEdit(rowIndex, columnIndex, event.target.value)}/></span>;
	return <span role="gridcell" aria-colindex={columnIndex + 2} className={`query-result-td ${typeof cell === 'number' ? 'numeric' : ''} ${cell === null ? 'null-cell' : ''} ${edited ? 'edited' : ''}`} style={style} title={text.length > 60 ? text : undefined}>
		{draft && cell !== null ? <button type="button" className="query-result-cell-button" onClick={() => draft.onEdit(rowIndex, columnIndex, text)}>{text}</button> : (cell === null ? <em>NULL</em> : text)}
	</span>;
}
