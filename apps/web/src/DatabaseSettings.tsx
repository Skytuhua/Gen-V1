import { useEffect, useMemo, useState } from 'react';
import { CircleCheck, Database, Plus } from 'lucide-react';
import { ActionMenu } from '../../../packages/ui-shell/ActionMenu';
import { Modal } from '../../../packages/ui-shell/Modal';
import { Select } from '../../../packages/ui-shell/Select';
import { errorMessage } from '../../../packages/ui-shell/format-utils';
import type { DatabaseAttachmentV1, DatabaseConnectionV1, DatabaseEngine, DatabaseTls } from '../../../packages/contracts/database.ts';
import { createConnection, deleteConnection, listDatabases, testConnection, updateConnection, type ConnectionInput } from './database-api';
import './database-settings.css';

const ENGINES: { value: DatabaseEngine; label: string }[] = [
	{ value: 'sqlite', label: 'SQLite' },
	{ value: 'postgres', label: 'PostgreSQL' },
	{ value: 'mysql', label: 'MySQL' },
];
const TLS_OPTIONS: { value: DatabaseTls; label: string }[] = [
	{ value: 'disable', label: 'Disable' },
	{ value: 'prefer', label: 'Prefer' },
	{ value: 'require', label: 'Require' },
	{ value: 'verify-full', label: 'Verify full' },
];
const engineLabel = (engine: DatabaseEngine) => ENGINES.find(entry => entry.value === engine)?.label ?? engine;
const defaultTls = (host: string): DatabaseTls => /^(localhost|127\.0\.0\.1|::1)$/.test(host.trim()) ? 'prefer' : 'require';
const endpoint = (connection: DatabaseConnectionV1) =>
	connection.engine === 'sqlite'
		? (connection.sqlite?.path.split(/[\\/]/).pop() ?? connection.sqlite?.path ?? '')
		: `${connection.network?.host ?? ''}/${connection.network?.database ?? ''}`;

interface Draft {
	engine: DatabaseEngine; label: string; path: string;
	host: string; port: string; database: string; user: string; tls: DatabaseTls; password: string;
}
const blankDraft = (): Draft => ({ engine: 'sqlite', label: '', path: '', host: '', port: '', database: '', user: '', tls: 'prefer', password: '' });
const draftOf = (connection?: DatabaseConnectionV1): Draft => !connection ? blankDraft() : {
	engine: connection.engine, label: connection.label,
	path: connection.sqlite?.path ?? '',
	host: connection.network?.host ?? '', port: connection.network ? String(connection.network.port) : '',
	database: connection.network?.database ?? '', user: connection.network?.user ?? '',
	tls: connection.network?.tls ?? 'prefer', password: '',
};
const toInput = (draft: Draft): ConnectionInput => {
	if (draft.engine === 'sqlite') return { label: draft.label.trim(), engine: 'sqlite', sqlite: { path: draft.path.trim() } };
	const network = { host: draft.host.trim(), port: Number(draft.port) || (draft.engine === 'postgres' ? 5432 : 3306), database: draft.database.trim(), user: draft.user.trim(), tls: draft.tls, ...(draft.password ? { password: draft.password } : {}) };
	return { label: draft.label.trim(), engine: draft.engine, network };
};
const validDraft = (draft: Draft, editing?: DatabaseConnectionV1) =>
	draft.label.trim().length > 0 && (draft.engine === 'sqlite'
		? draft.path.trim().length > 0
		: draft.host.trim().length > 0 && draft.database.trim().length > 0 && draft.user.trim().length > 0 && (draft.password.length > 0 || Boolean(editing)));

