import { useEffect, useState } from 'react';
import { Modal } from '../../../../packages/ui-shell/Modal';
import { Select } from '../../../../packages/ui-shell/Select';
import { errorMessage } from '../../../../packages/ui-shell/format-utils';
import type { DatabaseConnectionV1 } from '../../../../packages/contracts/database.ts';
import { attachDatabase, listDatabases } from '../database-api';

export function DatabaseAttachDialog({ open, threadId, onClose, onAttached }: { open: boolean; threadId: string; onClose: () => void; onAttached: (connectionId: string) => void | Promise<void> }) {
	const [connections, setConnections] = useState<DatabaseConnectionV1[]>([]);
	const [connectionId, setConnectionId] = useState('');
	const [writable, setWritable] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	useEffect(() => {
		if (!open) return;
		setError(''); setWritable(false); setBusy(false);
		listDatabases().then(inventory => { setConnections(inventory.connections); setConnectionId(current => current || inventory.connections[0]?.id || ''); })
			.catch(cause => setError(errorMessage(cause, 'Connections could not load.')));
	}, [open]);
	return <Modal open={open} title="Attach database" onClose={onClose} className="database-attach-dialog">
		<div className="database-dialog-body">
			<label className="field">Connection
				<Select aria-label="Connection" value={connectionId} onValueChange={setConnectionId} options={connections.map(connection => ({ value: connection.id, label: connection.label }))}/>
			</label>
			{connections.length === 0 && !error && <p className="muted">No saved connections yet — add one in Settings → Skills & Integrations → Databases.</p>}
			<label className="settings-row-inline"><input type="checkbox" checked={writable} onChange={event => setWritable(event.target.checked)}/> Allow approved changes</label>
			{error && <p className="error-text" role="alert">{error}</p>}
			<div className="database-dialog-footer">
				<button type="button" className="quiet" onClick={onClose} disabled={busy}>Cancel</button>
				<button type="button" className="primary" disabled={busy || !connectionId} onClick={() => {
					setBusy(true); setError('');
					void attachDatabase(threadId, connectionId, writable)
						.then(receipt => onAttached((receipt.result as { connectionId: string }).connectionId ?? connectionId))
						.then(() => onClose())
						.catch(cause => setError(errorMessage(cause, 'The database could not be attached.')))
						.finally(() => setBusy(false));
				}}>Attach</button>
			</div>
		</div>
	</Modal>;
}
