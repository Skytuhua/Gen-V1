// DatabaseConnectionService + database routes (T04): flag gating, secret
// isolation, attachment lifecycle, side-thread denial, storage confinement and
// route auth hooks.
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import { configureHostCapabilityFlags } from '../packages/core/capability-flags.ts';
import { DatabaseConnectionService } from '../packages/core/database-connections.ts';
import type { DatabaseAdapter, DatabaseGateway } from '../packages/capabilities/database-gateway.ts';
import { buildServer } from '../apps/server/server.ts';
import type { RuntimeAdapter } from '../packages/contracts';
import type { Thread } from '../packages/contracts/index.ts';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.unstubAllEnvs(); });

const runtime: RuntimeAdapter = { configure() {}, models: async () => [], start: async () => {}, followUp: async () => {},
	cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };

function fakeGateway(): DatabaseGateway {
	const adapter: DatabaseAdapter = {
		test: async () => ({ serverVersion: 'fake-1' }),
		schema: async () => ({ version: 1, engine: 'postgres', schemas: [], truncated: false, digest: 'x' }),
		query: async () => ({ columns: [{ name: 'n', type: 'int' }], rows: [[1]] }),
		close: async () => {},
	};
	return { test: async () => ({ serverVersion: 'fake-1' }), schema: adapter.schema, query: adapter.query, close: async () => {} } as unknown as DatabaseGateway;
}

async function unit(options: { flag?: boolean } = {}) {
	const release = configureHostCapabilityFlags({ 'data.databaseBrowserV1': options.flag ?? true });
	const root = await mkdtemp(join(await realpath(tmpdir()), 'gen-dbconn-'));
	const store = new Store(root);
	const databases = new DatabaseConnectionService(store, fakeGateway);
	cleanup.push(async () => { store.close(); release(); await rm(root, { recursive: true, force: true }); });
	return { store, databases, root };
}

const networkSpec = { label: 'prod', engine: 'postgres' as const, network: { host: 'db.internal', port: 5432, database: 'app', user: 'reader', tls: 'require' as const, password: 'synthetic-db-password-31' } };
const cmd = (type: string, payload: Record<string, unknown>, threadId?: string) => ({ id: `cmd-${Math.random().toString(36).slice(2)}`, type, threadId, payload });
const error = async (work: Promise<unknown>) => work.then(() => 'NO_ERROR').catch((cause: { code?: string }) => cause.code ?? String(cause));

it('creates, reads, updates, tests and deletes a network connection without persisting the password', async () => {
	const { store, databases } = await unit();
	const created = await databases.command(cmd('database.connection.create', networkSpec)) as { result: { id: string; network?: { secretRefId: string } } };
	const id = created.result.id;
	expect(created.result.network?.secretRefId).toBe(`dbconn:${id}`);
	expect(JSON.stringify(created)).not.toContain('synthetic-db-password-31');
	expect(store.sequence).toBeGreaterThan(0);
	for (const kind of ['databaseConnection', 'databaseSecret']) for (const entity of store.all(kind)) {
		const body = JSON.stringify(entity);
		if (kind === 'databaseSecret') expect(body).toContain('synthetic-db-password-31'); else expect(body).not.toContain('synthetic-db-password-31');
	}
	expect(JSON.stringify(store.snapshot())).not.toContain('synthetic-db-password-31');

	const tested = await databases.command(cmd('database.connection.test', { id })) as { ok: boolean; serverVersion?: string };
	expect(tested.ok).toBe(true); expect(tested.serverVersion).toBe('fake-1');
	const updated = await databases.command(cmd('database.connection.update', { ...networkSpec, id, label: 'prod2', network: { ...networkSpec.network, password: undefined } })) as { result: { label: string } };
	expect(updated.result.label).toBe('prod2');
	await expect(databases.resolvePassword(`dbconn:${id}`)).resolves.toBe('synthetic-db-password-31');
	await databases.command(cmd('database.connection.update', { ...networkSpec, id, label: 'prod3', password: 'rotated-secret-41' }));
	await expect(databases.resolvePassword(`dbconn:${id}`)).resolves.toBe('rotated-secret-41');

	await databases.command(cmd('database.connection.delete', { id }));
	expect(databases.connection(id)).toBeNull();
	await expect(databases.resolvePassword(`dbconn:${id}`)).rejects.toMatchObject({ code: 'DATABASE_AUTH_FAILED' });
	expect(JSON.stringify(store.all('databaseSecret'))).not.toContain('rotated-secret-41');
});

it('tests an unsaved spec without leaving a secret behind', async () => {
	const { store, databases } = await unit();
	const result = await databases.command(cmd('database.connection.test', networkSpec)) as { ok: boolean; serverVersion?: string };
	expect(result).toEqual({ ok: true, serverVersion: 'fake-1' });
	expect(store.all('databaseSecret')).toEqual([]);
});

it('canonicalises SQLite paths and denies paths inside harness storage', async () => {
	const { databases, root } = await unit();
	const inside = join(root, 'harness.sqlite');
	expect(await error(databases.command(cmd('database.connection.create', { label: 's', engine: 'sqlite', sqlite: { path: inside } })))).toBe('CAPABILITY_DENIED');
	const outside = join(await realpath(tmpdir()), 'gen-dbconn-outside.db');
	await writeFile(outside, '');
	const created = await databases.command(cmd('database.connection.create', { label: 's', engine: 'sqlite', sqlite: { path: outside } })) as { result: { sqlite: { path: string; identity: { dev: string; ino: string } } } };
	expect(created.result.sqlite.path).toBe(await realpath(outside));
	expect(created.result.sqlite.identity.ino).toBeTruthy();
	await rm(outside, { force: true });
});

