import { describe, expect, it } from 'vitest';
import { contextCompanions } from '../apps/web/src/project-context-summary.ts';
import type { Snapshot, Thread } from '../packages/contracts/index.ts';

const thread = (id: string, fields: Partial<Thread> = {}): Thread => ({ id, title: id, projectName: null, createdAt: '2026-11-04T00:00:00.000Z', updatedAt: '2026-11-04T00:00:00.000Z', status: 'ready', epoch: 0, runId: null, modelId: null, sessionPath: null, ...fields });
const plan = { version: 1, title: 'Review the changes', agents: [], steps: [{ id: 'done', title: 'Read files', status: 'completed', requirements: [] }, { id: 'now', title: 'Check tests', status: 'working', requirements: [] }] };
const record = (threadId: string, value: unknown, provenance = 'harness:plan') => ({ id: `plan:${threadId}`, threadId, provenance, revision: 3, value }) as Snapshot['data'][number];

describe('unified project context projections', () => {
  it('keeps subagents and side conversations bound to their actual parent', () => {
    const snapshot = { threads: [thread('main'), thread('child', { parentThreadId: 'main', kind: 'delegate', status: 'working' }), thread('side', { sideParentId: 'main', kind: 'side' }), thread('other', { parentThreadId: 'other-parent', kind: 'delegate' })], data: [] };
    const result = contextCompanions(snapshot, 'main');
    expect(result.agents.map(item => item.id)).toEqual(['child']);
    expect(result.sideConversations.map(item => item.id)).toEqual(['side']);
    expect(result.plan).toBeNull();
    expect(contextCompanions(snapshot).agents).toEqual([]);
  });

  it('summarizes the canonical validated plan and retains its revision', () => {
    expect(contextCompanions({ threads: [], data: [record('main', plan)] }, 'main').plan).toEqual({ title: 'Review the changes', revision: 3, completed: 1, total: 2, currentStep: 'Check tests', blocked: false });
  });

  it('rejects invalid, foreign, or untrusted plans instead of inventing a summary', () => {
    for (const data of [[record('main', { ...plan, agents: 'bad' })], [record('main', plan, 'model-text')], [record('other', plan)]]) expect(contextCompanions({ threads: [], data }, 'main').plan).toBeNull();
  });
});
