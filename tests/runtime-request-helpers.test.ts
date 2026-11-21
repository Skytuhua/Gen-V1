import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { HarnessError, type StartRun } from '../packages/contracts/index.ts';
import { projectContextSystemPrompt } from '../packages/runtime/project-context.ts';
import { projectContextGrantDigest } from '../packages/core/approved-project-context.ts';
import { leadingReceipts } from '../packages/runtime-official/receipts.ts';
import type { ManifestState } from '../packages/runtime-official/manifest.ts';
import type { ApprovedProjectContextV1 } from '../packages/contracts/request-context.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

const startRun = (over: Partial<StartRun> = {}): StartRun => ({
  threadId: 'thread-a', runId: 'run-a', epoch: 3, prompt: 'do it', modelId: 'test/model',
  sessionPath: null, inputId: 'input-1', resources: [], ...over,
});

const instructions = { entries: [], duplicates: [], overlaps: [], exclusions: [], omittedRoots: 0, precedence: '' };
const validContext = (input: StartRun, text = 'Use pnpm.'): ApprovedProjectContextV1 => ({
  version: 1,
  owner: { threadId: input.threadId, runId: input.runId, epoch: input.epoch, modelId: input.modelId, accountId: input.accountId ?? null },
  grantDigest: projectContextGrantDigest(input.resources),
  instructionText: text,
  instructionDigest: sha(text),
  instructions,
});

describe('projectContextSystemPrompt', () => {
  it('returns the system prompt unchanged without approved context', () => {
    expect(projectContextSystemPrompt(startRun(), 'SYS')).toBe('SYS');
    expect(projectContextSystemPrompt(startRun({ approvedProjectContext: undefined }), 'SYS')).toBe('SYS');
  });
  it('appends verified instruction text to the prompt', () => {
    const input = startRun();
    expect(projectContextSystemPrompt({ ...input, approvedProjectContext: validContext(input, 'Rules.') }, 'SYS')).toBe('SYSRules.');
  });
  it('verifies the digest against the actual instruction text', () => {
    const input = startRun();
    const context = { ...validContext(input), instructionDigest: sha('other') };
    expect(() => projectContextSystemPrompt({ ...input, approvedProjectContext: context }, 'S')).toThrowError(HarnessError);
  });
  it.each([
    ['version', (c: ApprovedProjectContextV1) => ({ ...c, version: 2 })],
    ['threadId', (c: ApprovedProjectContextV1) => ({ ...c, owner: { ...c.owner, threadId: 't2' } })],
    ['runId', (c: ApprovedProjectContextV1) => ({ ...c, owner: { ...c.owner, runId: 'r2' } })],
    ['epoch', (c: ApprovedProjectContextV1) => ({ ...c, owner: { ...c.owner, epoch: c.owner.epoch + 1 } })],
    ['modelId', (c: ApprovedProjectContextV1) => ({ ...c, owner: { ...c.owner, modelId: 'm2' } })],
    ['accountId', (c: ApprovedProjectContextV1) => ({ ...c, owner: { ...c.owner, accountId: 'acct' } })],
    ['missing owner', (c: ApprovedProjectContextV1) => ({ ...c, owner: undefined })],
  ])('rejects a context whose %s no longer matches the run', (_name, mutate) => {
    const input = startRun();
    const context = mutate(validContext(input)) as ApprovedProjectContextV1;
    try {
      projectContextSystemPrompt({ ...input, approvedProjectContext: context }, 'S');
      expect.unreachable();
    } catch (error) {
      expect((error as HarnessError).code).toBe('STALE_REQUEST_CONTEXT');
    }
  });
  it('rejects oversized or non-string instruction text', () => {
    const input = startRun();
    const big = { ...validContext(input, 'x'.repeat(65537)) };
    big.instructionDigest = sha(big.instructionText);
    expect(() => projectContextSystemPrompt({ ...input, approvedProjectContext: big }, 'S')).toThrowError(/no longer match native admission/);
    const boundary = { ...validContext(input, 'x'.repeat(65536)) };
    boundary.instructionDigest = sha(boundary.instructionText);
    expect(projectContextSystemPrompt({ ...input, approvedProjectContext: boundary }, 'S')).toHaveLength(1 + 65536);
    const nonString = { ...validContext(input), instructionText: 42 as unknown as string };
    expect(() => projectContextSystemPrompt({ ...input, approvedProjectContext: nonString }, 'S')).toThrowError(/no longer match native admission/);
  });
  it('rejects a grant digest that does not match the run resources', () => {
    const resource = { id: 'r1', threadId: 'thread-a', kind: 'file' as const, path: '/w/AGENTS.md', label: 'a', writable: false, createdAt: 't' };
    const input = startRun({ resources: [resource] });
    expect(projectContextSystemPrompt({ ...input, approvedProjectContext: validContext(input) }, 'S')).toBe('SUse pnpm.');
    const wrong = { ...validContext(input), grantDigest: sha('other') };
    expect(() => projectContextSystemPrompt({ ...input, approvedProjectContext: wrong }, 'S')).toThrowError(/no longer match native admission/);
    // Same context validated against different resources must fail too.
    const otherInput = startRun({ resources: [resource, { ...resource, id: 'r2' }] });
    expect(() => projectContextSystemPrompt({ ...otherInput, approvedProjectContext: validContext(input) }, 'S')).toThrowError(/no longer match native admission/);
  });
  it('treats a null accountId distinctly from a bound account', () => {
    const bound = startRun({ accountId: 'acct-1' });
    const context = validContext(bound);
    expect(() => projectContextSystemPrompt({ ...startRun(), approvedProjectContext: context }, 'S')).toThrowError(/no longer match native admission/);
  });
});

