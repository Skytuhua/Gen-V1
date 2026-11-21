import { describe, expect, it } from 'vitest';
import type { ArtifactRecord, InputRequest, Message, Operation, ResourceGrant, TaskMemory, Thread, ToolEffectRecord } from '../packages/contracts/index.ts';
import type { PlanRecord } from '../packages/contracts/planning.ts';
import type { SourceRefV1 } from '../packages/contracts/source-selection.ts';
import { escapeInline, fenceFor, redact, renderThreadMarkdown, slugFilename, truncate, type ThreadExportModel } from '../packages/core/thread-markdown.ts';

const thread: Thread = { id: 't-1', title: 'Export demo', projectName: 'Demo project', createdAt: '2026-11-21T03:00:00Z', updatedAt: '2026-11-21T04:00:00Z', status: 'ready', epoch: 1, runId: null, modelId: 'anthropic/claude-sonnet', sessionPath: null, mode: 'build', thinkingLevel: 'high' };
const msg = (id: string, role: Message['role'], content: string, createdAt: string): Message => ({ id, threadId: 't-1', role, content, createdAt, runId: null });
const requirement = (id: string, label: string, completed = false) => ({ id, label, completed });
const planV1: PlanRecord = { version: 1, title: 'First revision', steps: [{ id: 's1', title: 'Scaffold', status: 'completed', requirements: [requirement('r1', 'It builds', true)] }], agents: [] };
const planV2: PlanRecord = {
  version: 1, title: 'Second revision', authority: 'approved', runState: 'running',
  steps: [{
    id: 's1', title: 'Scaffold', status: 'completed', objective: 'Set up the lane', details: 'Details stay under 4 KiB.', result: 'Done',
    checks: [{ id: 'c1', label: 'Unit tests', status: 'verified_passed' }, { id: 'c2', label: 'Lint', status: 'reported_failed', details: '3 errors' }],
    blockers: ['Waiting on API'], dependsOn: ['s0'], requirements: [requirement('r1', 'It builds', true), requirement('r2', 'Docs updated')], agentIds: ['j1'],
  }],
  agents: [{ id: 'j1', commandId: 'cmd-1', taskId: 'task-1', name: 'Explore parser', task: 'Find the bug', status: 'completed', requirements: [{ id: 'rq1', label: 'Report findings' }], completedRequirementIds: ['rq1'], reportedPercent: null, summary: 'Found the root cause', childThreadId: 'child-1', createdAt: '2026-11-21T03:10:00Z', updatedAt: '2026-11-21T03:11:00Z' }],
};
const operation: Operation = { id: 'op-1', threadId: 't-1', revision: 1, kind: 'file_edit', description: 'Replace the token', args: { path: 'src/a.ts', old: 'x' }, resourceIds: [], preconditions: {}, status: 'failed', approved: true, error: 'File changed since read', createdAt: '2026-11-21T03:14:00Z' };
const effect: ToolEffectRecord = {
  effectId: 'fx-1', invocationId: 'inv-1', attemptId: 1, parentInvocationId: null,
  owner: { threadId: 't-1', runId: 'run-1', epoch: 1, projectId: null, workspaceId: null, accountBinding: null },
  toolId: 'bash', definitionDigest: 'digest', privateArgumentCommitment: 'commitment', publicRedactedSummary: 'Ran `pnpm test`', targetPreconditions: [], approvalId: null, state: 'SUCCEEDED', providerReceiptRef: null, createdAt: '2026-11-21T03:14:01Z', updatedAt: '2026-11-21T03:14:05Z',
  threadId: 't-1',
  transitions: [{ from: null, to: 'PREPARED', at: '2026-11-21T03:14:01Z' }, { from: 'PREPARED', to: 'DISPATCHED', at: '2026-11-21T03:14:02Z' }, { from: 'DISPATCHED', to: 'SUCCEEDED', at: '2026-11-21T03:14:05Z' }],
};
const request: InputRequest = { id: 'req-1', threadId: 't-1', artifactId: null, revision: 1, title: 'Choose approach', prompt: 'Which fix should land?', responseSchema: {}, basis: [], status: 'accepted', response: { choice: 'A' } };
const artifact: ArtifactRecord = { id: 'art-1', threadId: 't-1', messageId: 'm-2', title: 'Coverage chart', purpose: 'Shows coverage', kind: 'widget', revision: 1, spec: null, widget: null, bindings: {}, actions: {}, stateId: 'state', lifecycle: 'active', placement: 'inline', pinned: false, catalogVersion: '1', createdAt: '2026-11-21T03:15:00Z', updatedAt: '2026-11-21T03:15:00Z' };
const attachment: ResourceGrant = { id: 'res-1', threadId: 't-1', kind: 'attachment', path: 'C:\\Users\\leo\\notes\\design.pdf', label: 'design.pdf', writable: false, createdAt: '2026-11-21T03:16:00Z' };
const memory: TaskMemory = { id: 'mem-1', threadId: 't-1', key: 'preference', content: 'Keep commits small', revision: 2, author: 'user', updatedAt: '2026-11-21T03:17:00Z' };

