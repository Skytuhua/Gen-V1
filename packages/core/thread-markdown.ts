import type {
  ArtifactRecord, InputRequest, Message, Operation,
  ResourceGrant, TaskMemory, Thread, ToolEffectRecord,
} from '../contracts/index.ts';
import type { SourceRefV1 } from '../contracts/source-selection.ts';
import { HarnessError } from '../contracts/index.ts';
import type { PlanRecord } from '../contracts/planning.ts';
import { agentProgress } from '../contracts/planning.ts';
import { memoryContainsSecret } from './memory-publication.ts';

export type ThreadTimelineEntry =
  | { kind: 'message'; value: Message }
  | { kind: 'plan'; id: string; revision: number; value: PlanRecord | null }
  | { kind: 'operation'; value: Operation }
  | { kind: 'request'; value: InputRequest }
  | { kind: 'artifact'; value: ArtifactRecord }
  | { kind: 'attachment'; value: ResourceGrant }
  | { kind: 'toolEffect'; value: ToolEffectRecord };

export interface ThreadExportModel {
  thread: Thread;
  version: string;
  exportedAt: string;
  runInProgress: boolean;
  timeline: ThreadTimelineEntry[];
  memory: TaskMemory[];
  childThreads: Record<string, { title: string; status: string }>;
}

export const MARKDOWN_FIELD_BYTES = 64 * 1024;
export const MARKDOWN_DOCUMENT_BYTES = 32 * 1024 * 1024;

const timeOf = (iso: string) => iso.slice(11, 19) + 'Z';
const json = (value: unknown) => JSON.stringify(value, null, 2) ?? 'null';
const baseName = (path: string) => { const parts = path.split(/[\\/]/); return parts[parts.length - 1] || path; };

/** Whitespace-separated tokens that look like a secret are masked; a line that
 * still matches the secret scan is masked as a whole so a partial token cannot
 * survive (R9). */
export function redact(text: string, home: string | null): string {
  let value = text;
  if (home) {
    const variants = new Set([home, home.replace(/\//g, '\\'), home.replace(/\\/g, '/')]);
    for (const prefix of variants) {
      if (prefix) value = value.split(prefix).join('~');
    }
    value = value.replace(/~\\/g, '~/');
  }
  const lines = value.split('\n').map(line =>
    line.split(/(\s+)/).map(token => /\s/.test(token) || !memoryContainsSecret(token) ? token : '[redacted]').join(''));
  return lines.map(line => memoryContainsSecret(line) ? '[redacted line]' : line).join('\n');
}

const TABLE_ESCAPES = /[\\|`*_\[\]<>]/g;
export function escapeInline(text: string): string {
  return text.replace(/\r\n?/g, ' ').replace(/\n/g, ' ').replace(TABLE_ESCAPES, match => match === '<' ? '&lt;' : match === '>' ? '&gt;' : '\\' + match);
}
const escapeCell = (text: string) => escapeInline(text);
const escapeSummary = escapeInline;

/** Longest run of backticks in the text plus one, so a content run can never
 * collide with the fence (minimum 3, per CommonMark). */
export function fenceFor(text: string): string {
  let longest = 0;
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return '`'.repeat(Math.max(3, longest + 1));
}

/** Caps one field at MARKDOWN_FIELD_BYTES UTF-8 bytes without splitting a
 * code point (R10). */
export function truncate(text: string, cap = MARKDOWN_FIELD_BYTES): string {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= cap) return text;
  let used = 0, end = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char, 'utf8');
    if (used + size > cap) break;
    used += size;
    end += char.length;
  }
  return text.slice(0, end) + `\u2026 [truncated ${bytes - used} bytes]`;
}

export function slugFilename(title: string, date: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return `${slug || 'thread'}-${date.slice(0, 10)}.md`;
}

const push = (lines: string[], value: string) => { lines.push(value); };
const blank = (lines: string[]) => { lines.push(''); };
const fenceBlock = (lines: string[], body: string, info = 'text') => {
  const fence = fenceFor(body);
  push(lines, fence + info);
  push(lines, body);
  push(lines, fence);
};

function describeSource(ref: SourceRefV1): string {
  const source = ref.source as { kind: string; sourceId: string; path?: string; range?: { startLine?: number; endLine?: number } };
  return source.path ? `${source.kind} ${source.path}${source.range?.startLine ? ` L${source.range.startLine}–${source.range.endLine}` : ''}` : `${source.kind} ${source.sourceId}`;
}

