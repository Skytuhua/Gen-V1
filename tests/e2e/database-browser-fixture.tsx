// T11: mounts the REAL DatabasePanel against a stubbed fetch backend so the
// attach -> query -> rows -> edit -> prepare flow is exercised in-browser.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/database/database-panel.css';
import '../../apps/web/src/database/query-result-grid.css';
import type { DatabaseQueryResultV1, DatabaseSchemaV1 } from '../../packages/contracts/database';
import type { DatabasePanel as DatabasePanelComponent } from '../../apps/web/src/database/DatabasePanel';

const params = new URLSearchParams(location.search);
const THREAD = '11111111-2222-3333-4444-555555555555';
const big = params.get('view') === 'perf';

const schema: DatabaseSchemaV1 = {
	version: 1, engine: 'sqlite', serverVersion: 'sqlite 3.45', truncated: false, digest: 'b'.repeat(64),
	schemas: [{ name: 'main', objects: [
		{ kind: 'table', name: 'orders', approxRows: 3, columns: [
			{ name: 'id', type: 'INTEGER', nullable: false, primaryKey: true },
			{ name: 'customer', type: 'TEXT' }, { name: 'total', type: 'REAL' },
		], foreignKeys: [], indexes: [] },
		{ kind: 'table', name: 'logs', approxRows: 9, columns: [{ name: 'message', type: 'TEXT' }], foreignKeys: [], indexes: [] },
	] }],
};
const orders: DatabaseQueryResultV1 = {
	version: 1, engine: 'sqlite', connectionLabel: 'shop · SQLite', sqlSha256: 'c'.repeat(64),
	columns: [{ name: 'id', type: 'INTEGER' }, { name: 'customer', type: 'TEXT' }, { name: 'total', type: 'REAL' }],
	rows: [[1, 'Ada', 42.5], [2, 'Ben', 9.0], [3, 'Cid', 100.25]],
	rowCount: 3, truncated: false, elapsedMs: 4, executedAt: '2026-11-21T16:00:00Z',
	source: { table: { schema: 'main', name: 'orders', primaryKey: ['id'] } },
};
const nopk: DatabaseQueryResultV1 = { ...orders, columns: [{ name: 'message', type: 'TEXT' }], rows: [['boot'], ['ok']], rowCount: 2, source: { table: { schema: 'main', name: 'logs', primaryKey: [] } } };
const perfRows: DatabaseQueryResultV1 = {
	...orders,
	columns: Array.from({ length: 20 }, (_, index) => ({ name: `c${index}`, type: 'TEXT' })),
	rows: Array.from({ length: 1000 }, (_, row) => Array.from({ length: 20 }, (_, col) => `r${row}c${col}`)),
	rowCount: 1000,
};
const writable = params.get('writable') !== '0';
const inventory = {
	connections: [{ id: 'conn-1', version: 1, label: 'shop', engine: 'sqlite', sqlite: { path: '/tmp/shop.sqlite', identity: { dev: '1', ino: '2' } }, createdAt: '', updatedAt: '' }],
	attachments: writable ? [{ id: 'att-1', version: 1, threadId: THREAD, connectionId: 'conn-1', writable: true, createdAt: '' }] : [],
};
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
const calls: string[] = [];
(window as unknown as { __calls: string[] }).__calls = calls;
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
	const url = String(typeof input === 'object' && 'url' in input ? input.url : input);
	const path = new URL(url, location.origin).pathname;
	calls.push(path);
	if (path === '/api/bootstrap') return json({ csrfToken: 'fixture' });
	if (path === `/api/threads/${THREAD}/databases`) return json(inventory);
	if (path.endsWith('/schema')) return json(schema);
	if (path.endsWith('/query')) return json({ requestId: 'r1', dataId: 'd1', result: params.get('nopk') ? nopk : big ? perfRows : orders });
	if (path.endsWith('/edits/prepare')) { (window as unknown as { __lastPrepare?: string }).__lastPrepare = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.clone().text() : undefined; return json({ operationId: 'op-1', kind: 'database.transaction', description: 'prepared' }); }
	return json({});
};

function Fixture() {
	const [Panel, setPanel] = useState<typeof DatabasePanelComponent | null>(null);
	useEffect(() => { void import('../../apps/web/src/database/DatabasePanel').then(module => setPanel(() => module.DatabasePanel)); }, []);
	document.documentElement.dataset.theme = params.get('theme') ?? 'dark';
	if (!Panel) return <main>loading</main>;
	return <main style={{ height: '100dvh' }}><Panel binding={{ authority: { kind: 'local' }, threadId: THREAD } as never}/></main>;
}
createRoot(document.getElementById('root') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'root' }))).render(<Fixture/>);