const manifest = (inputs: ManifestState['value']['inputs'], threadId = 'thread-a'): ManifestState => ({
  path: '/data/official/claude-code/tasks/x/session.json', dataDir: '/data',
  value: { version: 1, provider: 'claude-code', threadId, sessionId: 'sess-1', inputs },
});

const markerText = (over: Record<string, unknown> = {}, body = 'user text') =>
  '[harness-input:v1] ' + JSON.stringify({ inputId: 'in-1', inputIds: ['in-1', 'in-2'], threadId: 'thread-a', runId: 'run-a', epoch: 4, ...over }) + '\n' + body;

describe('leadingReceipts', () => {
  const inputs = {
    'uuid-1': { inputIds: ['in-1', 'in-2'], runId: 'run-a', epoch: 4, observed: true },
    'uuid-2': { inputIds: ['in-1', 'in-2'], runId: 'run-b', epoch: 4, observed: false },
    'uuid-3': { inputIds: ['different'], runId: 'run-a', epoch: 4, observed: true },
    'uuid-4': { inputIds: ['in-1', 'in-2'], runId: 'run-a', epoch: 5, observed: true },
  };
  it('returns only receipts matching the marker run, epoch and input IDs', () => {
    expect(leadingReceipts(manifest(inputs), markerText())).toEqual([{ uuid: 'uuid-1', inputIds: ['in-1', 'in-2'] }]);
  });
  it('reads the marker only when it leads the message', () => {
    expect(leadingReceipts(manifest(inputs), 'prefix ' + markerText())).toEqual([]);
    expect(leadingReceipts(manifest(inputs), 'hello\n' + markerText())).toEqual([]);
    expect(leadingReceipts(manifest(inputs), markerText().replace('\n', ' '))).toEqual([]);
  });
  it('rejects markers from a different thread', () => {
    expect(leadingReceipts(manifest(inputs), markerText({ threadId: 'other' }))).toEqual([]);
  });
  it.each([
    [{ inputId: '' }],
    [{ inputIds: [] }],
    [{ inputIds: ['in-2', 'in-1'] }],
    [{ inputIds: ['in-1', 7] }],
    [{ epoch: 'x' }],
    [{ epoch: 1.5 }],
    [{ runId: 42 }],
    [{ threadId: null }],
  ])('rejects malformed marker %j', over => {
    expect(leadingReceipts(manifest(inputs), markerText(over as Record<string, unknown>))).toEqual([]);
  });
  it('defaults inputIds to the lone inputId', () => {
    const single = '[harness-input:v1] ' + JSON.stringify({ inputId: 'solo', threadId: 'thread-a', runId: 'run-a', epoch: 4 }) + '\nbody';
    expect(leadingReceipts(manifest({ u: { inputIds: ['solo'], runId: 'run-a', epoch: 4, observed: true } }), single)).toEqual([{ uuid: 'u', inputIds: ['solo'] }]);
  });
  it('ignores non-JSON marker payloads', () => {
    expect(leadingReceipts(manifest(inputs), '[harness-input:v1] not-json\nbody')).toEqual([]);
  });
  it('returns no receipts when the inputs map is empty', () => {
    expect(leadingReceipts(manifest({}), markerText())).toEqual([]);
  });
});