function renderMessage(lines: string[], message: Message, home: string | null) {
  const who = message.role === 'user' ? 'User' : 'Assistant';
  push(lines, `## ${who} · ${message.createdAt}`);
  blank(lines);
  if (message.sourceRefs?.length) {
    push(lines, `_Context: ${message.sourceRefs.map(ref => escapeInline(describeSource(ref))).join('; ')}_`);
    blank(lines);
  }
  push(lines, redact(message.content, home));
  blank(lines);
}

function renderActivity(lines: string[], group: Message[], home: string | null) {
  push(lines, `<details>`);
  push(lines, `<summary>Tool activity (${group.length})</summary>`);
  blank(lines);
  for (const message of group) {
    push(lines, `- ${timeOf(message.createdAt)} \`${escapeSummary(redact(message.content, home))}\``);
  }
  blank(lines);
  push(lines, `</details>`);
  blank(lines);
}

function renderPlan(lines: string[], entry: Extract<ThreadTimelineEntry, { kind: 'plan' }>, home: string | null) {
  const plan = entry.value;
  if (!plan) {
    push(lines, `_Plan revision ${entry.revision} could not be read._`);
    blank(lines);
    return;
  }
  push(lines, `### Plan · revision ${entry.revision}${plan.title ? ` — ${escapeInline(redact(plan.title, home))}` : ''}`);
  blank(lines);
  const meta = [plan.authority, plan.runState, plan.run ? `${plan.run.runId}@${plan.run.epoch}` : undefined].filter(Boolean).join(' · ');
  if (meta) {
    push(lines, `_${escapeInline(meta)}_`);
    blank(lines);
  }
  plan.steps.forEach((step, index) => {
    push(lines, `${index + 1}. [${step.status}] ${escapeInline(redact(step.title, home))}${step.objective ? ` — ${escapeInline(redact(step.objective, home))}` : ''}`);
    const bullets: string[] = [];
    if (step.details) bullets.push(`Details: ${redact(step.details, home)}`);
    if (step.result) bullets.push(`Result: ${redact(step.result, home)}`);
    if (step.checks?.length) bullets.push(`Checks: ${step.checks.map(check => `[${check.status}] ${escapeInline(redact(check.label, home))}`).join('; ')}`);
    if (step.blockers?.length) bullets.push(`Blockers: ${step.blockers.map(blocker => escapeInline(redact(blocker, home))).join('; ')}`);
    if (step.dependsOn?.length) bullets.push(`Depends on: ${step.dependsOn.join(', ')}`);
    if (step.requirements?.length) bullets.push(`Requirements: ${step.requirements.map(requirement => requirement.id).join(', ')}`);
    if (step.agentIds?.length) bullets.push(`Agents: ${step.agentIds.join(', ')}`);
    for (const bullet of bullets) push(lines, `   - ${bullet}`);
  });
  if (plan.agents?.length) {
    blank(lines);
    for (const agent of plan.agents) {
      push(lines, `**Agent ${escapeInline(redact(agent.name, home))}** — ${escapeInline(agent.status)} (${agentProgress(agent)}%)${agent.summary ? ` — ${escapeInline(redact(agent.summary, home))}` : ''}`);
    }
  }
  blank(lines);
}

function renderOperation(lines: string[], operation: Operation, home: string | null) {
  push(lines, `### Operation · ${escapeInline(operation.kind)} · ${escapeInline(operation.status)}`);
  blank(lines);
  if (operation.description) { push(lines, escapeInline(redact(operation.description, home))); blank(lines); }
  push(lines, `Approved: ${operation.approved ? 'yes' : 'no'}`);
  blank(lines);
  if (operation.args !== undefined) {
    push(lines, 'Arguments:');
    blank(lines);
    fenceBlock(lines, truncate(redact(json(operation.args), home)), 'json');
    blank(lines);
  }
  if (operation.result !== undefined) {
    push(lines, 'Result:');
    blank(lines);
    fenceBlock(lines, truncate(redact(json(operation.result), home)), 'json');
    blank(lines);
  }
  if (operation.error) {
    push(lines, 'Error:');
    blank(lines);
    fenceBlock(lines, truncate(redact(operation.error, home)));
    blank(lines);
  }
}

function renderToolEffect(lines: string[], effect: ToolEffectRecord, home: string | null) {
  push(lines, `### Tool effect · ${escapeInline(effect.toolId)} · ${escapeInline(effect.state)}`);
  blank(lines);
  push(lines, escapeInline(redact(effect.publicRedactedSummary ?? '', home)));
  blank(lines);
  if (effect.transitions?.length) {
    for (const transition of effect.transitions) {
      push(lines, `- ${transition.at} ${escapeInline(transition.from ?? '—')} → ${escapeInline(transition.to)}${transition.note ? ` (${escapeInline(redact(transition.note, home))})` : ''}`);
    }
    blank(lines);
  }
  // outcome.value never exports (R9); only its error text may appear.
  if (effect.outcome?.error) {
    push(lines, `Error: ${escapeInline(redact(effect.outcome.error, home))}`);
    blank(lines);
  }
}

