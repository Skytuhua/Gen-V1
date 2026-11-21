import type { ArtifactRecord, InputRequest, Message, Operation, ResourceGrant, TaskMemory, Thread, ToolEffectRecord } from '../contracts/index.ts';
import type { PlanRecord } from '../contracts/planning.ts';
import { agentProgress } from '../contracts/planning.ts';
import { memoryContainsSecret } from './memory-publication.ts';

export const THREAD_EXPORT_MAX_BYTES = 32 * 1024 * 1024;
const FIELD_MAX_BYTES = 64 * 1024;
const FORMAT_MARKER = '<!-- gen-v1-thread-export v1 -->';

/** One stored entity at its position in the thread's insertion-ordered timeline. */
export type TimelineEntry =
  | { kind: 'message'; message: Message }
  | { kind: 'plan'; revision: number; plan: PlanRecord | null }
  | { kind: 'operation'; operation: Operation }
  | { kind: 'request'; request: InputRequest }
  | { kind: 'artifact'; artifact: ArtifactRecord }
  | { kind: 'resource'; resource: ResourceGrant }
  | { kind: 'toolEffect'; effect: ToolEffectRecord };

export interface ThreadExportModel {
  thread: Thread;
  version: string;
  exportedAt: string;
  runInProgress: boolean;
  timeline: TimelineEntry[];
  memory: TaskMemory[];
  childThreads: Record<string, { title: string; status: string }>;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Inline markdown contexts (headings, tables, <summary>) get this escaping. */
export function escapeInline(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/[|<>`*_[\]]/g, match => '\\' + match);
}

/** A fence one backtick longer than the body's longest run keeps content inside its block. */
export function fenceFor(text: string): string {
  let longest = 0;
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return '`'.repeat(Math.max(3, longest + 1));
}

/** Best-effort pattern redaction, never a guarantee the output is secret-free. */
export function redact(text: string, home?: string): string {
  const variants = new Set<string>();
  if (home) {
    const trimmed = home.replace(/[\\/]+$/, '');
    if (trimmed) { variants.add(trimmed); variants.add(trimmed.replace(/\//g, '\\')); variants.add(trimmed.replace(/\\/g, '/')); }
  }
  return text.split('\n').map(line => {
    let redacted = line;
    for (const variant of variants) redacted = redacted.replace(new RegExp(escapeRegExp(variant) + '(?=[\\\\/])', 'g'), '~');
    redacted = redacted.split(/(\s+)/).map(part => part.trim() && memoryContainsSecret(part) ? '[redacted]' : part).join('');
    return memoryContainsSecret(redacted) ? '[redacted line]' : redacted;
  }).join('\n');
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export function truncate(text: string, capBytes: number): string {
  const bytes = encoder.encode(text);
  if (bytes.length <= capBytes) return text;
  const cut = decoder.decode(bytes.subarray(0, capBytes));
  return cut + `\n… [truncated ${bytes.length - encoder.encode(cut).length} bytes]`;
}

/** `<slugified title>-<YYYY-MM-DD>.md`; slug is lowercase ASCII [a-z0-9-], ≤60 chars. */
export function slugFilename(title: string, date: string): string {
  const slug = (title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 60).replace(/-+$/, '')) || 'thread';
  return `${slug}-${date}.md`;
}

const timeOf = (iso: string) => (/(?:T| )(\d{2}:\d{2}:\d{2})/.exec(iso)?.[1] ?? iso) + 'Z';
const iso = (value: string | undefined) => value ?? '—';

function planLines(plan: PlanRecord | null, revision: number, model: ThreadExportModel, ctx: { home?: string }): string[] {
  const lines = [`### Plan · revision ${revision}${plan ? ' — ' + escapeInline(redact(plan.title, ctx.home)) : ''}`];
  if (!plan) { lines.push(`_Plan revision ${revision} could not be read._`); return lines; }
  lines.push(`_Authority: ${plan.authority ?? 'proposal'} · Run state: ${plan.runState ?? '—'}_`);
  const assigned = new Set(plan.steps.flatMap(step => step.agentIds ?? []));
  const jobLine = (job: PlanRecord['agents'][number]) => {
    const progress = agentProgress(job), child = job.childThreadId ? model.childThreads[job.childThreadId] : undefined;
    return `${escapeInline(redact(job.name, ctx.home))} (${job.status}${progress === null ? '' : `, ${progress}%`})${job.summary || job.error ? ' — ' + escapeInline(redact(job.summary ?? job.error ?? '', ctx.home)) : ''}${child ? `; child thread “${escapeInline(redact(child.title, ctx.home))}” (${child.status})` : ''}`;
  };
  plan.steps.forEach((step, index) => {
    lines.push(`${index + 1}. **[${step.state ?? step.status}] ${escapeInline(redact(step.title, ctx.home))}**${step.objective ? ' — ' + escapeInline(redact(step.objective, ctx.home)) : ''}`);
    if (step.details) lines.push(`   - Details: ${redact(step.details, ctx.home).replace(/\r?\n/g, ' ')}`);
    if (step.result) lines.push(`   - Result: ${escapeInline(redact(step.result, ctx.home))}`);
    if (step.outputs?.length) lines.push(`   - Outputs: ${step.outputs.map(output => escapeInline(redact(output.label, ctx.home))).join(', ')}`);
    if (step.checks?.length) {
      const mark = (status: string) => status.endsWith('_passed') ? '✔' : status.endsWith('_failed') ? '✖' : '○';
      lines.push(`   - Checks: ${step.checks.map(check => `${mark(check.status)} ${check.status} ${escapeInline(redact(check.label, ctx.home))}${check.details ? ' — ' + escapeInline(redact(check.details, ctx.home)) : ''}`).join('; ')}`);
    }
    if (step.blockers?.length) lines.push(`   - Blockers: ${step.blockers.map(blocker => escapeInline(redact(blocker, ctx.home))).join('; ')}`);
    if (step.dependsOn?.length) lines.push(`   - Depends on: ${step.dependsOn.map(escapeInline).join(', ')}`);
    if (step.requirements.length) lines.push(`   - Requirements: ${step.requirements.map(requirement => `[${requirement.completed ? 'x' : ' '}] ${escapeInline(redact(requirement.label, ctx.home))}`).join(', ')}`);
    const jobs = (step.agentIds ?? []).map(id => plan.agents.find(job => job.id === id)).filter((job): job is PlanRecord['agents'][number] => Boolean(job));
    if (jobs.length) lines.push(`   - Agents: ${jobs.map(jobLine).join('; ')}`);
  });
  const ungrouped = plan.agents.filter(job => !assigned.has(job.id));
  if (ungrouped.length) lines.push(`- Ungrouped agents: ${ungrouped.map(jobLine).join('; ')}`);
  return lines;
}

function fenced(label: string, json: unknown, ctx: { home?: string }): string[] {
  const text = truncate(redact(JSON.stringify(json, null, 2) ?? 'null', ctx.home), FIELD_MAX_BYTES), fence = fenceFor(text);
  return [label, `${fence}json`, text, fence];
}

function resourceLines(resource: ResourceGrant, ctx: { home?: string }): string[] {
  const base = (resource.path.split(/[\\/]/).filter(Boolean).pop()) ?? resource.label;
  const heading = resource.kind === 'attachment' ? `### Attachment · ${escapeInline(redact(resource.label, ctx.home))}` : `### Resource · ${escapeInline(redact(resource.label, ctx.home))} (${resource.kind})`;
  return [heading, `File: ${escapeInline(redact(base, ctx.home))}`];
}

function contextLine(message: Message, ctx: { home?: string }): string | null {
  if (!message.sourceRefs?.length) return null;
  const parts = message.sourceRefs.map(ref => {
    const locator = ref.source;
    if (locator.kind === 'FILE_RANGE') return `file \`${escapeInline(redact(locator.path ?? locator.sourceId, ctx.home))}\` L${locator.range.startLine}–${locator.range.endLine}`;
    if (locator.kind === 'DIFF_HUNK') return `diff \`${escapeInline(redact(locator.path, ctx.home))}\` L${locator.range.startLine}–${locator.range.endLine}`;
    if (locator.kind === 'ARTIFACT_REGION') return `artifact ${escapeInline(locator.sourceId)} ${escapeInline(locator.binding)}`;
    return `message ${escapeInline(locator.sourceId)}`;
  });
  return `_Context: ${parts.join('; ')}_`;
}

/** v1 format: messages verbatim, one `<details>` block per activity run, plans at
 * their timeline positions, records summarized, memory appended. Read-only input. */
export function renderThreadMarkdown(model: ThreadExportModel, options: { home?: string } = {}): string {
  const ctx = { home: options.home };
  const out: string[] = [FORMAT_MARKER, `# ${escapeInline(redact(model.thread.title, ctx.home))}`, '',
    '| | |', '|---|---|',
    `| Project | ${escapeInline(redact(model.thread.projectName ?? '—', ctx.home))} |`,
    `| Model | ${escapeInline(redact(model.thread.modelId ?? '—', ctx.home))} (thinking: ${escapeInline(model.thread.thinkingLevel ?? 'default')}) |`,
    `| Mode | ${model.thread.mode ?? 'build'} |`,
    `| Status | ${model.thread.status} |`,
    `| Created | ${iso(model.thread.createdAt)} |`,
    `| Updated | ${iso(model.thread.updatedAt)} |`,
    `| Messages | ${model.timeline.filter(entry => entry.kind === 'message').length} |`,
    `| Exported | ${model.exportedAt} by Gen V1 ${escapeInline(model.version)} |`, ''];
  if (model.runInProgress) out.push('> Run in progress at export time.', '');
  out.push('---', '');
  if (!model.timeline.length) out.push('_No messages._', '');
  const activity: Message[] = [];
  const flushActivity = () => {
    if (!activity.length) return;
    out.push(`<details><summary>Tool activity (${activity.length})</summary>`, '');
    for (const item of activity) out.push(`- ${timeOf(item.createdAt)} \`${escapeInline(redact(item.content, ctx.home))}\``);
    out.push('', '</details>', '');
    activity.length = 0;
  };
  for (const entry of model.timeline) {
    if (entry.kind === 'message' && entry.message.role === 'activity') { activity.push(entry.message); continue; }
    flushActivity();
    switch (entry.kind) {
      case 'message': {
        const message = entry.message;
        out.push(`## ${message.role === 'user' ? 'User' : 'Assistant'} · ${message.createdAt}`, redact(message.content, ctx.home));
        const context = contextLine(message, ctx);
        if (context) out.push(context);
        out.push('');
        break;
      }
      case 'plan': out.push(...planLines(entry.plan, entry.revision, model, ctx), ''); break;
      case 'operation': {
        const operation = entry.operation;
        out.push(`### Operation · ${escapeInline(operation.kind)} · ${operation.status}`,
          `${redact(operation.description, ctx.home)}  (approved: ${operation.approved ? 'yes' : 'no'})`,
          ...fenced('Args:', operation.args, ctx));
        if (operation.error) out.push(`Error: ${redact(operation.error, ctx.home)}`);
        else if (operation.result !== undefined) out.push(...fenced('Result:', operation.result, ctx));
        out.push('');
        break;
      }
      case 'toolEffect': {
        const effect = entry.effect;
        out.push(`### Tool effect · ${escapeInline(effect.toolId)} · ${effect.state}`, redact(effect.publicRedactedSummary, ctx.home));
        if (effect.transitions?.length) out.push(`Transitions: ${effect.transitions.map(item => `${item.to} (${item.at})`).join(' → ')}`);
        if (effect.outcome?.error) out.push(`Error: ${redact(effect.outcome.error, ctx.home)}`);
        out.push('');
        break;
      }
      case 'request': {
        const request = entry.request;
        out.push(`### Input request · ${escapeInline(redact(request.title, ctx.home))} · ${request.status}`, redact(request.prompt, ctx.home));
        if (request.response !== undefined) out.push(...fenced('Response:', request.response, ctx));
        out.push('');
        break;
      }
      case 'artifact': {
        const artifact = entry.artifact;
        out.push(`### Artifact · ${escapeInline(redact(artifact.title, ctx.home))} (${artifact.kind})`,
          `${redact(artifact.purpose, ctx.home)} — Interactive artifact; not exported.`, '');
        break;
      }
      case 'resource': out.push(...resourceLines(entry.resource, ctx), ''); break;
    }
  }
  flushActivity();
  if (model.memory.length) {
    out.push('---', '## Task memory', '');
    for (const item of model.memory) out.push(`- **${escapeInline(redact(item.key, ctx.home))}** (${item.author}, rev ${item.revision}): ${redact(item.content, ctx.home)}`);
    out.push('');
  }
  return out.join('\n').replace(/\n+$/, '') + '\n';
}
