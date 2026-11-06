import {afterEach, expect, it} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {Store} from '../packages/storage/store';
import {AgentProjection} from '../packages/agent-projection';
import type {Message, Thread} from '../packages/contracts';
import {AgentsWorkspaceController, groupAgents} from '../apps/web/src/agents-workspace/controller';
import type {AgentTransport} from '../apps/web/src/agents-workspace/transport';
const cleanups: (() => void)[] = [];
afterEach(() => {for (const cleanup of cleanups.splice(0)) cleanup();});
it('reads actual PR33 projection pages, full Unicode content and visible-only updates', async () => {
 const directory = mkdtempSync(join(tmpdir(), 'agents-workspace-')), store = new Store(directory);
 let projection: AgentProjection | undefined, controller: AgentsWorkspaceController | undefined;
 cleanups.push(() => {controller?.dispose(); projection?.dispose(); store.close(); const target = resolve(directory); if (!target.startsWith(resolve(tmpdir()) + sep + 'agents-workspace-')) throw Error('Unexpected cleanup target'); rmSync(target, {recursive: true, force: true});});
 for (const id of ['p', 'q']) store.internal('fixture.project', null, () => store.put('workspaceProject', id, null, {id, name: id, authority: {kind: 'local'}}));
 for (let index = 0; index < 105; index++) {
  const id = `parent-${index}`, thread: Thread = {id, kind: 'main', title: id, projectId: index === 104 ? 'q' : 'p', projectName: null, status: 'working', runId: 'run', epoch: 1, modelId: 'fixture/model', sessionPath: null, createdAt: '2026-11-06', updatedAt: '2026-11-06'};
  store.internal('fixture.thread', id, () => store.put('thread', id, id, thread));
 }
 const long = 'A😀漢'.repeat(5000), put = (content: string) => store.internal('runtime.assistant.delta', 'parent-104', () => store.put('message', 'large', 'parent-104', {id: 'large', threadId: 'parent-104', role: 'assistant', content, runId: 'run', createdAt: '2026-11-06'} satisfies Message));
 put(long); projection = new AgentProjection(store);
 const historyIds: string[] = [];
 const adapter: AgentTransport = {
  inventory: async query => projection!.inventory(query), history: async query => {historyIds.push(query.agentId); return projection!.history(query);}, content: async query => projection!.content(query), updates: async query => projection!.updates(query),
  events: async (_query, _accept, signal) => {await new Promise<void>(done => signal.addEventListener('abort', () => done(), {once: true}));},
 };
 controller = new AgentsWorkspaceController(adapter); await controller.start(); expect(controller.getSnapshot().agents).toHaveLength(105); expect(groupAgents(controller.getSnapshot().agents)).toHaveLength(2);
 controller.setVisible(['thread:parent-104']);
 await new Promise<void>((done, reject) => {const timer = setTimeout(() => {stop(); reject(Error('History timed out'));}, 3000); const stop = controller!.subscribe(() => {if (controller!.transcript('thread:parent-104').loaded) {clearTimeout(timer); stop(); done();}});});
 expect(controller.transcript('thread:parent-104').messages[0].content).toBe(long); expect(historyIds).toEqual(['thread:parent-104']);
 const state = controller.getSnapshot(); put(long + '追加');
 await controller.accept(projection.updates({after: state.sequence, scopeKey: state.scopeKey, visibleAgentIds: ['thread:parent-104']}));
 await new Promise<void>(done => {const stop = controller!.subscribe(() => {if (controller!.transcript('thread:parent-104').messages[0]?.content.endsWith('追加')) {stop(); done();}});});
 expect(controller.transcript('thread:parent-104').messages[0].content).toBe(long + '追加');
});
