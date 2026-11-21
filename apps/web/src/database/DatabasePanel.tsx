import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, Copy, Database, MoreHorizontal, Play, RefreshCw, Square, Table2, PencilLine } from 'lucide-react';
import { ActionMenu } from '../../../../packages/ui-shell/ActionMenu';
import { Popover } from '../../../../packages/ui-shell/Popover';
import { Select } from '../../../../packages/ui-shell/Select';
import { errorMessage } from '../../../../packages/ui-shell/format-utils';
import type { PanelBinding } from '../../../../packages/contracts/workspace.ts';
import type { DatabaseAttachmentV1, DatabaseConnectionV1, DatabaseQueryResultV1, DatabaseSchemaV1 } from '../../../../packages/contracts/database.ts';
import { cancelQuery, detachDatabase, fetchSchema, listThreadDatabases, prepareEdits, runQuery } from '../database-api';
import { DatabaseAttachDialog } from './DatabaseAttachDialog';
import { recordSqlHistory, SqlEditor } from './SqlEditor';
import { SchemaTree } from './SchemaTree';
import { QueryResultGrid, QueryResultSkeleton, rowsTsv, type GridDensity } from './QueryResultGrid';
import { sendResultToChat } from './send-to-chat';
import './database-panel.css';
import './query-result-grid.css';

const LIMITS = [100, 500, 1000];

const readDensity = (): GridDensity => { const value = document.documentElement.dataset.density; return value === 'compact' || value === 'touch' ? value : 'comfortable'; };
const useDensity = (): GridDensity => {
	const [density, setDensity] = useState<GridDensity>(readDensity);
	useEffect(() => {
		const observer = new MutationObserver(() => setDensity(readDensity()));
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-density'] });
		return () => observer.disconnect();
	}, []);
	return density;
};
const useDelayed = (active: boolean) => {
	const [slow, setSlow] = useState(false);
	useEffect(() => { setSlow(false); if (!active) return; const timer = setTimeout(() => setSlow(true), 150); return () => clearTimeout(timer); }, [active]);
	return slow;
};

