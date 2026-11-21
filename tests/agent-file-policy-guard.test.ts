import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('node-pty', () => ({ spawn: () => { throw new Error('node-pty is unavailable in tests'); } }));
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import { workspaceHost } from '../apps/server/workspace-host.ts';
import { handleDomainTool, type DomainContext } from '../packages/capabilities/index.ts';
import { withApprovedProjectContext } from '../packages/core/approved-project-context.ts';
import { saveAgentFilePolicy } from '../packages/core/agent-file-policy-store.ts';
import { FILE_POLICY_DENIED, FILE_POLICY_DENIED_MESSAGE } from '../packages/contracts/agent-file-policy.ts';
import type { ResourceGrant, RuntimeAdapter, StartRun, Thread } from '../packages/contracts/index.ts';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

const runtime: RuntimeAdapter = { configure() {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };

async function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'harness-file-policy-'));
	const project = join(root, 'project');
	mkdirSync(join(project, 'secrets'), { recursive: true });
	mkdirSync(join(project, 'src'), { recursive: true });
	writeFileSync(join(project, '.env'), 'TOKEN=abc');
	writeFileSync(join(project, 'secrets', 'token.txt'), 'secret');
	writeFileSync(join(project, 'src', 'app.ts'), 'export {}');
	writeFileSync(join(project, 'AGENTS.md'), 'Follow the repo rules.\n');
	const store = new Store(join(root, 'data'));
	const service = new Service(store, runtime);
	cleanup.push(async () => { await service.dispose(); store.close(); rmSync(root, { recursive: true, force: true }); });
	return { root, project, store, service };
}

async function grant(service: Service, thread: Thread, path: string, kind: ResourceGrant['kind'] = 'project') {
	return (await service.command({ id: `grant-${kind}-${path.length}`, type: 'resource.grant', threadId: thread.id, payload: { path, kind } })).result as ResourceGrant;
}

function ctx(service: Service, threadId: string): DomainContext {
	return (service as unknown as { context: (t: string) => DomainContext }).context(threadId);
}

describe('agent file policy guards', () => {
	it('denies project reads that match default rules with a fixed message', async () => {
		const { project, service } = await fixture();
		const thread = (await service.command({ id: 't1', type: 'thread.create', payload: {} })).result as Thread;
		const g = await grant(service, thread, project);
		await expect(service.resolveResource(thread.id, g.id, '.env')).rejects.toMatchObject({ code: FILE_POLICY_DENIED, message: FILE_POLICY_DENIED_MESSAGE });
		await expect(service.resolveResource(thread.id, g.id, 'secrets/token.txt')).rejects.toMatchObject({ code: FILE_POLICY_DENIED });
		await expect(service.resolveResource(thread.id, g.id, 'src/app.ts')).resolves.toContain('app.ts');
	});

	it('denies an explicit file grant when a basename rule matches', async () => {
		const { project, service } = await fixture();
		const thread = (await service.command({ id: 't2', type: 'thread.create', payload: {} })).result as Thread;
		const g = await grant(service, thread, join(project, '.env'), 'file');
		await expect(service.resolveResource(thread.id, g.id)).rejects.toMatchObject({ code: FILE_POLICY_DENIED });
	});

	it.skipIf(process.platform !== 'win32')('filters denied names out of file listings', async () => {
		const { project, service } = await fixture();
		const thread = (await service.command({ id: 't3', type: 'thread.create', payload: {} })).result as Thread;
		const g = await grant(service, thread, project);
		const result = await handleDomainTool('repository_files', { resourceId: g.id }, ctx(service, thread.id)) as { entries: { path: string }[] };
		const paths = result.entries.map(entry => entry.path);
		expect(paths).toContain('src/app.ts');
		expect(paths).not.toContain('.env');
		expect(paths.some(path => path.startsWith('secrets/'))).toBe(false);
	});

	it.skipIf(process.platform !== 'win32')('denies through the native withResource guard', async () => {
		const { project, service } = await fixture();
		const thread = (await service.command({ id: 't4', type: 'thread.create', payload: {} })).result as Thread;
		const g = await grant(service, thread, project);
		await expect(ctx(service, thread.id).withResource!(g.id, '.env', false, async () => 'reached')).rejects.toMatchObject({ code: FILE_POLICY_DENIED });
	});

	it('exposes the listing filter on the domain context', async () => {
		const { project, service } = await fixture();
		const thread = (await service.command({ id: 't3b', type: 'thread.create', payload: {} })).result as Thread;
		await grant(service, thread, project);
		const domain = ctx(service, thread.id);
		expect(domain.denyFilePath?.('.env')).toBe(true);
		expect(domain.denyFilePath?.('secrets/token.txt')).toBe(true);
		expect(domain.denyFilePath?.('src/app.ts')).toBe(false);
	});

	it('applies additive project rules and invalidates after save', async () => {
		const { root, project, store, service } = await fixture();
		const host = workspaceHost(service);
		mkdirSync(join(root, 'workspace-repo'), { recursive: true });
		const receipt = await host.projects.connect({ id: 'pc', type: 'workspace.project.connect', payload: { name: 'P', path: join(root, 'workspace-repo') } });
		const projectId = (receipt.result as { projects: { id: string }[] }).projects[0]!.id;
		const thread = (await service.command({ id: 't5', type: 'thread.create', payload: { projectId } })).result as Thread;
		const g = await grant(service, thread, project);
		await expect(service.resolveResource(thread.id, g.id, 'src/app.ts')).resolves.toContain('app.ts');
		saveAgentFilePolicy(store, `project:${projectId}`, 0, 'src/**');
		await expect(service.resolveResource(thread.id, g.id, 'src/app.ts')).rejects.toMatchObject({ code: FILE_POLICY_DENIED });
		saveAgentFilePolicy(store, 'global', 0, 'AGENTS.md');
		await expect(service.resolveResource(thread.id, g.id, 'AGENTS.md')).rejects.toMatchObject({ code: FILE_POLICY_DENIED });
	});

	it('omits denied instruction files from approved project context', async () => {
		const { project, store } = await fixture();
		const info = statSync(project, { bigint: true });
		const input: StartRun = { threadId: 't6-thread', runId: 'run', epoch: 1, modelId: 'test/model', accountId: null, prompt: 'Read the project', inputId: 'input', sessionPath: null, resources: [] };
		const g: ResourceGrant = { id: 'project-grant', threadId: input.threadId, kind: 'project', path: project, label: 'Project', writable: false, createdAt: '', identity: { dev: String(info.dev), ino: String(info.ino) } };
		input.resources = [g];
		store.internal('fixture', input.threadId, () => {
			store.put('thread', input.threadId, input.threadId, { id: input.threadId, title: 'Fixture', status: 'working', ...input });
			store.put('resource', g.id, g.threadId, g);
		});
		saveAgentFilePolicy(store, 'global', 0, 'AGENTS.md');
		await withApprovedProjectContext(store, input, new AbortController().signal, async context => {
			expect(context?.instructionText ?? '').not.toContain('Follow the repo rules.');
			expect(context?.instructions.exclusions).toContainEqual(expect.objectContaining({ filename: 'AGENTS.md', reason: 'DENIED_SOURCE' }));
		});
	});
});
