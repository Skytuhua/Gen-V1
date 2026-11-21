import { afterEach, expect, it, vi } from 'vitest';
import { authorize, buildToolRegistry, ToolAuthority, TOOL_COVERAGE_NOTES } from '../packages/core/tool-authority.ts';
import { actionCommitment, privateArgumentCommitment, publicRedactedSummary, createToolEffectFlags } from '../packages/core/tool-effects.ts';
import { toolDefinitionSchema } from '../packages/contracts/tool-effects.ts';
import type { Operation, Thread } from '../packages/contracts/index.ts';

afterEach(() => vi.restoreAllMocks());

const owner = { threadId: 't1', runId: 'r1', epoch: 1, projectId: 'p1', workspaceId: 'w1', accountBinding: 'acct-1' };
const current = { epoch: 1, runId: 'r1', accountId: 'acct-1', projectId: 'p1', workspaceId: 'w1' };

it('registers every classified host tool exactly once and rejects bad entries', () => {
  const registry = buildToolRegistry();
  const ids = registry.map(entry => entry.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const name of ['repository_read', 'file_replace_prepare', 'task_delegate', 'integration_call', 'operation_execute', 'ui_present', 'task_finish', 'knowledge_publish', 'database_schema', 'database_query'])
    expect(ids).toContain(name);
  for (const name of ['database_schema', 'database_query']) {
    const entry = registry.find(e => e.id === name)!;
    expect(entry).toMatchObject({ risk: 'READ', replayClass: 'READ_RETRYABLE', executorBinding: 'read', approval: 'none', allowedRoles: ['run'] });
  }
  expect(() => new ToolAuthority([...registry, registry[0]])).toThrowError(/Duplicate tool registration/);
  expect(() => toolDefinitionSchema.parse({ ...registry[0], allowedRoles: ['intruder'] })).toThrow();
  expect(() => toolDefinitionSchema.parse({ ...registry[0], risk: 'SOMETIMES' })).toThrow();
  expect(() => authority0().require('not_registered')).toThrowError(/UNREGISTERED_TOOL|not registered/i);
  function authority0() { return new ToolAuthority(registry); }
  expect(TOOL_COVERAGE_NOTES.some(note => note.includes('COVERAGE_GAP'))).toBe(true);
});

it('denies by role, owner revocation, account binding and scope drift', () => {
  const authority = new ToolAuthority(buildToolRegistry());
  const read = authority.require('repository_read');
  const ui = authority.require('ui_present');
  expect(authorize(ui, 'side', owner, current)).toEqual({ kind: 'DENY', reason: 'role_denied' });
  expect(authorize(read, 'run', { ...owner, epoch: 2 }, current)).toEqual({ kind: 'DENY', reason: 'owner_revoked' });
  expect(authorize(read, 'run', { ...owner, runId: 'r2' }, current)).toEqual({ kind: 'DENY', reason: 'owner_revoked' });
  expect(authorize(read, 'run', { ...owner, accountBinding: 'other' }, current)).toEqual({ kind: 'DENY', reason: 'account_mismatch' });
  expect(authorize(read, 'run', { ...owner, workspaceId: 'w2' }, current)).toEqual({ kind: 'DENY', reason: 'scope_changed' });
  expect(authorize(read, 'planning_child', owner, current)).toEqual({ kind: 'ALLOW' });
  expect(authorize(authority.require('agent_progress'), 'run', owner, current)).toEqual({ kind: 'DENY', reason: 'role_denied' });
});

it('requires explicit approval for mutating external bindings only', () => {
  const authority = new ToolAuthority(buildToolRegistry());
  expect(authorize(authority.require('task_delegate'), 'run', owner, current)).toEqual({ kind: 'REQUIRE_APPROVAL', reason: 'approval_required' });
  expect(authorize(authority.require('integration_call'), 'run', owner, current)).toEqual({ kind: 'REQUIRE_APPROVAL', reason: 'approval_required' });
  expect(authorize(authority.require('repository_read'), 'run', owner, current)).toEqual({ kind: 'ALLOW' });
  // Internal session-state writes and operation prepares stay admission-only;
  // the operation approval binds at the dispatch boundary.
  expect(authorize(authority.require('ui_present'), 'run', owner, current)).toEqual({ kind: 'ALLOW' });
  expect(authorize(authority.require('file_replace_prepare'), 'run', owner, current)).toEqual({ kind: 'ALLOW' });
});

it('binds the approval commitment to args, revision, account, workspace and epoch', () => {
  const operation: Operation = { id: 'op1', threadId: 't1', revision: 3, kind: 'file.replace', description: 'x', args: { path: 'a.txt' }, resourceIds: [], preconditions: { sha: 'abc' }, status: 'prepared', approved: true, createdAt: '' };
  const thread = { id: 't1', epoch: 1, runId: 'r1', accountId: 'acct-1', projectId: 'p1', workspaceId: 'w1' } as Thread;
  const base = actionCommitment(operation, thread);
  expect(actionCommitment({ ...operation, args: { path: 'b.txt' } }, thread)).not.toBe(base);
  expect(actionCommitment({ ...operation, revision: 4 }, thread)).not.toBe(base);
  expect(actionCommitment(operation, { ...thread, accountId: 'acct-2' })).not.toBe(base);
  expect(actionCommitment(operation, { ...thread, workspaceId: 'w2' })).not.toBe(base);
  expect(actionCommitment(operation, { ...thread, projectId: 'p2' })).not.toBe(base);
  expect(actionCommitment(operation, { ...thread, epoch: 2 })).not.toBe(base);
});

it('keeps rollout flags finite, host-owned and off by default', () => {
  const flags = createToolEffectFlags();
  expect(flags.snapshot()).toEqual({ 'audit.effectsV1': false, 'security.authorityV1': false });
  expect(() => flags.enabled('user.preferences' as never)).toThrow(/Unknown capability flag/);
  expect(() => createToolEffectFlags({ 'user.preferences': true } as never)).toThrow(/Unknown capability flag/);
});

it('commits arguments privately and redacts secret-looking values publicly', () => {
  const call = { name: 'file_replace_prepare', args: { resourceId: 'r', api_token: 's3cret-value', commandId: 'c1' } };
  const summary = publicRedactedSummary(call);
  expect(summary).not.toContain('s3cret-value');
  expect(summary).toContain('file_replace_prepare');
  expect(privateArgumentCommitment(call)).toBe(privateArgumentCommitment({ name: 'file_replace_prepare', args: { resourceId: 'r', api_token: 's3cret-value', commandId: 'different' } }));
});
