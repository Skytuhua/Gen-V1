import { authenticated, command, csrfToken, read } from './api.ts';
import type { DatabaseAttachmentV1, DatabaseConnectionV1, DatabaseEngine, DatabaseTls } from '../../../packages/contracts/database.ts';

export interface DatabaseInventory { available: boolean; connections: DatabaseConnectionV1[]; attachments: DatabaseAttachmentV1[] }
export interface NetworkInput { host: string; port: number; database: string; user: string; tls: DatabaseTls; password?: string }
export interface ConnectionInput { label: string; engine: DatabaseEngine; sqlite?: { path: string }; network?: NetworkInput }

export const listDatabases = () =>
	authenticated(() => fetch('/api/databases', { credentials: 'same-origin', cache: 'no-store' })).then(read<DatabaseInventory>);
const payload = (input: ConnectionInput): Record<string, unknown> => ({ label: input.label, engine: input.engine, ...(input.sqlite ? { sqlite: input.sqlite } : {}), ...(input.network ? { network: input.network } : {}) });
export const createConnection = (input: ConnectionInput) => command('database.connection.create', payload(input));
export const updateConnection = (id: string, input: ConnectionInput) => command('database.connection.update', { ...payload(input), id });
export const deleteConnection = (id: string) => command('database.connection.delete', { id });

export interface ConnectionTestResult { ok: boolean; serverVersion?: string }
// The test command answers its probe result directly rather than a command receipt.
export const testConnection = async (input: ConnectionInput | { id: string }): Promise<ConnectionTestResult> => {
	const response = await authenticated(() => fetch('/api/commands', {
		method: 'POST', credentials: 'same-origin',
		headers: { 'Content-Type': 'application/json', 'x-harness-csrf': csrfToken },
		body: JSON.stringify({ id: crypto.randomUUID(), type: 'database.connection.test', payload: input }),
	}));
	return read<ConnectionTestResult>(response);
};