function seedThreads(store: Store): { main: Thread; side: Thread } {
	const main = { id: 'thread-main-1', sideParentId: undefined, kind: 'task' } as unknown as Thread;
	const side = { id: 'thread-side-1', sideParentId: main.id, kind: 'task' } as unknown as Thread;
	store.internal('test.seed', null, () => { store.put('thread', main.id, null, main); store.put('thread', side.id, null, side); });
	return { main, side };
}

it('attaches and detaches threads, denies queries after detach, and rejects side threads', async () => {
	const { store, databases } = await unit();
	const { main, side } = seedThreads(store);
	const created = await databases.command(cmd('database.connection.create', networkSpec)) as { result: { id: string } };
	const attached = await databases.command(cmd('database.attach', { connectionId: created.result.id }, main.id)) as { result: { id: string; writable: boolean } };
	expect(attached.result.writable).toBe(false);
	expect(databases.attachments(main.id)).toHaveLength(1);
	expect(databases.attachmentFor(main.id, attached.result.id).attachment.id).toBe(attached.result.id);
	expect(await error(databases.command(cmd('database.attach', { connectionId: created.result.id, writable: true }, side.id)))).toBe('CAPABILITY_DENIED');
	expect(await error(databases.command(cmd('database.detach', { attachmentId: attached.result.id }, side.id)))).toBe('CAPABILITY_DENIED');
	expect(await error(Promise.resolve().then(() => databases.attachmentFor(side.id, attached.result.id)))).toBe('CAPABILITY_DENIED');
	await databases.command(cmd('database.detach', { attachmentId: attached.result.id }));
	expect(databases.attachments(main.id)).toHaveLength(0);
	expect(await error(Promise.resolve().then(() => databases.attachmentFor(main.id, attached.result.id)))).toBe('CAPABILITY_DENIED');
});

it('denies every command when the flag is off', async () => {
	const { databases } = await unit({ flag: false });
	for (const type of ['database.connection.create', 'database.connection.update', 'database.connection.delete', 'database.connection.test', 'database.attach', 'database.detach']) {
		expect(await error(databases.command(cmd(type, {})))).toBe('CAPABILITY_DENIED');
	}
});

async function routed(flag: boolean) {
	const release = configureHostCapabilityFlags({ 'data.databaseBrowserV1': flag });
	const root = await mkdtemp(join(await realpath(tmpdir()), 'gen-dbconn-http-'));
	const store = new Store(root);
	const service = new Service(store, runtime);
	const app = await buildServer(service, { port: 4319, dev: false });
	cleanup.push(async () => { await app.close(); await service.dispose(); store.close(); release(); await rm(root, { recursive: true, force: true }); });
	const boot = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4319' } });
	const cookie = String(boot.headers['set-cookie']).split(';')[0]!;
	const csrf = (boot.json() as { csrfToken: string }).csrfToken;
	return { app, headers: { host: '127.0.0.1:4319', cookie, 'x-harness-csrf': csrf } };
}

it('applies host, origin, session and CSRF hooks to every database route', async () => {
	const { app, headers } = await routed(true);
	const threadId = '11111111-1111-4111-8111-111111111111';
	const attachmentId = '22222222-2222-4222-8222-222222222222';
	const base = `/api/threads/${threadId}/databases`;
	const badHost = await app.inject({ url: base, headers: { host: 'evil.local' } });
	expect(badHost.statusCode).toBe(403); expect(badHost.json().error.code).toBe('INVALID_HOST');
	const badOrigin = await app.inject({ url: base, headers: { ...headers, origin: 'https://evil.example' } });
	expect(badOrigin.statusCode).toBe(403); expect(badOrigin.json().error.code).toBe('INVALID_ORIGIN');
	const noSession = await app.inject({ url: base, headers: { host: headers.host } });
	expect(noSession.statusCode).toBe(401);
	const noCsrf = await app.inject({ method: 'POST', url: `${base}/${attachmentId}/query`, headers: { ...headers, 'x-harness-csrf': '' }, payload: { sql: 'SELECT 1' } });
	expect(noCsrf.statusCode).toBe(403); expect(noCsrf.json().error.code).toBe('CSRF_REQUIRED');
});

it('denies every route when the flag is off', async () => {
	const { app, headers } = await routed(false);
	const threadId = '11111111-1111-4111-8111-111111111111';
	const attachmentId = '22222222-2222-4222-8222-222222222222';
	const base = `/api/threads/${threadId}/databases`;
	expect((await app.inject({ url: `${base}/${attachmentId}/schema`, headers })).json().error.code).toBe('CAPABILITY_DENIED');
	expect((await app.inject({ method: 'POST', url: `${base}/${attachmentId}/query`, headers, payload: { sql: 'SELECT 1' } })).json().error.code).toBe('CAPABILITY_DENIED');
	expect((await app.inject({ method: 'POST', url: `${base}/${attachmentId}/query/${threadId}/cancel`, headers })).json().error.code).toBe('CAPABILITY_DENIED');
});
