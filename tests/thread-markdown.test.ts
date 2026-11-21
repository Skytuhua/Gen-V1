import {expect, it} from 'vitest';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {
  escapeInline, fenceFor, renderThreadMarkdown, slugFilename, truncate,
  MARKDOWN_FIELD_BYTES, type ThreadExportModel,
} from '../packages/core/thread-markdown.ts';
import {redact} from '../packages/core/thread-markdown.ts';

const thread = {id: 'thread-a', title: 'Ship it', projectName: 'Gen V1', createdAt: '2026-11-06T08:00:00.000Z', updatedAt: '2026-11-06T09:30:00.000Z', status: 'completed', epoch: 1, runId: null, modelId: 'claude-4.5', mode: 'build', thinkingLevel: 'high', sessionPath: '/private/session', accountId: '/private/account'} as const;
const message = (id: string, role: 'user' | 'assistant' | 'activity', content: string, createdAt = '2026-11-06T08:01:00.000Z') => ({id, threadId: 'thread-a', role, content, createdAt, runId: null});
const plan = {
  version: 1 as const, title: 'Export plan', run: {runId: 'run-1', epoch: 1}, authority: 'approved' as const, runState: 'running' as const,
  steps: [
    {id: 's-1', title: 'Gather', objective: 'Collect the timeline', status: 'completed' as const, state: 'completed' as const, details: 'detail text', result: 'ok', checks: [{id: 'c-1', label: 'doc renders', status: 'verified_passed' as const}], dependsOn: [], requirements: []},
    {id: 's-2', title: 'Render', status: 'working' as const, blockers: ['waiting on docs'], requirements: [{id: 'r-1', label: 'req', completed: true}], agentIds: ['a-1'], dependsOn: ['s-1']},
  ],
  agents: [{id: 'a-1', commandId: 'cmd-1', taskId: 'task-1', name: 'helper', task: 'assist', status: 'completed' as const, summary: 'done', completedRequirementIds: [], reportedPercent: 100, requirements: [], createdAt: '2026-11-06T08:00:00.000Z', updatedAt: '2026-11-06T08:00:00.000Z'}],
};
const model = (overrides: Partial<ThreadExportModel> = {}): ThreadExportModel => ({
  thread,
  version: '9.9.9',
  exportedAt: '2026-11-07T00:00:00.000Z',
  runInProgress: false,
  timeline: [
    {kind: 'message', value: message('m-1', 'user', 'Please export this thread', '2026-11-06T08:00:00.000Z')},
    {kind: 'message', value: message('a-1', 'activity', 'bash: running tests', '2026-11-06T08:02:00.000Z')},
    {kind: 'message', value: message('a-2', 'activity', 'write: apps/web/x.ts', '2026-11-06T08:02:30.000Z')},
    {kind: 'message', value: message('m-2', 'assistant', 'Done — summary here.', '2026-11-06T08:05:00.000Z')},
    {kind: 'plan', id: 'plan:thread-a@1', revision: 1, value: plan},
    {kind: 'plan', id: 'plan:thread-a@2', revision: 2, value: null},
    {kind: 'operation', value: {id: 'op-1', threadId: 'thread-a', revision: 1, kind: 'write', description: 'Write output', args: {path: 'out.md'}, resourceIds: [], preconditions: {}, status: 'succeeded', approved: true, result: {written: true}, createdAt: '2026-11-06T08:03:00.000Z'}},
    {kind: 'toolEffect', value: {effectId: 'eff-1', invocationId: 'inv-1', attemptId: 1, parentInvocationId: null, threadId: 'thread-a', definitionDigest: 'def-sha', privateArgumentCommitment: 'PRIVATE_arg_commit', toolId: 'bash', state: 'SUCCEEDED' as const, publicRedactedSummary: 'Ran the test suite', targetPreconditions: [], approvalId: null, providerReceiptRef: null, createdAt: '2026-11-06T08:04:00.000Z', updatedAt: '2026-11-06T08:04:30.000Z', owner: {threadId: 'thread-a', runId: 'run-1', epoch: 1, projectId: null, workspaceId: null, accountBinding: null}, transitions: [{from: null, to: 'DISPATCHED' as const, at: '2026-11-06T08:04:00.000Z'}, {from: 'DISPATCHED' as const, to: 'SUCCEEDED' as const, at: '2026-11-06T08:04:30.000Z', note: 'exit 0'}], outcome: {value: {secret: 'never-in-export'}, error: undefined}}},
    {kind: 'request', value: {id: 'req-1', threadId: 'thread-a', artifactId: null, revision: 1, title: 'Proceed?', prompt: 'Apply the change?', responseSchema: {}, basis: [], status: 'accepted', response: {choice: 'yes'}}},
    {kind: 'artifact', value: {id: 'art-1', threadId: 'thread-a', messageId: 'm-2', title: 'Dashboard', purpose: 'Live board', kind: 'widget', revision: 1, spec: null, widget: null, bindings: {}, actions: {}, stateId: 's', lifecycle: 'active', placement: 'inline', pinned: false, catalogVersion: '1', createdAt: '2026-11-06T08:06:00.000Z', updatedAt: '2026-11-06T08:06:00.000Z'}},
    {kind: 'attachment', value: {id: 'res-1', threadId: 'thread-a', kind: 'attachment', path: 'C:/Users/Admin/Documents/notes.pdf', label: 'Spec PDF', writable: false, createdAt: '2026-11-06T08:00:30.000Z'}},
  ],
  memory: [{id: 'mem-1', threadId: 'thread-a', key: 'deploy-key', content: 'Staging deploys need approval', revision: 2, author: 'user', updatedAt: '2026-11-06T08:10:00.000Z'}],
  childThreads: {},
  ...overrides,
});