export function DatabasePanel({ binding }: { binding: PanelBinding }) {
	const threadId = binding.threadId;
	const [connections, setConnections] = useState<DatabaseConnectionV1[]>([]);
	const [attachments, setAttachments] = useState<DatabaseAttachmentV1[]>([]);
	const [attachmentId, setAttachmentId] = useState('');
	const [loadError, setLoadError] = useState('');
	const [attachOpen, setAttachOpen] = useState(false);
	const [schema, setSchema] = useState<DatabaseSchemaV1 | null>(null);
	const [schemaError, setSchemaError] = useState('');
	const [schemaLoading, setSchemaLoading] = useState(false);
	const density = useDensity();
	const [filter, setFilter] = useState('');
	const [sql, setSql] = useState('');
	const [limit, setLimit] = useState(100);
	const [running, setRunning] = useState<string | null>(null);
	const [result, setResult] = useState<DatabaseQueryResultV1 | null>(null);
	const [queryError, setQueryError] = useState('');
	const [sentToChat, setSentToChat] = useState(false);
	const [editing, setEditing] = useState(false);
	const [edits, setEdits] = useState<Record<string, string>>({});
	const [editBusy, setEditBusy] = useState(false);
	const [editNote, setEditNote] = useState('');
	const [selectedObject, setSelectedObject] = useState('');
	const [narrow, setNarrow] = useState(false);
	const [treeOpen, setTreeOpen] = useState(false);
	const [menu, setMenu] = useState(false);
	const [schemaWidth, setSchemaWidth] = useState(240);
	const root = useRef<HTMLDivElement>(null);
	const treeToggle = useRef<HTMLButtonElement>(null);
	const drag = useRef(false);

	const load = useCallback(() => {
		if (!threadId) return;
		listThreadDatabases(threadId).then(inventory => {
			setConnections(inventory.connections); setAttachments(inventory.attachments); setLoadError('');
			setAttachmentId(current => inventory.attachments.some(row => row.id === current) ? current : (inventory.attachments[0]?.id ?? ''));
		}).catch(cause => setLoadError(errorMessage(cause, 'Databases could not load.')));
	}, [threadId]);
	useEffect(load, [load]);

	const attachment = attachments.find(row => row.id === attachmentId);
	useEffect(() => { setEdits({}); setEditing(false); setEditNote(''); }, [attachmentId, result]);
	const connection = connections.find(row => row.id === attachment?.connectionId);
	const refreshSchema = useCallback((bypass = false) => {
		if (!threadId || !attachmentId) { setSchema(null); return; }
		setSchemaLoading(true); setSchemaError('');
		fetchSchema(threadId, attachmentId, bypass)
			.then(setSchema)
			.catch(cause => { setSchema(null); setSchemaError(errorMessage(cause, 'The schema could not load.')); })
			.finally(() => setSchemaLoading(false));
	}, [threadId, attachmentId]);
	useEffect(() => { setResult(null); setQueryError(''); refreshSchema(false); }, [refreshSchema]);
	useEffect(() => {
		const element = root.current;
		if (!element) return;
		const observer = new ResizeObserver(entries => setNarrow((entries[0]?.contentRect.width ?? 0) < 560));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	const completions = useMemo(() => !schema ? [] : schema.schemas.flatMap(entry => entry.objects.flatMap(object => [object.name, `${entry.name}.${object.name}`, ...object.columns.map(column => column.name)])), [schema]);
	const run = useCallback(() => {
		if (!threadId || !attachmentId || running || !sql.trim()) return;
		const requestId = crypto.randomUUID();
		setRunning(requestId); setQueryError('');
		if (connection) recordSqlHistory(connection.id, sql);
		runQuery(threadId, attachmentId, sql, limit, requestId)
			.then(response => { setResult(response.result); setSentToChat(false); })
			.catch(cause => setQueryError(errorMessage(cause, 'The query could not run.')))
			.finally(() => setRunning(null));
	}, [threadId, attachmentId, running, sql, limit, connection]);
	const cancel = useCallback(() => {
		if (threadId && attachmentId && running) void cancelQuery(threadId, attachmentId, running).catch(() => {});
	}, [threadId, attachmentId, running]);

	// T10: grid edits are allowed when the attachment is writable and the
	// result carries a proven single-table source with primary key columns.
	const editTarget = useMemo(() => {
		if (!attachment?.writable || !result) return { editable: false as const, reason: 'This attachment is read only.' };
		const table = result.source?.table;
		if (!table) return { editable: false as const, reason: 'Editing works on a single SELECT over one table.' };
		const pk = table.primaryKey ?? [];
		if (!pk.length) return { editable: false as const, reason: 'Editing needs a primary key' };
		const pkIndex = pk.map(name => result.columns.findIndex(column => column.name === name));
		if (pkIndex.some(index => index < 0)) return { editable: false as const, reason: 'Editing needs the primary key columns in the result.' };
		return { editable: true as const, schemaName: table.schema ?? 'main', table: table.name, pk, pkIndex };
	}, [attachment, result]);
	const draft = editing && editTarget.editable ? { edits, onEdit: (rowIndex: number, columnIndex: number, value: string) => setEdits(current => ({ ...current, [`${rowIndex}:${columnIndex}`]: value })) } : undefined;
	const readOnlyColumns = draft && editTarget.editable ? new Set(editTarget.pkIndex) : undefined;
	const editCount = Object.keys(edits).length;
	const reviewChanges = useCallback(() => {
		if (!threadId || !attachmentId || !result || !editTarget.editable || !editCount) return;
		setEditBusy(true); setEditNote('');
		// R10: one parameterized UPDATE per edited row.
		const byRow = new Map<number, { columnIndex: number; value: string }[]>();
		for (const [key, value] of Object.entries(edits)) {
			const [rowIndex, columnIndex] = key.split(':').map(Number);
			byRow.set(rowIndex!, [...(byRow.get(rowIndex!) ?? []), { columnIndex: columnIndex!, value }]);
		}
		const statements = [...byRow.entries()].map(([rowIndex, cells]) => {
			const pk = editTarget.pkIndex.map((_, position) => `"${editTarget.pk[position]}"=?`).join(' AND ');
			const set = cells.map(({ columnIndex }) => `"${result.columns[columnIndex]!.name}"=?`).join(', ');
			return { sql: `UPDATE "${editTarget.schemaName}"."${editTarget.table}" SET ${set} WHERE ${pk}`, params: [...cells.map(cell => cell.value), ...editTarget.pkIndex.map(index => result.rows[rowIndex]![index]!)], expectedChanges: 1 };
		});
		prepareEdits(threadId, attachmentId, statements)
			.then(() => { setEdits({}); setEditing(false); setEditNote('Prepared for approval in the conversation.'); })
			.catch(cause => setQueryError(errorMessage(cause, 'The changes could not be prepared.')))
			.finally(() => setEditBusy(false));
	}, [threadId, attachmentId, result, editTarget, edits, editCount]);

	const pickObject = useCallback((schemaName: string, name: string) => {
		setSelectedObject(`${schemaName}.${name}`);
		setSql(`SELECT * FROM "${schemaName}"."${name}" LIMIT ${limit}`);
	}, [limit]);

	const dividerDown = (event: React.PointerEvent) => {
		drag.current = true;
		const startX = event.clientX, startWidth = schemaWidth;
		const move = (moveEvent: PointerEvent) => { if (drag.current) setSchemaWidth(Math.min(360, Math.max(200, startWidth + moveEvent.clientX - startX))); };
		const up = () => { drag.current = false; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
		window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
	};

	const tree = schema ? <SchemaTree schema={schema} filter={filter} selected={selectedObject} onSelect={(schemaName, name) => { pickObject(schemaName, name); setTreeOpen(false); }}/> : null;
	const slowSchema = useDelayed(schemaLoading), slowRun = useDelayed(Boolean(running));
	const treePane = <>
		<input className="schema-filter" type="search" aria-label="Filter tables" placeholder="Filter tables" value={filter} onChange={event => setFilter(event.target.value)}/>
		{schemaLoading && (slowSchema ? <div className="schema-tree" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <div key={index} className="schema-skeleton"/>)}</div> : <p className="schema-empty muted">Loading schema…</p>)}
		{schemaError && <p className="error-text" role="alert">{schemaError} <button type="button" className="quiet" onClick={() => refreshSchema(true)}>Retry</button></p>}
		{tree}
	</>;

	return <div className="database-panel" ref={root}>
		<div className="panel-toolbar">
			<Database size={16}/>
			<Select aria-label="Attached connection" value={attachmentId} onValueChange={setAttachmentId}
				options={attachments.map(row => ({ value: row.id, label: connections.find(connection => connection.id === row.connectionId)?.label ?? 'Connection' }))}/>
			{attachment && <span className={`database-access-badge${attachment.writable ? ' writable' : ''}`}>{attachment.writable ? 'Changes need approval' : 'Read only'}</span>}
			<span className="toolbar-spacer"/>
			<button type="button" className="icon-button" aria-label="Refresh schema" title="Refresh schema" disabled={!attachmentId || schemaLoading} onClick={() => refreshSchema(true)}><RefreshCw size={15}/></button>
			<ActionMenu label="Database panel actions" iconOnly icon={<MoreHorizontal size={16}/>} open={menu} onOpenChange={setMenu} disabled={!attachment} items={attachment ? [
				{ id: 'detach', label: 'Detach', onSelect: () => void (async () => { if (!threadId) return; try { await detachDatabase(threadId, attachment.id); setAttachmentId(''); load(); } catch (cause) { setQueryError(errorMessage(cause, 'The database could not be detached.')); } })() },
				{ id: 'copy', label: 'Copy connection label', onSelect: () => void navigator.clipboard?.writeText(connection?.label ?? '') },
			] : []}/>
		</div>
		{!threadId || attachments.length === 0
			? <div className="database-empty">
				<p>{threadId ? 'Attach a database to this thread' : 'Open this panel inside a conversation to attach a database.'}</p>
				{threadId && <button type="button" className="primary" onClick={() => setAttachOpen(true)}>Attach database</button>}
				<button type="button" className="quiet" disabled>Add a connection in Settings</button>
				{loadError && <p className="error-text" role="alert">{loadError}</p>}
			</div>
			: <div className="database-body">
				{narrow
					? <>
						<button type="button" ref={treeToggle} className="quiet database-tree-toggle" aria-expanded={treeOpen} onClick={() => setTreeOpen(value => !value)}><Table2 size={14}/> Tables</button>
						<Popover anchor={treeToggle} open={treeOpen} width={260} height={320} preferredSide="below" align="start" onDismiss={() => setTreeOpen(false)} className="database-tree-popover">{treePane}</Popover>
					</>
					: <div className="schema-pane" style={{ width: schemaWidth }}>{treePane}</div>}
				{!narrow && <div className="schema-divider" role="separator" aria-orientation="vertical" onPointerDown={dividerDown}/>}
				<div className="database-main">
					<SqlEditor value={sql} onChange={setSql} onRun={run} completions={completions} historyKey={connection?.id} disabled={!attachmentId}/>
					<div className="database-runbar">
						<Select aria-label="Row limit" value={String(limit)} onValueChange={value => setLimit(Number(value))} options={LIMITS.map(value => ({ value: String(value), label: `Limit ${value.toLocaleString()}` }))}/>
						{running
							? <button type="button" className="secondary database-run" onClick={cancel}><Square size={14}/> Cancel</button>
							: <button type="button" className="primary database-run" onClick={run} disabled={!sql.trim() || !attachmentId} title="Ctrl+Enter"><Play size={14}/> Run</button>}
					</div>
					{queryError && <div className="database-error" role="alert"><CircleAlert size={15}/><code>{queryError}</code><button type="button" className="quiet" onClick={run}>Retry</button></div>}
					<div className="database-results">
						{running && <><div className="database-progress" aria-hidden="true"/><span className="database-running-static" role="status">Running…</span></>}
						{result
							? <QueryResultGrid result={result} density={density} draft={draft} readOnlyColumns={readOnlyColumns}/>
							: running && slowRun ? <QueryResultSkeleton/> : !running && <p className="database-empty muted">{sql.trim() ? 'Run the query to see results.' : 'Pick a table or write SQL to see results.'}</p>}
					</div>
					<div className="database-status">
						<span className="muted">{result ? `${result.rowCount} rows · ${result.elapsedMs} ms · limit ${limit}${result.truncated ? ' · ' : ''}` : ''}{result?.truncated ? <span className="database-truncated">truncated</span> : ''}{editNote && <span className="muted"> · {editNote}</span>}</span>
						{result && attachment?.writable && <button type="button" className={editing ? 'secondary' : 'quiet'} disabled={!editTarget.editable && !editing} title={editTarget.editable ? 'Edit result cells' : editTarget.reason} aria-pressed={editing} onClick={() => { setEditing(value => !value); if (editing) setEdits({}); }}><PencilLine size={14}/> Edit</button>}
						{editCount > 0 && <>
							<button type="button" className="quiet" disabled={editBusy} onClick={() => setEdits({})}>Discard</button>
							<button type="button" className="primary" disabled={editBusy} onClick={reviewChanges}>{editBusy ? 'Preparing…' : `Review changes (${editCount})`}</button>
						</>}
						<span className="toolbar-spacer"/>
						{result && threadId && <button type="button" className="quiet" disabled={sentToChat} onClick={() => void sendResultToChat(threadId, result).then(() => setSentToChat(true)).catch(cause => setQueryError(errorMessage(cause, 'The result could not be quoted.')))}>{sentToChat ? 'Quoted in composer' : 'Send to chat'}</button>}
						{result && <button type="button" className="icon-button" aria-label="Copy rows as TSV" title="Copy rows as TSV" onClick={() => void navigator.clipboard?.writeText(rowsTsv(result))}><Copy size={14}/></button>}
					</div>
				</div>
			</div>}
		{threadId && <DatabaseAttachDialog open={attachOpen} threadId={threadId} onClose={() => setAttachOpen(false)} onAttached={() => load()}/>}
	</div>;
}