function renderRequest(lines: string[], request: InputRequest, home: string | null) {
  push(lines, `### Input request · ${escapeInline(redact(request.title, home))} · ${escapeInline(request.status)}`);
  blank(lines);
  push(lines, redact(request.prompt, home));
  blank(lines);
  if (request.response !== undefined) {
    push(lines, 'Response:');
    blank(lines);
    fenceBlock(lines, truncate(redact(json(request.response), home)), 'json');
    blank(lines);
  }
}

function renderArtifact(lines: string[], artifact: ArtifactRecord, home: string | null) {
  push(lines, `### Artifact · ${escapeInline(redact(artifact.title || artifact.id, home))} (${escapeInline(artifact.kind)})`);
  blank(lines);
  if (artifact.purpose) { push(lines, redact(artifact.purpose, home)); blank(lines); }
  push(lines, `_Interactive artifact; not exported._`);
  blank(lines);
}

function renderAttachment(lines: string[], grant: ResourceGrant, home: string | null) {
  push(lines, `### Attachment · ${escapeInline(redact(grant.label ?? grant.id, home))}`);
  blank(lines);
  if (grant.path) push(lines, `File: ${escapeInline(baseName(grant.path))}`);
  blank(lines);
}

/** Pure renderer: model in, CommonMark text out. No I/O, no clock reads, no
 * global mutable state. */
export function renderThreadMarkdown(model: ThreadExportModel, options: { home?: string | null } = {}): string {
  const home = options.home ?? null;
  const { thread } = model;
  const lines: string[] = [];
  push(lines, '<!-- gen-v1-thread-export v1 -->');
  push(lines, `# ${escapeInline(redact(thread.title || 'Untitled thread', home))}`);
  blank(lines);
  const memoryCount = model.memory.length;
  push(lines, '| | |');
  push(lines, '|---|---|');
  push(lines, `| Project | ${escapeCell(thread.projectName ?? '—')} |`);
  push(lines, `| Model | ${escapeCell(`${thread.modelId ?? '—'}${thread.thinkingLevel ? ` (thinking: ${thread.thinkingLevel})` : ''}`)} |`);
  push(lines, `| Mode | ${escapeCell(thread.mode ?? '—')} |`);
  push(lines, `| Status | ${escapeCell(thread.status)} |`);
  push(lines, `| Created | ${thread.createdAt} |`);
  push(lines, `| Updated | ${thread.updatedAt} |`);
  push(lines, `| Messages | ${model.timeline.filter(entry => entry.kind === 'message').length} |`);
  push(lines, `| Exported by | Gen V1 ${model.version} at ${model.exportedAt} |`);
  blank(lines);
  if (model.runInProgress) {
    push(lines, `> Run in progress — this export is a snapshot at export time.`);
    blank(lines);
  }
  let activity: Message[] = [];
  const flushActivity = () => { if (activity.length) { renderActivity(lines, activity, home); activity = []; } };
  let messageCount = 0;
  for (const entry of model.timeline) {
    if (entry.kind === 'message' && entry.value.role === 'activity') { activity.push(entry.value); continue; }
    flushActivity();
    switch (entry.kind) {
      case 'message': messageCount++; renderMessage(lines, entry.value, home); break;
      case 'plan': renderPlan(lines, entry, home); break;
      case 'operation': renderOperation(lines, entry.value, home); break;
      case 'request': renderRequest(lines, entry.value, home); break;
      case 'artifact': renderArtifact(lines, entry.value, home); break;
      case 'attachment': renderAttachment(lines, entry.value, home); break;
      case 'toolEffect': renderToolEffect(lines, entry.value, home); break;
    }
  }
  flushActivity();
  if (!messageCount) {
    push(lines, '_No messages._');
    blank(lines);
  }
  if (memoryCount) {
    push(lines, '## Task memory');
    blank(lines);
    for (const memory of model.memory) {
      push(lines, `- **${escapeInline(redact(memory.key, home))}** (${escapeInline(memory.author)}${memory.revision ? `, rev ${memory.revision}` : ''}): ${redact(memory.content, home)}`);
    }
    blank(lines);
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const document = lines.join('\n') + '\n';
  if (Buffer.byteLength(document, 'utf8') > MARKDOWN_DOCUMENT_BYTES) {
    throw new HarnessError('EXPORT_TOO_LARGE', 'The thread export exceeds 32 MiB.');
  }
  return document;
}
