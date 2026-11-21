import { HarnessError, type ArtifactRecord, type DataRecord, type InputRequest, type Message, type Operation, type ResourceGrant, type TaskMemory, type Thread, type ToolEffectRecord } from '../contracts/index.ts';
import { PlanRecordSchema, planDataId } from '../contracts/planning.ts';
import type { Store } from '../storage/store.ts';
import type { ThreadExportModel, TimelineEntry } from './thread-markdown.ts';

const TIMELINE_KINDS = ['message', 'dataVersion', 'operation', 'request', 'artifact', 'resource', 'toolEffect'] as const;

/** One consistent read of the stored thread (SQLite reads are synchronous). */
export function buildThreadExport(store: Store, threadId: string, options: { version: string; now: string }): ThreadExportModel {
  const thread = store.get<Thread>('thread', threadId);
  if (!thread || store.get('archivedThread', threadId)) throw new HarnessError('NOT_FOUND', 'Thread unavailable');
  const planId = planDataId(threadId);
  const childIds = new Set<string>();
  const timeline: TimelineEntry[] = [];
  for (const row of store.timelineFor(threadId, TIMELINE_KINDS)) {
    switch (row.kind) {
      case 'message': timeline.push({ kind: 'message', message: row.value as Message }); break;
      case 'dataVersion': {
        const record = row.value as DataRecord;
        if (record.id !== planId) break;
        const parsed = PlanRecordSchema.safeParse(record.value);
        const plan = parsed.success ? parsed.data : null;
        if (plan) for (const job of plan.agents) if (job.childThreadId) childIds.add(job.childThreadId);
        timeline.push({ kind: 'plan', revision: record.revision, plan });
        break;
      }
      case 'operation': timeline.push({ kind: 'operation', operation: row.value as Operation }); break;
      case 'request': timeline.push({ kind: 'request', request: row.value as InputRequest }); break;
      case 'artifact': timeline.push({ kind: 'artifact', artifact: row.value as ArtifactRecord }); break;
      case 'resource': timeline.push({ kind: 'resource', resource: row.value as ResourceGrant }); break;
      case 'toolEffect': timeline.push({ kind: 'toolEffect', effect: row.value as ToolEffectRecord }); break;
    }
  }
  const childThreads: ThreadExportModel['childThreads'] = {};
  for (const id of childIds) {
    const child = store.get<Thread>('thread', id);
    if (child) childThreads[id] = { title: child.title, status: child.status };
  }
  return {
    thread, version: options.version, exportedAt: options.now,
    runInProgress: thread.runId !== null,
    timeline,
    memory: store.all<TaskMemory>('taskMemory', threadId),
    childThreads,
  };
}
