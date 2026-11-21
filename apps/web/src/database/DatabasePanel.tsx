import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, Copy, Database, MoreHorizontal, Play, RefreshCw, Square, Table2 } from 'lucide-react';
import { ActionMenu } from '../../../../packages/ui-shell/ActionMenu';
import { Popover } from '../../../../packages/ui-shell/Popover';
import { Select } from '../../../../packages/ui-shell/Select';
import { errorMessage } from '../../../../packages/ui-shell/format-utils';
import type { PanelBinding } from '../../../../packages/contracts/workspace.ts';
import type { DatabaseAttachmentV1, DatabaseConnectionV1, DatabaseQueryResultV1, DatabaseSchemaV1 } from '../../../../packages/contracts/database.ts';
import { cancelQuery, detachDatabase, fetchSchema, listThreadDatabases, runQuery } from '../database-api';
import { DatabaseAttachDialog } from './DatabaseAttachDialog';
import { recordSqlHistory, SqlEditor } from './SqlEditor';
import { SchemaTree } from './SchemaTree';
import { QueryResultGrid, rowsTsv } from './QueryResultGrid';
import { sendResultToChat } from './send-to-chat';
import './database-panel.css';
import './query-result-grid.css';

const LIMITS = [100, 500, 1000];

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
	const [filter, setFilter] = useState('');
	const [sql, setSql] = useState('');
	const [limit, setLimit] = useState(100);
	const [running, setRunning] = useState<string | null>(null);
	const [result, setResult] = useState<DatabaseQueryResultV1 | null>(null);
	const [queryError, setQueryError] = useState('');
	const [sentToChat, setSentToChat] = useState(false);
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
	const treePane = <>
		<input className="schema-filter" type="search" aria-label="Filter tables" placeholder="Filter tables" value={filter} onChange={event => setFilter(event.target.value)}/>
		{schemaLoading && <p className="schema-empty muted">Loading schema…</p>}
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
						{running && <div className="database-progress" aria-hidden="true"/>}
						{result
							? <QueryResultGrid result={result}/>
							: !running && <p className="database-empty muted">{sql.trim() ? 'Run the query to see results.' : 'Pick a table or write SQL to see results.'}</p>}
					</div>
					<div className="database-status">
						<span className="muted">{result ? `${result.rowCount} rows · ${result.elapsedMs} ms · limit ${limit}${result.truncated ? ' · ' : ''}` : ''}{result?.truncated ? <span className="database-truncated">truncated</span> : ''}</span>
						<span className="toolbar-spacer"/>
						{result && threadId && <button type="button" className="quiet" disabled={sentToChat} onClick={() => void sendResultToChat(threadId, result).then(() => setSentToChat(true)).catch(cause => setQueryError(errorMessage(cause, 'The result could not be quoted.')))}>{sentToChat ? 'Quoted in composer' : 'Send to chat'}</button>}
						{result && <button type="button" className="icon-button" aria-label="Copy rows as TSV" title="Copy rows as TSV" onClick={() => void navigator.clipboard?.writeText(rowsTsv(result))}><Copy size={14}/></button>}
					</div>
				</div>
			</div>}
		{threadId && <DatabaseAttachDialog open={attachOpen} threadId={threadId} onClose={() => setAttachOpen(false)} onAttached={() => load()}/>}
	</div>;
}
