import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RuntimeAdapter } from '../packages/contracts/index.ts';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import { buildServer } from '../apps/server/server.ts';
import { workspaceHost } from '../apps/server/workspace-host.ts';
import { readAgentFilePolicy, resolvedAgentFilePolicy, saveAgentFilePolicy } from '../packages/core/agent-file-policy-store.ts';
import { AGENT_FILE_POLICY_DEFAULTS } from '../packages/contracts/agent-file-policy.ts';

vi.mock('node-pty', () => ({ spawn: () => { throw new Error('Policy tests must not spawn a terminal.'); } }));
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture(withServer = true) {
	const root = await mkdtemp(join(tmpdir(), 'gen-file-policy-'));
	const projectPath = join(root, 'repo'); await mkdir(projectPath);
	const store = new Store(join(root, 'data'));
	const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
	const service = new Service(store, runtime);
	const projects = workspaceHost(service).projects;
	const receipt = await projects.connect({ id: 'connect', type: 'workspace.project.connect', payload: { name: 'Policy', path: projectPath } });
	const projectId = (receipt.result as { projects: { id: string }[] }).projects[0]!.id;
	let app: Awaited<ReturnType<typeof buildServer>> | undefined;
	let headers: Record<string, string> = {};
	if (withServer) {
		app = await buildServer(service, { port: 4318, dev: false });
		const bootstrap = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4318' } });
		headers = { host: '127.0.0.1:4318', cookie: String(bootstrap.headers['set-cookie']).split(';')[0]!, 'x-harness-csrf': bootstrap.json().csrfToken };
	}
	cleanup.push(async () => { await app?.close(); await service.dispose(); store.close(); await rm(root, { recursive: true, force: true }); });
	return { root, store, service, projectId, app, headers };
}

describe('agent file policy store', () => {
	it('resolves virtual defaults before any save', async () => {
		const f = await fixture(false);
		const global = readAgentFilePolicy(f.store, 'global');
		expect(global).toMatchObject({ revision: 0, explicit: false });
		expect(global.rules).toEqual([...AGENT_FILE_POLICY_DEFAULTS]);
		expect(readAgentFilePolicy(f.store, `project:${f.projectId}`)).toMatchObject({ revision: 0, rules: [], explicit: false });
		const resolved = resolvedAgentFilePolicy(f.store, f.projectId);
		expect(resolved.project).toMatchObject({ rules: [] });
		expect(resolved.revision).toBe('0/0');
	});

	it('saves revision-checked records and keeps an explicit empty list distinct', async () => {
		const f = await fixture(false);
		expect(saveAgentFilePolicy(f.store, 'global', 0, '*.pem\n\n*.key\n')).toMatchObject({ scope: 'global', revision: 1 });
		expect(readAgentFilePolicy(f.store, 'global')).toMatchObject({ revision: 1, rules: ['*.pem', '*.key'], explicit: true });
		expect(saveAgentFilePolicy(f.store, 'global', 1, '')).toMatchObject({ revision: 2 });
		expect(readAgentFilePolicy(f.store, 'global')).toMatchObject({ revision: 2, rules: [], explicit: true });
		expect(resolvedAgentFilePolicy(f.store, f.projectId).revision).toBe('2/0');
	});

	it('persists across store restart', async () => {
		const root = await mkdtemp(join(tmpdir(), 'gen-file-policy-restart-'));
		cleanup.push(async () => { await rm(root, { recursive: true, force: true }); });
		let store = new Store(join(root, 'data'));
		saveAgentFilePolicy(store, 'global', 0, '*.key');
		store.close();
		store = new Store(join(root, 'data'));
		cleanup.push(async () => { store.close(); });
		expect(readAgentFilePolicy(store, 'global')).toMatchObject({ revision: 1, rules: ['*.key'], explicit: true });
	});

	it('isolates scopes', async () => {
		const f = await fixture(false);
		saveAgentFilePolicy(f.store, `project:${f.projectId}`, 0, 'confidential/**');
		expect(readAgentFilePolicy(f.store, 'global').explicit).toBe(false);
		expect(readAgentFilePolicy(f.store, `project:${f.projectId}`).rules).toEqual(['confidential/**']);
		expect(readAgentFilePolicy(f.store, 'project:other')).toMatchObject({ rules: [] });
	});

	it('rejects invalid input and stale writers', async () => {
		const f = await fixture(false);
		expect(() => saveAgentFilePolicy(f.store, 'global', 0, 'ok\n/etc/bad')).toThrow(/Fix the highlighted rules/);
		expect(() => saveAgentFilePolicy(f.store, 'global', 0, 'a'.repeat(300))).toThrow(/Fix the highlighted rules/);
		saveAgentFilePolicy(f.store, 'global', 0, 'x');
		expect(() => saveAgentFilePolicy(f.store, 'global', 0, 'y')).toThrow(/changed\. Reload/);
		expect(saveAgentFilePolicy(f.store, 'global', 1, 'y')).toMatchObject({ revision: 2 });
	});

	it('emits a scope+revision invalidation event without rules', async () => {
		const f = await fixture(false);
		saveAgentFilePolicy(f.store, 'global', 0, '*.pem');
		const events = f.store.eventsAfter(0).filter(event => event.type === 'agentFilePolicy.save');
		expect(events).toHaveLength(1);
		expect(events[0]!.payload).toEqual({ result: { scope: 'global', revision: 1 } });
	});
});

describe('agent file policy routes', () => {
	it('reads and saves over the authenticated API with no-store', async () => {
		const f = await fixture();
		const read = await f.app!.inject({ url: '/api/agent-file-policy?scope=global', headers: f.headers });
		expect(read.statusCode).toBe(200); expect(read.headers['cache-control']).toBe('no-store');
		expect(read.json()).toMatchObject({ revision: 0, explicit: false, rules: AGENT_FILE_POLICY_DEFAULTS });
		const save = await f.app!.inject({ method: 'PUT', url: '/api/agent-file-policy', headers: { ...f.headers, 'content-type': 'application/json' }, payload: { scope: `project:${f.projectId}`, baseRevision: 0, rulesText: 'confidential/**' } });
		expect(save.statusCode).toBe(200); expect(save.json()).toMatchObject({ scope: `project:${f.projectId}`, revision: 1 });
		const reread = await f.app!.inject({ url: `/api/agent-file-policy?scope=project:${f.projectId}`, headers: f.headers });
		expect(reread.json()).toMatchObject({ revision: 1, rules: ['confidential/**'], explicit: true });
	});

	it('rejects a spoofed project scope and a malformed body', async () => {
		const f = await fixture();
		const spoof = await f.app!.inject({ method: 'PUT', url: '/api/agent-file-policy', headers: { ...f.headers, 'content-type': 'application/json' }, payload: { scope: 'project:missing', baseRevision: 0, rulesText: 'x' } });
		expect(spoof.statusCode).toBeGreaterThanOrEqual(400);
		const bad = await f.app!.inject({ method: 'PUT', url: '/api/agent-file-policy', headers: { ...f.headers, 'content-type': 'application/json' }, payload: { scope: 'global', baseRevision: 'no' } });
		expect(bad.statusCode).toBeGreaterThanOrEqual(400);
	});
});
