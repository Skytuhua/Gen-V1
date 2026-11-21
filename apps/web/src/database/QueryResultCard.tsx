import { useState } from 'react';
import { Database, ExternalLink, Send } from 'lucide-react';
import { useStateStore, type ComponentRenderProps } from '@json-render/react';
import { INTERACTION_DATA_SCHEMAS, INTERACTION_SCHEMAS, boundedInteractionData, type QueryResultData } from '../../../../packages/ui-catalog/interactions.ts';
import type { DataRecord } from '../../../../packages/contracts/index.ts';
import type { DatabaseQueryResultV1 } from '../../../../packages/contracts/database.ts';
import { errorMessage } from '../../../../packages/ui-shell/format-utils';
import { QueryResultGrid, rowsTsv } from './QueryResultGrid';
import { sendResultToChat } from './send-to-chat';
import './query-result-grid.css';

const inputPath = (name: string) => `/inputs/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`;

const toGridResult = (data: QueryResultData): DatabaseQueryResultV1 => ({
	version: 1, engine: data.engine as DatabaseQueryResultV1['engine'], connectionLabel: data.connectionLabel,
	sqlSha256: data.sqlSha256 ?? '', columns: data.columns, rows: data.rows as DatabaseQueryResultV1['rows'],
	rowCount: data.rowCount, truncated: data.truncated ?? false, elapsedMs: data.elapsedMs, executedAt: data.executedAt,
});

/** In-thread card body shared by the catalog renderer and the latest-query card. */
export function QueryResultCardView({ result, threadId, onOpenPanel }: { result: DatabaseQueryResultV1; threadId?: string; onOpenPanel?: () => void }) {
	const [sent, setSent] = useState(false), [error, setError] = useState(''), [sqlOpen, setSqlOpen] = useState(false);
	const mini = { ...result, columns: result.columns.slice(0, 8), rows: result.rows.slice(0, 20).map(row => row.slice(0, 8)) };
	return <section className="query-result-card" aria-label={`Query result from ${result.connectionLabel}`}>
		<div className="query-result-card-head">
			<Database size={14}/><strong>{result.connectionLabel}</strong><span className="schema-type">{result.engine} · {result.rowCount} rows · executed {new Date(result.executedAt).toLocaleTimeString()}</span>
		</div>
		{result.sqlSha256 && <button type="button" className={`query-result-card-sql${sqlOpen ? ' expanded' : ''}`} aria-expanded={sqlOpen} title={`Statement digest ${result.sqlSha256}`} onClick={() => setSqlOpen(value => !value)}>Statement sha256 {result.sqlSha256}</button>}
		<QueryResultGrid result={mini}/>
		<div className="query-result-card-foot">
			<span>{result.rowCount} rows · {result.elapsedMs} ms{result.truncated ? ' · truncated' : ''}</span>
			<span className="toolbar-spacer"/>
			<button type="button" className="quiet" onClick={() => void navigator.clipboard?.writeText(rowsTsv(result))}>Copy TSV</button>
			{onOpenPanel && <button type="button" className="quiet" onClick={onOpenPanel}><ExternalLink size={12}/> Open in Database panel</button>}
			{threadId && <button type="button" className="quiet" disabled={sent} onClick={() => void sendResultToChat(threadId, result).then(() => setSent(true)).catch(cause => setError(errorMessage(cause, 'The result could not be quoted.')))}><Send size={12}/> {sent ? 'Quoted in composer' : 'Send to chat'}</button>}
		</div>
		{error && <p className="error-text" role="alert">{error}</p>}
	</section>;
}

/** Latest `database-query` DataRecord for a thread, validated against the contract shape. */
export function latestQueryRecord(data: readonly DataRecord[], threadId?: string): DatabaseQueryResultV1 | undefined {
	const record = data.filter(item => item.threadId === threadId && item.provenance === 'database-query')
		.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || b.revision - a.revision)[0];
	const value = record?.value as Partial<DatabaseQueryResultV1> | undefined;
	if (value?.version !== 1 || !Array.isArray(value.columns) || !Array.isArray(value.rows) || typeof value.rowCount !== 'number') return undefined;
	return value as DatabaseQueryResultV1;
}

/** Catalog renderer: bound data validated by the QueryResult schema. */
function QueryResult({ element: { props } }: ComponentRenderProps) {
	const store = useStateStore(), parsed = INTERACTION_SCHEMAS.QueryResult.parse(props);
	const raw = store.get(inputPath(parsed.dataBinding));
	const data = boundedInteractionData('QueryResult', raw) ? INTERACTION_DATA_SCHEMAS.QueryResult.safeParse(raw) : null;
	if (!data?.success) return <p className="interaction-unavailable" role="status">The query result is unavailable from the connected source.</p>;
	return <QueryResultCardView result={toGridResult(data.data)}/>;
}

export const QUERY_RESULT_REGISTRY = { QueryResult };