const GOLDEN = join(__dirname, 'fixtures/thread-export/basic.md');
it('matches the golden document byte for byte', async () => {
  const doc = renderThreadMarkdown(model(), {home: null});
  if (process.env.UPDATE_GOLDEN) { await mkdir(dirname(GOLDEN), {recursive: true}); await writeFile(GOLDEN, doc); }
  const golden = await readFile(GOLDEN, 'utf8').catch(() => {throw Error('Golden missing; regenerate with UPDATE_GOLDEN=1');});
  expect(doc).toBe(golden);
});

it('escapes a fence run longer than the fence', () => {
  expect(fenceFor('```` code')).toBe('`````');
  expect(fenceFor('plain')).toBe('```');
  const doc = renderThreadMarkdown(model({timeline: [{kind: 'operation', value: {id: 'op', threadId: 't', revision: 1, kind: 'x', description: 'd', args: {text: '````ticks'}, resourceIds: [], preconditions: {}, status: 'succeeded', approved: true, createdAt: '2026-11-06T00:00:00.000Z'}}], memory: []}));
  expect(doc).toContain('`````json\n');
  expect(doc).toContain('"text": "````ticks"');
});

it('redacts GitHub tokens, sk- keys and the home directory', () => {
  const secret = 'ghp_' + 'a'.repeat(36);
  expect(redact(`token ${secret} end`, null)).toBe('token [redacted] end');
  expect(redact('sk-' + 'x'.repeat(20), null)).toBe('[redacted]');
  expect(redact('/home/oai/work/a.ts:1', '/home/oai')).toBe('~/work/a.ts:1');
  expect(redact('C:\\Users\\Admin\\file.txt', 'C:/Users/Admin')).toBe('~/file.txt');
});

it('truncates a field over 64KiB without splitting a code point', () => {
  const long = 'x'.repeat(MARKDOWN_FIELD_BYTES) + '🧪'.repeat(10);
  const out = truncate(long);
  expect(Buffer.byteLength(out)).toBeLessThanOrEqual(MARKDOWN_FIELD_BYTES + 30);
  expect(out).toMatch(/… \[truncated \d+ bytes\]$/);
  expect(out).not.toContain('�');
});

it('ends with exactly one trailing newline and no double blank lines at the end', () => {
  const doc = renderThreadMarkdown(model({timeline: [], memory: []}));
  expect(doc.endsWith('\n')).toBe(true);
  expect(doc.endsWith('\n\n')).toBe(false);
  expect(doc).toContain('_No messages._');
});

it('keeps Unicode content intact', () => {
  const doc = renderThreadMarkdown(model({timeline: [{kind: 'message', value: message('m', 'user', 'Emoji 🚀  é')}], memory: []}));
  expect(doc).toContain('Emoji 🚀  é');
});

it('escapes table-breaking and emphasis characters inline', () => {
  expect(escapeInline('a|b<c>d`e*f_g[h]\nx')).toBe('a\\|b&lt;c&gt;d\\`e\\*f\\_g\\[h\\] x');
});

it('derives a safe filename slug', () => {
  expect(slugFilename('My Thread!! /ok', '2026-11-07')).toBe('my-thread-ok-2026-11-07.md');
  expect(slugFilename('!!!', '2026-11-07')).toBe('thread-2026-11-07.md');
  expect(slugFilename('x'.repeat(100), '2026-11-07').length).toBeLessThanOrEqual(60 + '-2026-11-07.md'.length);
});

it('marks a run in progress', () => {
  const doc = renderThreadMarkdown(model({runInProgress: true}));
  expect(doc).toContain('Run in progress');
});

it('renders 5000 messages under two seconds', () => {
  const timeline = Array.from({length: 5000}, (_, index) => ({kind: 'message' as const, value: message(`m-${index}`, 'assistant', `reply ${index} body with *emphasis* and |pipes|`)}));
  const started = Date.now();
  const doc = renderThreadMarkdown(model({timeline, memory: []}));
  expect(Date.now() - started).toBeLessThan(2000);
  expect(doc).toContain('reply 0 ');
  expect(doc).toContain('reply 4999');
});