function model(overrides: Partial<ThreadExportModel> = {}): ThreadExportModel {
  return {
    thread, version: '1.2.3', exportedAt: '2026-11-21T05:00:00Z', runInProgress: false,
    timeline: [
      { kind: 'message', message: msg('u-1', 'user', 'Please fix the bug', '2026-11-21T03:12:09Z') },
      { kind: 'message', message: msg('a-1', 'activity', 'bash: running', '2026-11-21T03:12:16Z') },
      { kind: 'message', message: msg('a-2', 'activity', 'read: done', '2026-11-21T03:12:20Z') },
      { kind: 'message', message: msg('m-2', 'assistant', 'Done — the fix is in `store.ts`.', '2026-11-21T03:13:00Z') },
      { kind: 'plan', revision: 1, plan: planV1 },
      { kind: 'plan', revision: 2, plan: planV2 },
      { kind: 'operation', operation },
      { kind: 'toolEffect', effect },
      { kind: 'request', request },
      { kind: 'artifact', artifact },
      { kind: 'resource', resource: attachment },
    ],
    memory: [memory],
    childThreads: { 'child-1': { title: 'Explore parser', status: 'completed' } },
    ...overrides,
  };
}

const order = (text: string, ...needles: string[]) => {
  let at = -1;
  for (const needle of needles) { const next = text.indexOf(needle); expect(next, needle).toBeGreaterThan(at); at = next; }
};

