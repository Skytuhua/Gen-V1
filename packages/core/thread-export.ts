import { HarnessError } from '../contracts/index.ts';
import type {
  ArtifactRecord, DataRecord, InputRequest, Message, Operation,
  ResourceGrant, TaskMemory, ToolEffectRecord,
} from '../contracts/index.ts';
import { PlanRecordSchema, planDataId } from '../contracts/planning.ts';
import type { Store } from '../storage/store.ts';
import {
  MARKDOWN_DOCUMENT_BYTES, renderThreadMarkdown,
  type ThreadExportModel, type ThreadTimelineEntry,
} from './thread-markdown.ts';

const TIMELINE_KINDS = ['message', 'dataVersion', 'operation', 'request', 'artifact', 'resource', 'toolEffect'] as const;

export interface ThreadExportOptions {
  version: string;
  now: string;
  home?: string | null;
}

export interface ThreadExportResult {
  document: string;
  filename: string;
  bytes: number;
}

/** Assembles the export model for one thread and renders the Markdown
 * document. Read-only: performs no projection writes. Throws HarnessError
 * NOT_FOUND for unknown or archived threads and EXPORT_TOO_LARGE above the
 * 32 MiB document cap (R10). */
export function buildThreadExport(store: Store, threadId: string, options: ThreadExportOptions): ThreadExportResult {
  const thread = store.get<import('../contracts/index.ts').Thread>('thread', threadId);
  if (!thread || store.get('archivedThread', threadId)) {
    throw new HarnessError('NOT_FOUND', 'Thread unavailable');
  }
  const planPrefix = planDataId(threadId) + '@';
  const timeline: ThreadTimelineEntry[] = [];
  for (const row of store.timelineFor(threadId, TIMELINE_KINDS)) {
    switch (row.kind) {
      case 'message':
        timeline.push({ kind: 'message', value: row.value as Message });
        break;
      case 'dataVersion': {
        if (!row.id.startsWith(planPrefix)) break;
        const record = row.value as DataRecord;
        const parsed = PlanRecordSchema.safeParse(record.value);
        timeline.push({ kind: 'plan', id: row.id, revision: record.revision, value: parsed.success ? parsed.data : null });
        break;
      }
      case 'operation':
        timeline.push({ kind: 'operation', value: row.value as Operation });
        break;
      case 'request':
        timeline.push({ kind: 'request', value: row.value as InputRequest });
        break;
      case 'artifact':
        timeline.push({ kind: 'artifact', value: row.value as ArtifactRecord });
        break;
      case 'resource':
        timeline.push({ kind: 'attachment', value: row.value as ResourceGrant });
        break;
      case 'toolEffect':
        timeline.push({ kind: 'toolEffect', value: row.value as ToolEffectRecord });
        break;
    }
  }
  const childThreads: Record<string, { title: string; status: string }> = {};
  for (const child of store.all<import('../contracts/index.ts').Thread>('thread')) {
    if (child.parentThreadId === threadId) childThreads[child.id] = { title: child.title, status: child.status };
  }
  const model: ThreadExportModel = {
    thread,
    version: options.version,
    exportedAt: options.now,
    runInProgress: thread.runId !== null,
    timeline,
    memory: store.all<TaskMemory>('taskMemory', threadId),
    childThreads,
  };
  const document = renderThreadMarkdown(model, { home: options.home ?? null });
  const bytes = Buffer.byteLength(document, 'utf8');
  if (bytes > MARKDOWN_DOCUMENT_BYTES) {
    throw new HarnessError('EXPORT_TOO_LARGE', 'The thread export exceeds 32 MiB.');
  }
  const filename = `${(thread.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'thread')}-${options.now.slice(0, 10)}.md`;
  return { document, filename, bytes };
}
