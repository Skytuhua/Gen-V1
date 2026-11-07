import {expect, test, vi} from 'vitest';
import {AgentsWorkspaceController} from '../apps/web/src/agents-workspace/controller';
import type {AgentTransport} from '../apps/web/src/agents-workspace/transport';
import type {AgentSummary, HistoryPage} from '../packages/contracts/agent-inventory';

test('an inactive workspace aborts every reader and resumes with the same reading position', async () => {
  let inventories = 0, finishHistory!: (page: HistoryPage) => void;
  const owner: AgentSummary = {agentId: 'owner', threadId: 'owner', rootId: 'owner', parentId: null, jobId: null, projectId: null, projectName: null, title: 'Owner', status: 'working', modelId: null, currentAction: null, reportedPercent: null, createdAt: '2026-11-06', updatedAt: '2026-11-06', orderKey: 'owner', revision: 1, archived: false, readOnly: false, metadata: 'thread'};
  const signals: AbortSignal[] = [];
  const transport: AgentTransport = {
    inventory: async () => {inventories++; return {authority: 'personal', scopeKey: 'scope', sequence: 1, items: [owner], ancestors: [], nextCursor: null};},
    updates: async query => ({authority: 'personal', scopeKey: 'scope', fromSequence: query.after, sequence: 1, resync: false, upserts: [], removed: [], ancestors: [], transcripts: []}),
    history: (_query, signal) => {signals.push(signal); return new Promise(resolve => {finishHistory = resolve;});},
    content: async () => {throw Error('No content read expected.');},
    events: (_query, _accept, signal) => {signals.push(signal); return new Promise(resolve => signal.addEventListener('abort', () => resolve(), {once: true}));},
  };
  const controller = new AgentsWorkspaceController(transport);
  try {
    await controller.start(); controller.setView('owner', {top: 147, left: 100, atEnd: false}); controller.setVisible(['owner']);
    await vi.waitFor(() => expect(signals.length).toBeGreaterThan(1));
    controller.pause();
    expect(signals.length).toBeGreaterThan(0); expect(signals.every(signal => signal.aborted)).toBe(true);
    controller.setVisible(['owner']); expect(inventories).toBe(1);
    finishHistory?.({authority: 'personal', agentId: 'owner', threadId: 'owner', sequence: 1, messages: [], nextCursor: null});
    await Promise.resolve(); expect(controller.getSnapshot().connected).toBe(false);
    await controller.start(); expect(inventories).toBe(2);
    expect(controller.view('owner')).toMatchObject({top: 147, left: 100, atEnd: false});
  } finally {controller.dispose();}
});
