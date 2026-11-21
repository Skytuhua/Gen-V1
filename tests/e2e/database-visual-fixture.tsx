import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SchemaTree } from '../../apps/web/src/database/SchemaTree';
import { QueryResultGrid, QueryResultSkeleton } from '../../apps/web/src/database/QueryResultGrid';
import { QueryResultCardView } from '../../apps/web/src/database/QueryResultCard';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/database/database-panel.css';
import '../../apps/web/src/database/query-result-grid.css';
import type { DatabaseQueryResultV1, DatabaseSchemaV1 } from '../../packages/contracts/database';

const schema: DatabaseSchemaV1 = {
	version: 1, engine: 'postgres', serverVersion: '16.2', truncated: false, digest: 'a'.repeat(64),
	schemas: [{ name: 'public', objects: [
		{ kind: 'table', name: 'orders', approxRows: 1280, columns: [
			{ name: 'id', type: 'int4', nullable: false, primaryKey: true },
			{ name: 'customer_id', type: 'int4', nullable: false },
			{ name: 'total', type: 'numeric' },
			{ name: 'created_at', type: 'timestamptz' },
		], foreignKeys: [{ columns: ['customer_id'], references: { schema: 'public', table: 'customers', columns: ['id'] } }], indexes: [{ name: 'orders_created_idx', columns: ['created_at'], unique: false }] },
		{ kind: 'table', name: 'customers', approxRows: 640, columns: [{ name: 'id', type: 'int4', primaryKey: true }, { name: 'email', type: 'text' }], foreignKeys: [], indexes: [] },
		{ kind: 'view', name: 'audit', approxRows: null, columns: [{ name: 'actor', type: 'text' }], foreignKeys: [], indexes: [] },
	] }],
};
const result: DatabaseQueryResultV1 = {
	version: 1, engine: 'postgres', connectionLabel: 'shop-dev · PostgreSQL', sqlSha256: 'd3adb33f'.repeat(8),
	columns: [{ name: 'id', type: 'int4' }, { name: 'customer_id', type: 'int4' }, { name: 'total', type: 'numeric' }, { name: 'status', type: 'text' }, { name: 'created_at', type: 'timestamptz' }],
	rows: Array.from({ length: 60 }, (_, index) => [100 + index, 7, 12.5 + index, index % 3 ? 'paid' : null, `2026-11-${String(index % 28 + 1).padStart(2, '0')}T09:00:00Z`]),
	rowCount: 60, truncated: true, truncatedReason: 'limit', elapsedMs: 34, executedAt: '2026-11-21T15:00:00Z',
};

function Fixture() {
	const params = new URLSearchParams(location.search), view = params.get('view') ?? 'panel';
	const density = params.get('density') ?? 'comfortable';
	document.documentElement.dataset.density = density;
	document.documentElement.dataset.theme = params.get('theme') ?? 'dark';
	const [selected, setSelected] = useState('');
	if (view === 'tree') return <main className="database-panel"><div className="database-body"><div className="schema-pane" style={{ width: 240 }}>
		<input className="schema-filter" type="search" aria-label="Filter tables" placeholder="Filter tables" defaultValue={params.get('filter') ?? ''}/>
		<div className="schema-tree"><SchemaTree schema={schema} filter={params.get('filter') ?? ''} selected={selected} onSelect={(s, n) => setSelected(`${s}.${n}`)}/></div>
	</div></div></main>;
	if (view === 'grid') return <main style={{ height: '100dvh', display: 'flex' }}><QueryResultGrid result={result} density={density as 'compact' | 'comfortable' | 'touch'}/></main>;
	if (view === 'grid-empty') return <main style={{ height: '100dvh', display: 'flex' }}><QueryResultGrid result={{ ...result, rows: [], rowCount: 0, truncated: false }}/></main>;
	if (view === 'grid-draft') return <main style={{ height: '100dvh', display: 'flex' }}><QueryResultGrid result={result} readOnlyColumns={new Set([0])} draft={{ edits: { '0:2': '99.00' }, onEdit: () => {} }}/></main>;
	if (view === 'skeleton') return <main className="database-panel"><div className="database-body"><div className="schema-pane" style={{ width: 240 }}>
		<div className="schema-tree">{Array.from({ length: 6 }, (_, index) => <div key={index} className="schema-skeleton"/>)}</div>
	</div><div className="database-main"><QueryResultSkeleton/></div></div></main>;
	if (view === 'card') return <main style={{ padding: 16 }}><QueryResultCardView result={result} threadId="t-fixture" onOpenPanel={() => {}}/></main>;
	if (view === 'empty') return <main className="database-panel"><div className="database-empty">
		<p>Attach a database to this thread</p>
		<button type="button" className="primary">Attach database</button>
		<button type="button" className="quiet" disabled>Add a connection in Settings</button>
	</div></main>;
	if (view === 'error') return <main style={{ padding: 16 }}><div className="database-error" role="alert"><span>!</span><code>syntax error at or near "FROM" (line 2, column 14)</code><button type="button" className="quiet">Retry</button></div></main>;
	return <main>unknown view</main>;
}

createRoot(document.getElementById('root') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'root' }))).render(<Fixture/>);
