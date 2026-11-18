import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolEffectRecord } from '../packages/contracts/tool-effects.ts';
import { Store } from '../packages/storage/store.ts';
import { ToolEffectReadModels } from '../packages/core/tool-effect-read-models.ts';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const stop of cleanup.splice(0)) stop(); });
function fixture(count = 2) {
  const root = mkdtempSync(join(tmpdir(), 'tool-snapshot-'));
  const store = new Store(root), reader = new ToolEffectReadModels(store);
  cleanup.push(() => { reader.dispose(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const thread = { id: 't1', accountId: 'a1', projectId: 'p1', workspaceId: 'w1' };
  store.internal('fixture.thread', thread.id, () => store.put('thread', thread.id, thread.id, thread));
  const add = (id: string) => {
    const effect: ToolEffectRecord = {
      effectId: `eff-${id}`, invocationId: id, attemptId: 1, parentInvocationId: null,
      owner: { threadId: 't1', runId: 'run1', epoch: 1, accountBinding: 'a1', projectId: 'p1', workspaceId: 'w1' },
      threadId: 't1', toolId: 'fixture.read', definitionDigest: 'a'.repeat(64), privateArgumentCommitment: 'b'.repeat(64),
      publicRedactedSummary: id, targetPreconditions: [], approvalId: null, state: 'DISPATCHED', providerReceiptRef: null,
      createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z', transitions: [],
    };
    store.internal('toolEffect.admitted', 't1', () => {
      store.put('toolEffect', id, 't1', effect);
      return { invocationId: id, state: effect.state };
    });
    return effect;
  };
  const update = (id: string, patch: Partial<ToolEffectRecord>, type = 'toolEffect.settled') => {
    const current = store.get<ToolEffectRecord>('toolEffect', id)!;
    store.internal(type, 't1', () => {
      store.put('toolEffect', id, 't1', { ...current, ...patch });
      return { invocationId: id, state: patch.state ?? current.state };
    });
  };
  for (let i = 1; i <= count; i++) add(`i${i}`);
  const context = reader.context({ threadId: 't1' });
  const page = (cursor?: string, extra: Record<string, unknown> = {}) => reader.invocations({
    threadId: 't1', scopeKey: context.scopeKey, limit: 1, ...(cursor ? { cursor } : {}), ...extra,
  });
  return { store, reader, thread, context, add, update, page };
}
const resync = { code: 'RESYNC_REQUIRED' };

describe('tool effect immutable read snapshots', () => {
  it('pins the first page to the sequence returned when the view opened', () => {
    const x = fixture(1); x.add('new');
    const result = x.page(undefined, { limit: 50 });
    assert.equal(result.sequence, x.context.sequence);
    assert.deepEqual(result.effects.map(e => e.invocationId), ['i1']);
    assert.equal(result.freshness, 'STALE');
  });
  it('does not append newly created effects to later pages', () => {
    const x = fixture(3), first = x.page(); assert.ok(first.nextCursor);
    x.add('late');
    const rest = x.page(first.nextCursor, { limit: 1 }); assert.ok(rest.nextCursor);
    const last = x.page(rest.nextCursor);
    assert.equal(last.sequence, x.context.sequence);
    assert.equal(last.nextCursor, null);
    assert.deepEqual([first.effects[0]?.invocationId, rest.effects[0]?.invocationId, last.effects[0]?.invocationId], ['i1', 'i2', 'i3']);
  });
  it('does not replace a captured pending effect with a future settlement', () => {
    const x = fixture(), first = x.page(); assert.ok(first.nextCursor);
    x.update('i2', { state: 'SUCCEEDED', outcome: { value: 'future-only' } });
    const last = x.page(first.nextCursor);
    assert.equal(last.effects[0]?.state, 'DISPATCHED');
    assert.equal(last.effects[0]?.outcome, undefined);
    const detail = x.reader.observations({ threadId: 't1', scopeKey: x.context.scopeKey, invocationId: 'i2' });
    assert.equal(detail.effect.state, 'DISPATCHED');
    assert.equal(detail.freshness, 'STALE');
    const fresh = x.reader.context({ threadId: 't1' });
    assert.equal(x.reader.observations({ threadId: 't1', scopeKey: fresh.scopeKey, invocationId: 'i2' }).effect.state, 'SUCCEEDED');
  });
  it('replays a valid cursor against the same captured data', () => {
    const x = fixture(), first = x.page(); assert.ok(first.nextCursor);
    const before = x.page(first.nextCursor);
    x.update('i2', { state: 'FAILED', outcome: { error: 'later error' } }); x.add('late');
    const after = x.page(first.nextCursor);
    assert.deepEqual(after.effects, before.effects);
    assert.equal(after.sequence, before.sequence);
    assert.equal(after.nextCursor, before.nextCursor);
  });
  it('rejects a cursor reused with a different invocation filter', () => {
    const x = fixture(), first = x.page(); assert.ok(first.nextCursor);
    assert.throws(() => x.page(first.nextCursor!, { invocationId: 'i2' }), resync);
  });
  it('rejects an altered cursor position', () => {
    const x = fixture(), first = x.page(); assert.ok(first.nextCursor);
    const parts = first.nextCursor.split('.');
    const body = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8'));
    body.position = 0;
    const forged = [Buffer.from(JSON.stringify(body)).toString('base64url'), ...parts.slice(1)].join('.');
    assert.throws(() => x.page(forged), resync);
  });
  it.each(['1e309', '0.5'])('rejects an unsigned non-safe position %s', value => {
    const x = fixture();
    const cursor = Buffer.from(`{"scope":"${x.context.scopeKey}","position":${value}}`).toString('base64url');
    assert.throws(() => x.page(cursor), resync);
  });
  it('emits one record when a later deny transition uses the same invocation ID', () => {
    const x = fixture(); x.update('i1', { state: 'DENIED' }, 'toolEffect.denied');
    const context = x.reader.context({ threadId: 't1' });
    const ids: string[] = []; let cursor: string | undefined;
    for (let attempts = 0; attempts < 10; attempts++) {
      const result = x.reader.invocations({ threadId: 't1', scopeKey: context.scopeKey, limit: 1, cursor });
      ids.push(...result.effects.map(e => e.invocationId));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    assert.deepEqual(ids, ['i1', 'i2']);
  });
  it('keeps an empty captured view empty when new effects arrive', () => {
    const x = fixture(0); x.add('late');
    assert.deepEqual(x.page().effects, []);
    assert.throws(() => x.reader.observations({ threadId: 't1', scopeKey: x.context.scopeKey, invocationId: 'late' }), { code: 'NOT_FOUND' });
  });
  it('does not expose mutable references into the saved snapshot', () => {
    const x = fixture(1), first = x.page();
    first.effects[0]!.publicRedactedSummary = 'caller changed it';
    first.effects[0]!.owner.workspaceId = 'caller-workspace';
    assert.equal(x.page().effects[0]?.publicRedactedSummary, 'i1');
    assert.equal(x.page().effects[0]?.owner.workspaceId, 'w1');
  });
  it('still revokes a view after its owner moves to another account', () => {
    const x = fixture();
    x.store.internal('fixture.move', 't1', () => x.store.put('thread', 't1', 't1', { ...x.thread, accountId: 'other' }));
    assert.throws(() => x.page(), resync);
  });
  it('still excludes a receipt whose current owner no longer matches the scope', () => {
    const x = fixture(1), current = x.store.get<ToolEffectRecord>('toolEffect', 'i1')!;
    x.update('i1', { owner: { ...current.owner, accountBinding: 'other' } });
    assert.deepEqual(x.page().effects, []);
    assert.throws(() => x.reader.observations({ threadId: 't1', scopeKey: x.context.scopeKey, invocationId: 'i1' }), { code: 'NOT_FOUND' });
  });
  it('rejects a cursor from another scope', () => {
    const x = fixture(), first = x.page(); assert.ok(first.nextCursor);
    const other = x.reader.context({ threadId: 't1' });
    assert.throws(() => x.reader.invocations({ threadId: 't1', scopeKey: other.scopeKey, limit: 1, cursor: first.nextCursor }), resync);
  });
  it('pins approval metadata without turning a historical approval into current authority', () => {
    const x = fixture(1);
    const owner = x.store.get<ToolEffectRecord>('toolEffect', 'i1')!.owner;
    const approval = { approvalId: 'ap1', operationId: 'op1', actionCommitment: 'c'.repeat(64), owner,
      targetPreconditions: [], issuedAt: '2026-11-17T00:00:00Z', expiresAt: '2026-11-17T00:15:00Z',
      remainingUses: 1, issuer: 'authenticated_user' };
    x.store.internal('fixture.approval', 't1', () => x.store.put('approval', 'ap1', 't1', approval));
    x.update('i1', { approvalId: 'ap1' });
    const captured = x.reader.context({ threadId: 't1' });
    x.store.internal('fixture.consume', 't1', () => x.store.put('approval', 'ap1', 't1', { ...approval, remainingUses: 0 }));
    const old = x.reader.observations({ threadId: 't1', scopeKey: captured.scopeKey, invocationId: 'i1' });
    assert.equal(old.approval?.remainingUses, 1);
    assert.equal(old.freshness, 'STALE');
    const fresh = x.reader.context({ threadId: 't1' });
    assert.equal(x.reader.observations({ threadId: 't1', scopeKey: fresh.scopeKey, invocationId: 'i1' }).approval?.remainingUses, 0);
  });
  it('does not release a captured approval after its current owner binding changes', () => {
    const x = fixture(1), owner = x.store.get<ToolEffectRecord>('toolEffect', 'i1')!.owner;
    const approval = { approvalId: 'ap1', operationId: 'op1', actionCommitment: 'c'.repeat(64), owner,
      targetPreconditions: [], issuedAt: '', expiresAt: '', remainingUses: 0, issuer: 'authenticated_user' };
    x.store.internal('fixture.approval', 't1', () => x.store.put('approval', 'ap1', 't1', approval));
    x.update('i1', { approvalId: 'ap1' });
    const captured = x.reader.context({ threadId: 't1' });
    x.store.internal('fixture.moveApproval', 't1', () => x.store.put('approval', 'ap1', 't1', { ...approval, owner: { ...owner, accountBinding: 'other' } }));
    assert.equal(x.reader.observations({ threadId: 't1', scopeKey: captured.scopeKey, invocationId: 'i1' }).approval, null);
  });
  it('refuses an oversized snapshot explicitly instead of publishing a partial cut', () => {
    const x = fixture(1);
    x.update('i1', { outcome: { value: 'x'.repeat(16 * 1024 * 1024) } });
    assert.throws(() => x.reader.context({ threadId: 't1' }), { code: 'LEDGER_SNAPSHOT_LIMIT' });
    assert.equal(x.page().effects[0]?.outcome, undefined);
  });
  it('expires evicted scopes and all scopes after dispose', () => {
    const x = fixture(1);
    for (let i = 0; i < 512; i++) x.reader.context({ threadId: 't1' });
    assert.throws(() => x.page(), resync);
    const fresh = x.reader.context({ threadId: 't1' });
    x.reader.dispose();
    assert.throws(() => x.reader.invocations({ threadId: 't1', scopeKey: fresh.scopeKey }), resync);
  });

});
