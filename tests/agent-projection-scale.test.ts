import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { AgentProjection } from '../packages/agent-projection/index.ts';

it('synthetic scale: pages 10000 canonical summaries and refreshes only the changed parent group', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-synthetic-scale-')), store = new Store(dir), date = '2026-11-05T00:00:00.000Z';
  let projection: AgentProjection | undefined;
  try {
    store.internal('fixture.synthetic', null, () => {
      for (let i = 0; i < 2500; i++) {
        const id = `parent-${String(i).padStart(4, '0')}`, projectId = `project-${i % 20}`;
        store.put('workspaceProject', projectId, null, { id: projectId, name: projectId, authority: { kind: 'local' } });
        store.put('thread', id, id, { id, title: id, kind: 'main', projectId, projectName: projectId, status: 'working', runId: 'synthetic-run', epoch: 1, modelId: 'synthetic/model', sessionPath: null, createdAt: date, updatedAt: date });
        store.put('data', `plan:${id}`, id, { id: `plan:${id}`, threadId: id, provenance: 'harness:plan', revision: 1, value: { version: 1, title: 'Synthetic', steps: [], agents: Array.from({ length: 3 }, (_, j) => ({ id: `job-${j}`, commandId: `cmd-${i}`, taskId: `task-${j}`, name: `Synthetic child ${j}`, task: 'Synthetic', status: 'queued', reportedPercent: null, requirements: [], completedRequirementIds: [], createdAt: date, updatedAt: date })) } });
      }
      store.put('message', 'unrequested-large-history', 'parent-0000', { id: 'unrequested-large-history', threadId: 'parent-0000', role: 'assistant', content: 'SECRET_UNREQUESTED_HISTORY'.repeat(100000), createdAt: date, runId: null });
    });
    const start = performance.now(); projection = new AgentProjection(store); const bootstrapMs = performance.now() - start;
    const pageStart = performance.now(), first = projection.inventory({ limit: 37 }); const firstPageMs = performance.now() - pageStart;
    expect(first.items).toHaveLength(37); expect(JSON.stringify(first)).not.toContain('SECRET_UNREQUESTED_HISTORY');
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(64000);
    let count = first.items.length, cursor = first.nextCursor;
    const ids = new Set(first.items.map(a => a.agentId));
    while (cursor) { const page = projection.inventory({ limit: 100, cursor }); for (const item of page.items) ids.add(item.agentId); count += page.items.length; cursor = page.nextCursor; }
    expect(count).toBe(10000); expect(ids.size).toBe(10000);
    const updateStart = performance.now();
    for (let i = 0; i < 100; i++) store.internal('agent.updated', 'parent-0000', () => {
      const plan = store.get<{ value: { agents: { reportedPercent: number }[] } }>('data', 'plan:parent-0000')!;
      plan.value.agents[0].reportedPercent = i;
      store.put('data', 'plan:parent-0000', 'parent-0000', plan);
    });
    const updates = projection.updates({ after: first.sequence, scopeKey: first.scopeKey });
    expect(updates.resync).toBe(false); expect(updates.upserts.map(a => a.jobId)).toEqual(['job-0']); expect(updates.transcripts).toEqual([]);
    process.stdout.write(JSON.stringify({ evidence: 'SYNTHETIC_ONLY', summaryCount: count, projects: 20, pageSize: 37, pageBytes: Buffer.byteLength(JSON.stringify(first)), bootstrapMs, firstPageMs, scopedProgressEvents: 100, scopedProgressMs: performance.now() - updateStart }) + '\n');
  } finally { projection?.dispose(); store.close(); rmSync(dir, { recursive: true, force: true }); }
}, 15000);