describe('thread markdown export', () => {
  it('renders the complete fixture in the planned order and format', () => {
    const output = renderThreadMarkdown(model());
    expect(output.startsWith('<!-- gen-v1-thread-export v1 -->\n# Export demo\n')).toBe(true);
    expect(output.endsWith('\n') && !output.endsWith('\n\n')).toBe(true);
    expect(output).toContain('| Project | Demo project |');
    expect(output).toContain('| Model | anthropic/claude-sonnet (thinking: high) |');
    expect(output).toContain('| Mode | build |');
    expect(output).toContain('| Messages | 4 |');
    expect(output).toContain('| Exported | 2026-11-21T05:00:00Z by Gen V1 1.2.3 |');
    expect(output).not.toContain('Run in progress');
    order(output,
      '## User · 2026-11-21T03:12:09Z',
      'Please fix the bug',
      '<details><summary>Tool activity (2)</summary>',
      '- 03:12:16Z `bash: running`',
      '- 03:12:20Z `read: done`',
      '## Assistant · 2026-11-21T03:13:00Z',
      'Done — the fix is in `store.ts`.',
      '### Plan · revision 1 — First revision',
      '### Plan · revision 2 — Second revision',
      '_Authority: approved · Run state: running_',
      '### Operation · file\\_edit · failed',
      '(approved: yes)',
      'Error: File changed since read',
      '### Tool effect · bash · SUCCEEDED',
      'Ran `pnpm test`',
      '### Input request · Choose approach · accepted',
      '### Artifact · Coverage chart (widget)',
      'Interactive artifact; not exported.',
      '### Attachment · design.pdf',
      'File: design.pdf',
      '## Task memory',
      '**preference** (user, rev 2): Keep commits small',
    );
    expect(output).toContain('1. **[completed] Scaffold** — Set up the lane');
    expect(output).toContain('- Checks: ✔ verified_passed Unit tests; ✖ reported_failed Lint — 3 errors');
    expect(output).toContain('- Requirements: [x] It builds, [ ] Docs updated');
    expect(output).toContain('- Agents: Explore parser (completed, 100%) — Found the root cause; child thread “Explore parser” (completed)');
    expect(output).toContain('Transitions: PREPARED (2026-11-21T03:14:01Z) → DISPATCHED (2026-11-21T03:14:02Z) → SUCCEEDED (2026-11-21T03:14:05Z)');
    expect(output).not.toContain('C:\\Users\\leo');
  });

  it('notes an in-progress run and renders message content verbatim', () => {
    const output = renderThreadMarkdown(model({ runInProgress: true, timeline: [{ kind: 'message', message: msg('u-1', 'user', 'line one\n\n```js\nkeep me\n```', '2026-11-21T03:12:09Z') }] }));
    expect(output).toContain('> Run in progress at export time.');
    expect(output).toContain('line one\n\n```js\nkeep me\n```');
  });

  it('starts a new activity block when another entry interrupts the run', () => {
    const output = renderThreadMarkdown(model({ timeline: [
      { kind: 'message', message: msg('a-1', 'activity', 'first', '2026-11-21T03:12:00Z') },
      { kind: 'message', message: msg('a-2', 'activity', 'second', '2026-11-21T03:12:01Z') },
      { kind: 'message', message: msg('m-1', 'assistant', 'reply', '2026-11-21T03:12:02Z') },
      { kind: 'message', message: msg('a-3', 'activity', 'third', '2026-11-21T03:12:03Z') },
    ] }));
    expect(output).toContain('<details><summary>Tool activity (2)</summary>');
    expect(output).toContain('<details><summary>Tool activity (1)</summary>');
  });

  it('renders an unreadable plan revision without dropping it', () => {
    const output = renderThreadMarkdown(model({ timeline: [{ kind: 'plan', revision: 7, plan: null }] }));
    expect(output).toContain('### Plan · revision 7');
    expect(output).toContain('_Plan revision 7 could not be read._');
  });

  it('renders an empty thread as a header plus the placeholder', () => {
    const output = renderThreadMarkdown(model({ timeline: [], memory: [] }));
    expect(output).toContain('_No messages._');
    expect(output).not.toContain('## Task memory');
  });

  it('shows source references as kind and label only', () => {
    const message = { ...msg('u-1', 'user', 'see this', '2026-11-21T03:12:09Z'), sourceRefs: [{ captureId: 'cap-1', keepCaptured: true, source: { kind: 'FILE_RANGE', sourceId: 'src-1', path: 'src/a.ts', sourceRevision: 'rev', logicalOwner: { threadId: 'thread-1', projectId: null, workspaceId: null }, contentDigest: 'a'.repeat(64), capturedAt: '2026-11-21T03:00:00.000Z', range: { encoding: 'LINES_1_BASED', startLine: 10, endLine: 20 } } }] satisfies SourceRefV1[] };
    const output = renderThreadMarkdown(model({ timeline: [{ kind: 'message', message }] }));
    expect(output).toContain('_Context: file `src/a.ts` L10–20_');
  });

  it('fences grow past the longest contained backtick run', () => {
    expect(fenceFor('plain')).toBe('```');
    expect(fenceFor('has ``` inside')).toBe('````');
    expect(fenceFor('has ```` four')).toBe('`````');
    const doc = renderThreadMarkdown(model({ timeline: [{ kind: 'operation', operation: { ...operation, status: 'succeeded', error: undefined, result: { note: 'a ```json fence' } } }] }));
    expect(doc).toContain('````json\n{\n  "note": "a ```json fence"\n}\n````');
  });

  it('escapes inline values in headings and tables', () => {
    expect(escapeInline('a|b<c>d`e*f_g[h]i\nj')).toBe('a\\|b\\<c\\>d\\`e\\*f\\_g\\[h\\]i j');
    const output = renderThreadMarkdown(model({ thread: { ...thread, title: 'a | title' } }));
    expect(output).toContain('# a \\| title');
  });

  it('redacts secrets and home paths, and whole lines that still match', () => {
    expect(redact('open /home/leo/work/file.ts now', '/home/leo')).toBe('open ~/work/file.ts now');
    expect(redact('open C:\\Users\\leo\\docs\\x.txt', 'C:/Users/leo')).toBe('open ~\\docs\\x.txt');
    expect(redact('key is ghp_abcdefghijklmnop1234 ok')).toBe('key is [redacted] ok');
    expect(redact('api_key: supersecretvalue123')).toBe('[redacted line]');
    const output = renderThreadMarkdown(model(), { home: '/home/leo' });
    expect(output).not.toContain('/home/leo');
  });

  it('truncates oversized serialized fields with a byte count', () => {
    const big = { blob: 'x'.repeat(70 * 1024) };
    expect(truncate('abc', 2)).toContain('… [truncated 1 bytes]');
    const output = renderThreadMarkdown(model({ timeline: [{ kind: 'operation', operation: { ...operation, args: big } }] }));
    expect(output).toContain('… [truncated ');
    expect(output.indexOf('… [truncated')).toBeLessThan(70 * 1024);
  });

  it('names files by slug, date and pattern', () => {
    expect(slugFilename('Fix the Bug!', '2026-11-21')).toBe('fix-the-bug-2026-11-21.md');
    expect(slugFilename('   ', '2026-11-21')).toBe('thread-2026-11-21.md');
    expect(slugFilename('x'.repeat(100), '2026-11-21')).toMatch(/^[a-z0-9-]{1,60}-\d{4}-\d{2}-\d{2}\.md$/);
    expect(slugFilename('Ünïcödé title', '2026-11-21')).toMatch(/^[a-z0-9-]{1,60}-2026-11-21\.md$/);
  });

  it('renders 5,000 stored messages inside the export budget', () => {
    const timeline: ThreadExportModel['timeline'] = Array.from({ length: 5000 }, (_, index) => ({ kind: 'message' as const, message: msg(`m-${index}`, index % 3 === 0 ? 'user' : 'assistant', `Message number ${index} with a paragraph of representative content.`, '2026-11-21T03:12:09Z') }));
    const started = performance.now();
    const output = renderThreadMarkdown(model({ timeline, memory: [] }));
    expect(performance.now() - started).toBeLessThan(2000);
    expect(output).toContain('Message number 0');
    expect(output).toContain('Message number 4999');
    expect(output.indexOf('Message number 0')).toBeLessThan(output.indexOf('Message number 4999'));
  });
});
