export const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import type {AgentSummary, HistoryPage, InventoryPage, InventoryUpdates, MessageSlice} from './packages/contracts/agent-inventory';
import type {AgentTransport} from './apps/web/src/agents-workspace/transport';
import {AgentsWorkspace} from './apps/web/src/agents-workspace/AgentsWorkspace';
import type {AgentsWorkspaceProps} from './apps/web/src/agents-workspace/AgentsWorkspace';
import {AgentsWorkspaceController} from './apps/web/src/agents-workspace/controller';
import type {SharedAgentComposers} from './apps/web/src/agents-workspace/composer';

const agent = (id: string, patch: Partial<AgentSummary> = {}): AgentSummary => ({agentId: id, parentId: null, rootId: id, jobId: null, threadId: id, projectId: 'p', projectName: 'Project', title: id, status: 'working', modelId: 'model', currentAction: 'Reading source', reportedPercent: null, createdAt: '2026-11-06', updatedAt: '2026-11-06', orderKey: id, revision: 1, archived: false, readOnly: false, metadata: 'thread', ...patch});
const agents = [agent('parent-00'), agent('child-00', {parentId: 'parent-00', rootId: 'parent-00', jobId: 'job', readOnly: true}), ...Array.from({length: 7}, (_, i) => agent('parent-0' + (i + 1)))];
const inventoryPage = (): InventoryPage => ({authority: 'personal', scopeKey: 'scope', sequence: 10, items: agents, ancestors: [], nextCursor: null});
const message = (agentId: string): MessageSlice => {const content = agentId + ' transcript line'; return {id: 'm-' + agentId, threadId: agentId, role: 'assistant', createdAt: '2026-11-06', runId: 'run', content, contentOffset: 0, contentLength: content.length, nextContentCursor: null};};
const historyPage = (agentId: string): HistoryPage => ({authority: 'personal', agentId, threadId: agentId, sequence: 10, messages: [message(agentId)], nextCursor: null});
const transport: AgentTransport = {
  inventory: async () => inventoryPage(),
  history: async query => historyPage(query.agentId),
  content: async () => message(''),
  updates: async query => ({authority: 'personal', scopeKey: query.scopeKey, fromSequence: query.after, sequence: query.after, resync: false, upserts: [], removed: [], ancestors: [], transcripts: []}),
  events: async (_query, _accept, signal) => {await new Promise<void>(done => signal.addEventListener('abort', () => done(), {once: true}));},
};
const controller = new AgentsWorkspaceController(transport);
const drafts = new Map<string, string>();
const composerListeners = new Map<string, Set<() => void>>();
const composerSnapshots = new Map<string, {draft: string; ready: boolean; busy: boolean; stopping: boolean; error: string; retry: boolean}>();
const notify = (agentId: string) => {composerSnapshots.delete(agentId); for (const listener of composerListeners.get(agentId) ?? []) listener();};
const composers: SharedAgentComposers = {
  getSnapshot: agent => {const key = agent.agentId; let snapshot = composerSnapshots.get(key); if (!snapshot) {snapshot = {draft: drafts.get(key) ?? '', ready: true, busy: false, stopping: false, error: '', retry: false}; composerSnapshots.set(key, snapshot);} return snapshot;},
  subscribe: (agent, listener) => {const set = composerListeners.get(agent.agentId) ?? new Set(); set.add(listener); composerListeners.set(agent.agentId, set); return () => set.delete(listener);},
  prepare: async () => {},
  edit: async (agent, value) => {drafts.set(agent.agentId, value); notify(agent.agentId);},
  addSkill: async () => {}, removeSkill: async () => {}, addExcerpt: async () => {}, editExcerpt: async () => {}, removeExcerpt: async () => {},
  submit: async () => {}, clearError: () => {}, stop: async () => {},
  canSend: () => true,
  supports: agent => !agent.parentId,
  dispose: () => {},
};
const props: AgentsWorkspaceProps = {controller, composers, onOpenConversation: () => {}};
createRoot(document.getElementById('root')!).render(<main style={{height: '100dvh', minWidth: 0}}><AgentsWorkspace {...props}/></main>);
(window as unknown as {controller: AgentsWorkspaceController}).controller = controller;
void (async () => {
  try {
    await controller.start();
    document.documentElement.dataset.ready = 'true';
  } catch (error) {document.documentElement.dataset.error = String(error);}
})();
declare global {interface Window {controller: AgentsWorkspaceController}}
`;