export function DatabaseSettings({ query = '' }: { query?: string }) {
	const [available, setAvailable] = useState<boolean | null>(null);
	const [connections, setConnections] = useState<DatabaseConnectionV1[]>([]);
	const [attachments, setAttachments] = useState<DatabaseAttachmentV1[]>([]);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [dialog, setDialog] = useState<{ open: boolean; editing?: DatabaseConnectionV1; draft: Draft; tlsTouched?: boolean }>({ open: false, draft: blankDraft() });
	const [test, setTest] = useState<{ state: 'idle' | 'running' | 'ok' | 'error'; text: string }>({ state: 'idle', text: '' });
	const [removing, setRemoving] = useState<DatabaseConnectionV1 | undefined>();
	const [menu, setMenu] = useState<string | null>(null);

	const load = () => listDatabases()
		.then(value => { setAvailable(value.available); setConnections(value.connections); setAttachments(value.attachments); })
		.catch(cause => { setAvailable(false); setError(errorMessage(cause, 'Database connections could not load.')); });
	useEffect(() => { void load(); }, []);

	const usedBy = useMemo(() => {
		const counts = new Map<string, Set<string>>();
		for (const attachment of attachments) {
			const set = counts.get(attachment.connectionId) ?? new Set<string>();
			set.add(attachment.threadId); counts.set(attachment.connectionId, set);
		}
		return counts;
	}, [attachments]);
	const openDialog = (editing?: DatabaseConnectionV1) => { setTest({ state: 'idle', text: '' }); setDialog({ open: true, editing, draft: draftOf(editing) }); };
	const setDraft = (patch: Partial<Draft>) => setDialog(state => ({ ...state, draft: { ...state.draft, ...patch } }));

	const runTest = () => {
		if (!validDraft(dialog.draft, dialog.editing)) return;
		const started = Date.now();
		setTest({ state: 'running', text: 'Testing…' });
		void testConnection(toInput(dialog.draft))
			.then(result => setTest({ state: 'ok', text: `Connected${result.serverVersion ? ` · ${result.serverVersion}` : ''} · ${Date.now() - started} ms` }))
			.catch(cause => setTest({ state: 'error', text: errorMessage(cause, 'Connection failed.') }));
	};
	const save = () => {
		if (!validDraft(dialog.draft, dialog.editing)) return;
		setBusy(true); setError('');
		const action = dialog.editing ? updateConnection(dialog.editing.id, toInput(dialog.draft)) : createConnection(toInput(dialog.draft));
		void action.then(() => { setDialog(state => ({ ...state, open: false })); void load(); })
			.catch(cause => setError(errorMessage(cause, 'The connection could not be saved.')))
			.finally(() => setBusy(false));
	};
	const remove = () => {
		if (!removing) return;
		setBusy(true); setError('');
		void deleteConnection(removing.id).then(() => { setRemoving(undefined); void load(); })
			.catch(cause => setError(errorMessage(cause, 'The connection could not be deleted.')))
			.finally(() => setBusy(false));
	};
	const testSaved = (connection: DatabaseConnectionV1) => {
		setBusy(true); setError('');
		void testConnection({ id: connection.id })
			.then(() => undefined)
			.catch(cause => setError(errorMessage(cause, 'Connection failed.')))
			.finally(() => setBusy(false));
	};

	if (available === null) return null;
	if (!available) return null;
	const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
	const matching = connections.filter(connection => tokens.every(token => `${connection.label} ${engineLabel(connection.engine)} ${endpoint(connection)}`.toLowerCase().includes(token)));
	const { draft, editing } = dialog;
	const network = draft.engine !== 'sqlite';
	const removingCount = removing ? (usedBy.get(removing.id)?.size ?? 0) : 0;

	return <div className="database-settings">
		<div className="database-settings-head">
			<h2>Databases</h2>
			<button type="button" className="primary" onClick={() => openDialog()} disabled={busy}><Plus size={14} aria-hidden="true"/>Add database</button>
		</div>
		{error && <p role="status" className="error-text">{error}</p>}
		{matching.length === 0 && <p className="muted">No saved database connections.</p>}
		{matching.map(connection => <section className="database-settings-row" key={connection.id}>
			<Database size={16} aria-hidden="true" className="database-settings-icon"/>
			<div className="database-settings-copy">
				<strong>{connection.label}</strong>
				<span className="muted">{engineLabel(connection.engine)} · {endpoint(connection)} · Used by {usedBy.get(connection.id)?.size ?? 0} {usedBy.get(connection.id)?.size === 1 ? 'thread' : 'threads'}</span>
			</div>
			<ActionMenu label={`Actions for ${connection.label}`} iconOnly open={menu === connection.id} onOpenChange={open => setMenu(open ? connection.id : null)} disabled={busy} items={[
				{ id: 'edit', label: 'Edit', onSelect: () => openDialog(connection) },
				{ id: 'test', label: 'Test', onSelect: () => testSaved(connection) },
				{ id: 'delete', label: 'Delete', onSelect: () => setRemoving(connection) },
			]}/>
		</section>)}

		<Modal open={dialog.open} title={editing ? 'Edit database connection' : 'Add database'} onClose={() => setDialog(state => ({ ...state, open: false }))} className="database-dialog">
			<div className="database-dialog-body">
				<div className="database-engine" role="radiogroup" aria-label="Engine">
					{ENGINES.map(option => <button key={option.value} type="button" role="radio" aria-checked={draft.engine === option.value} className={draft.engine === option.value ? 'selected' : ''} onClick={() => setDraft({ engine: option.value })}>{option.label}</button>)}
				</div>
				<label className="field">Label<input value={draft.label} maxLength={80} onChange={event => setDraft({ label: event.target.value })} aria-label="Connection label"/></label>
				{draft.engine === 'sqlite'
					? <label className="field">Database file<input value={draft.path} maxLength={4096} onChange={event => setDraft({ path: event.target.value })} aria-label="SQLite database file path" placeholder="/absolute/path/to/file.sqlite"/></label>
					: <>
						<label className="field">Host<input value={draft.host} maxLength={253} onChange={event => { const host = event.target.value; setDialog(state => ({ ...state, draft: { ...state.draft, host, ...(state.tlsTouched ? {} : { tls: defaultTls(host) }) } })); }} aria-label="Host"/></label>
						<label className="field">Port<input value={draft.port} inputMode="numeric" onChange={event => setDraft({ port: event.target.value.replace(/[^0-9]/g, '') })} aria-label="Port" placeholder={draft.engine === 'postgres' ? '5432' : '3306'}/></label>
						<label className="field">Database<input value={draft.database} maxLength={128} onChange={event => setDraft({ database: event.target.value })} aria-label="Database name"/></label>
						<label className="field">User<input value={draft.user} maxLength={128} onChange={event => setDraft({ user: event.target.value })} aria-label="User"/></label>
						<label className="field">TLS<Select aria-label="TLS mode" value={draft.tls} onValueChange={value => setDialog(state => ({ ...state, draft: { ...state.draft, tls: value as DatabaseTls }, tlsTouched: true }))} options={TLS_OPTIONS.map(option => ({ value: option.value, label: option.label }))}/></label>
						<label className="field">Password<input type="password" value={draft.password} maxLength={4096} autoComplete="off" placeholder={editing ? 'Saved' : ''} onChange={event => setDraft({ password: event.target.value })} aria-label="Password"/>{editing && <span className="muted database-password-hint">Leave empty to keep the saved password</span>}</label>
					</>}
				{network && <p className="muted database-password-hint">For remote engines a read-only database role is recommended.</p>}
				<div className="database-dialog-actions">
					<button type="button" className="quiet" onClick={runTest} disabled={!validDraft(draft, editing) || test.state === 'running'}>Test connection</button>
					{test.state !== 'idle' && <span role="status" className={test.state === 'ok' ? 'database-test-ok' : test.state === 'error' ? 'error-text' : 'muted'} aria-live="polite">{test.state === 'ok' && <CircleCheck size={14} aria-hidden="true"/>}{test.text}</span>}
				</div>
				<div className="database-dialog-footer">
					<button type="button" className="quiet" onClick={() => setDialog(state => ({ ...state, open: false }))} disabled={busy}>Cancel</button>
					<button type="button" className="primary" onClick={save} disabled={busy || !validDraft(draft, editing)}>Save</button>
				</div>
			</div>
		</Modal>

		<Modal open={Boolean(removing)} title="Delete connection" onClose={() => setRemoving(undefined)} className="database-dialog">
			{removing && <div className="database-dialog-body">
				<p>Delete “{removing.label}”?{removingCount > 0 ? ` It is used by ${removingCount} ${removingCount === 1 ? 'thread' : 'threads'}; those attachments will be removed.` : ''}</p>
				<div className="database-dialog-footer">
					<button type="button" className="quiet" onClick={() => setRemoving(undefined)} disabled={busy}>Cancel</button>
					<button type="button" className="primary" onClick={remove} disabled={busy}>Delete</button>
				</div>
			</div>}
		</Modal>
	</div>;
}
