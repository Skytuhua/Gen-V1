import {afterEach, expect, it, vi} from 'vitest';
import {mkdtempSync, realpathSync, lstatSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {createHash} from 'node:crypto';
import {Store} from '../packages/storage/store.ts';
import {HarnessError, type Message, type Thread} from '../packages/contracts/index.ts';
import {ConversationReadModels} from '../packages/core/conversation-read-models.ts';

const cleanup: (() => void)[] = [];
afterEach(() => {for (const close of cleanup.splice(0).reverse()) close();});
function fixture() {
  const base = realpathSync(tmpdir()), dir = mkdtempSync(join(base, 'conversation-reads-')), store = new Store(dir);
  const thread: Thread = {id: 'main', title: 'Actual empty draft', projectId: 'project', projectName: 'Personal project', createdAt: '2026-11-06T00:00:00Z', updatedAt: '2026-11-06T00:00:00Z', epoch: 7, runId: null, status: 'ready', modelId: 'test/model', sessionPath: 'PRIVATE_SESSION', accountId: 'PRIVATE_ACCOUNT'};
  store.internal('fixture', 'main', () => {
    store.put('workspaceProject', 'project', null, {id: 'project', name: 'Personal project', authority: {kind: 'local'}, rootPath: 'PRIVATE_PATH'});
    store.put('workspaceProject', 'company', null, {id: 'company', name: 'PRIVATE_COMPANY', authority: {kind: 'plugin', pluginId: 'company'}});
    for (const id of ['main', 'other']) store.put('thread', id, id, {...thread, id, privateUnknown: 'PRIVATE_UNKNOWN'});
    store.put('thread', 'company', 'company', {...thread, id: 'company', projectId: 'company'});
    store.put('thread', 'delegate', 'delegate', {...thread, id: 'delegate', kind: 'delegate', parentThreadId: 'main'});
    store.put('thread', 'side', 'side', {...thread, id: 'side', kind: 'side', sideParentId: 'main', parentThreadId: 'main'});
  });
  const reads = new ConversationReadModels(store);
  cleanup.push(() => {reads.dispose(); store.close(); if (resolve(dir) !== realpathSync(dir) || !dir.startsWith(base + sep) || lstatSync(dir).isSymbolicLink()) throw Error('Unsafe fixture cleanup'); rmSync(dir, {recursive: true, force: true, maxRetries: 5});});
  const target = {authority: 'personal' as const, threadId: 'main'};
  const putThread = (id: string, patch: Partial<Thread>, index = id) => store.internal('thread.changed', id, () => store.put('thread', id, index, {...store.get<Thread>('thread', id)!, ...patch}));
  const message = (id: string, content: string, threadId = 'main', patch: Partial<Message> = {}, index = threadId) => store.internal('runtime.assistant.delta', threadId, () => store.put('message', id, index, {id, threadId, content, role: 'assistant', createdAt: '2026-11-06T00:00:00Z', runId: 'old-run', ...patch}));
  const scope = () => ({...target, scopeKey: reads.context(target).scopeKey});
  return {store, reads, target, thread, putThread, message, scope};
}

it('projects an actual empty Personal owner without requiring Agent inventory or exposing private fields', () => {
  const f = fixture(), sequence = f.store.sequence;
  const context = f.reads.context(f.target);
  expect(context.owner).toEqual({threadId: 'main', title: 'Actual empty draft', projectId: 'project', projectName: 'Personal project', epoch: 7, runId: null, status: 'ready', modelId: 'test/model'});
  expect(context).toMatchObject({authority: 'personal', sequence, readOnly: false, archived: false, researchEligible: true});
  expect(JSON.stringify(context)).not.toMatch(/PRIVATE_|sessionPath|accountId/);
  expect(f.store.sequence).toBe(sequence);
  expect(f.reads.history({...f.target, scopeKey: context.scopeKey})).toMatchObject({messages: [], nextCursor: null});
});

it('rejects Company, delegates, missing project authority and unknown authority at the boundary', () => {
  const f = fixture();
  for (const threadId of ['company', 'delegate', 'missing']) expect(() => f.reads.context({...f.target, threadId})).toThrow(HarnessError);
  expect(() => f.reads.context({...f.target, authority: 'company'})).toThrow();
  f.putThread('main', {projectId: 'missing-project'});
  expect(() => f.reads.context(f.target)).toThrow(/unavailable/i);
});

it('allows a projectless Personal owner but rejects malformed epoch rather than inventing one', () => {
  const f = fixture(); f.putThread('main', {projectId: undefined, projectName: null});
  expect(f.reads.context(f.target).owner).toMatchObject({projectId: null, epoch: 7});
  f.putThread('main', {epoch: undefined});
  expect(() => f.reads.context(f.target)).toThrow();
});

it('does not coerce SQLite JSON booleans into a fabricated epoch zero or numbers into titles', () => {
  const f = fixture(); f.putThread('main', {epoch: false as never});
  expect(() => f.reads.context(f.target)).toThrow(/unavailable/i);
  f.putThread('main', {epoch: 7, title: 123 as never});
  expect(() => f.reads.context(f.target)).toThrow(/unavailable/i);
});

it('checks exact indexed thread and project identities rather than trusting JSON body identity', () => {
  const f = fixture(); f.putThread('main', {id: 'other'});
  expect(() => f.reads.context(f.target)).toThrow(/unavailable/i);
  f.putThread('main', {id: 'main'}, 'other');
  expect(() => f.reads.context(f.target)).toThrow(/unavailable/i);
  f.putThread('main', {}, 'main');
  f.store.internal('workspace.project.changed', null, () => f.store.put('workspaceProject', 'project', null, {id: 'other', authority: {kind: 'local'}}));
  expect(() => f.reads.context(f.target)).toThrow(/unavailable/i);
});

it('rejects malformed parent metadata instead of treating falsy links as a Personal root', () => {
  const f = fixture(); f.putThread('main', {sideParentId: 0 as never});
  expect(() => f.reads.context(f.target)).toThrow(/unavailable/i);
  f.putThread('main', {sideParentId: undefined, parentThreadId: ''});
  expect(() => f.reads.context(f.target)).toThrow(/unavailable/i);
});

it('keeps side transcripts text-only and ineligible for Research with exact Personal parent linkage', () => {
  const f = fixture(), target = {...f.target, threadId: 'side'};
  expect(f.reads.context(target)).toMatchObject({readOnly: true, researchEligible: false, owner: {threadId: 'side', epoch: 7}});
  f.putThread('side', {parentThreadId: 'other'});
  expect(() => f.reads.context(target)).toThrow(/unavailable/i);
  f.putThread('side', {parentThreadId: 'main'}); f.putThread('main', {projectId: 'company'});
  expect(() => f.reads.context(target)).toThrow(/unavailable/i);
});

it('requires explicit archived scope and disallows archived Research selection', () => {
  const f = fixture(), active = f.scope();
  f.store.internal('thread.archive', 'main', () => f.store.put('archivedThread', 'main', 'main', true));
  expect(() => f.reads.context(f.target)).toThrow(/unavailable/i);
  expect(() => f.reads.history(active)).toThrow();
  const context = f.reads.context({...f.target, includeArchived: true});
  expect(context).toMatchObject({archived: true, researchEligible: false});
  expect(() => f.reads.history({...f.target, scopeKey: context.scopeKey})).toThrow();
  expect(f.reads.history({...f.target, includeArchived: true, scopeKey: context.scopeKey}).messages).toEqual([]);
});

it('fails closed on malformed archive records and NUL text instead of silently treating them as active or complete', () => {
  const f = fixture();
  f.store.internal('thread.archive', 'main', () => f.store.put('archivedThread', 'main', 'main', 1));
  expect(() => f.reads.context(f.target)).toThrow(/unavailable/i);
  f.store.internal('thread.restore', 'main', () => f.store.remove('archivedThread', 'main'));
  f.message('nul', 'Before\0After');
  expect(() => f.reads.history(f.scope())).toThrow();
});

it('does not revive an old capture after a host revokes and reacquires it', () => {
  const f = fixture(); let active = true;
  const reads = new ConversationReadModels(f.store, {assertHostActive: () => {if (!active) throw new HarnessError('CAPABILITY_DENIED', 'Host revoked');}}); cleanup.push(() => reads.dispose());
  const context = reads.context(f.target), scope = {...f.target, scopeKey: context.scopeKey}; active = false;
  expect(() => reads.history(scope)).toThrow(/revoked/i); active = true;
  expect(() => reads.history(scope)).toThrow(/resync/i);
});

it('pages stable message identities chronologically despite concurrent append and streaming of another message', () => {
  const f = fixture(); for (const id of ['z-first', 'a-second', 'm-third', 'fourth']) f.message(id, id);
  const scope = f.scope(), first = f.reads.history({...scope, limit: 2});
  expect(first.messages.map(m => m.id)).toEqual(['m-third', 'fourth']);
  f.message('new', 'New output'); f.message('fourth', 'Streaming change');
  const older = f.reads.history({...scope, cursor: first.nextCursor!, limit: 2});
  expect(older.messages.map(m => m.id)).toEqual(['z-first', 'a-second']); expect(older.nextCursor).toBeNull();
  expect(first.messages[0].revision).toMatch(/^[a-f0-9]{64}$/);
});

it('withholds messages whose index, body owner or canonical ID disagree', () => {
  const f = fixture(); f.message('valid', 'Visible');
  f.message('wrong-index', 'PRIVATE_INDEX', 'main', {}, 'other');
  f.message('wrong-owner', 'PRIVATE_OWNER', 'other', {}, 'main');
  f.message('wrong-id', 'PRIVATE_ID', 'main', {id: 'valid'});
  const page = f.reads.history(f.scope());
  expect(page.messages.map(m => m.id)).toEqual(['valid']); expect(JSON.stringify(page)).not.toMatch(/PRIVATE_/);
});

it('bounds Unicode content in SQL, continues exactly and rejects same-length replacement', () => {
  const f = fixture(), content = 'a'.repeat(4095) + '😀' + 'b'.repeat(9000); f.message('large', content);
  const scope = f.scope(), first = f.reads.history(scope).messages[0];
  expect(first.content).toBe('a'.repeat(4095) + '😀'); expect(first.contentOffset).toBe(0); expect(first.contentLength).toBe(13096);
  f.message('another', 'Unrelated stream');
  const second = f.reads.content({...scope, cursor: first.nextContentCursor!}).message;
  expect(second).toMatchObject({id: 'large', content: 'b'.repeat(4096), contentOffset: 4096, revision: first.revision});
  let combined = first.content + second.content, cursor = second.nextContentCursor;
  while (cursor) {const next = f.reads.content({...scope, cursor}).message; combined += next.content; cursor = next.nextContentCursor;}
  expect(combined).toBe(content);
  f.message('large', 'c'.repeat(13096));
  expect(() => f.reads.content({...scope, cursor: first.nextContentCursor!})).toThrow(/resync/i);
});

it('rejects tampered, cross-owner, cross-kind, restored-repository and malformed scope cursors', () => {
  const f = fixture(); f.message('large', 'x'.repeat(10000)); f.message('second', 'Two');
  const scope = f.scope(), page = f.reads.history({...scope, limit: 1}), chunk = f.reads.history(scope).messages[0];
  const other = {...f.target, threadId: 'other', scopeKey: f.reads.context({...f.target, threadId: 'other'}).scopeKey};
  expect(() => f.reads.history({...other, cursor: page.nextCursor!})).toThrow(/cursor/i);
  expect(() => f.reads.content({...scope, cursor: page.nextCursor!})).toThrow(/cursor/i);
  expect(() => f.reads.history({...scope, cursor: chunk.nextContentCursor!})).toThrow(/cursor/i);
  expect(() => f.reads.history({...scope, cursor: page.nextCursor! + 'x'})).toThrow(/cursor/i);
  expect(() => f.reads.history({...scope, scopeKey: 'forged'})).toThrow();
  const reopened = new ConversationReadModels(f.store); cleanup.push(() => reopened.dispose());
  expect(() => reopened.history({...scope, cursor: page.nextCursor!})).toThrow(/resync/i);
});

it('rejects a noncanonical signature even when base64 decoding produces the same MAC bytes', () => {
  const f = fixture(); f.message('first', 'One'); f.message('second', 'Two');
  const scope = f.scope(), cursor = f.reads.history({...scope, limit: 1}).nextCursor!;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const alias = cursor.slice(0, -1) + alphabet[alphabet.indexOf(cursor.at(-1)!) + 1];
  expect(Buffer.from(alias.split('.')[1], 'base64url')).toEqual(Buffer.from(cursor.split('.')[1], 'base64url'));
  expect(() => f.reads.history({...scope, cursor: alias})).toThrow(/cursor/i);
});

it.each(['epoch', 'project', 'model', 'account', 'recovery'] as const)('fails closed when captured %s changes', change => {
  const f = fixture(); f.message('large', 'x'.repeat(10000)); const scope = f.scope(), cursor = f.reads.history(scope).messages[0].nextContentCursor!;
  if (change === 'epoch') f.putThread('main', {epoch: 8});
  if (change === 'project') f.putThread('main', {projectId: undefined});
  if (change === 'model') f.putThread('main', {modelId: 'different/model'});
  if (change === 'account') f.putThread('main', {accountId: 'different-account'});
  if (change === 'recovery') f.store.internal('workspace.recovered', null, () => {});
  expect(() => f.reads.history(scope)).toThrow(/resync|unavailable/i);
  expect(() => f.reads.content({...scope, cursor})).toThrow(/resync|unavailable/i);
});

it('retains revocation when Personal authority is removed then restored between reads', () => {
  const f = fixture(), scope = f.scope();
  f.store.internal('workspace.project.changed', null, () => f.store.put('workspaceProject', 'project', null, {id: 'project', authority: {kind: 'plugin', pluginId: 'company'}}));
  f.store.internal('workspace.project.changed', null, () => f.store.put('workspaceProject', 'project', null, {id: 'project', authority: {kind: 'local'}}));
  expect(() => f.reads.history(scope)).toThrow(/resync/i);
  expect(f.reads.context(f.target).researchEligible).toBe(true);
});

it('returns invalidations for only the requested transcript and current compact owner', () => {
  const f = fixture(), context = f.reads.context(f.target), scope = {...f.target, scopeKey: context.scopeKey};
  f.message('foreign', 'PRIVATE_OTHER', 'other');
  const quiet = f.reads.updates({...scope, checkpoint: context.checkpoint});
  expect(quiet).toMatchObject({threadId: 'main', fromSequence: context.sequence, owner: null, transcriptChanged: false});
  f.message('owned', 'Owned'); f.putThread('main', {status: 'working', runId: 'actual-run'});
  const update = f.reads.updates({...scope, checkpoint: quiet.checkpoint});
  expect(update).toMatchObject({threadId: 'main', transcriptChanged: true, owner: {owner: {threadId: 'main', runId: 'actual-run', status: 'working'}}});
  expect(update.owner!.revision).not.toBe(context.revision); expect(JSON.stringify(update)).not.toContain('PRIVATE_OTHER');
  expect(() => f.reads.updates({...scope, checkpoint: quiet.checkpoint + 'x'})).toThrow(/cursor/i);
});

it('requires resync after an unobserved external commit or an expired update checkpoint', () => {
  const f = fixture(), context = f.reads.context(f.target), scope = {...f.target, scopeKey: context.scopeKey};
  for (let i = 0; i < 513; i++) f.store.internal('unrelated', 'other', () => {});
  expect(() => f.reads.updates({...scope, checkpoint: context.checkpoint})).toThrow(/resync/i);
  const fresh = f.reads.context(f.target);
  const writer = new Store(f.store.dataDir);
  try {writer.internal('thread.changed', 'main', () => writer.put('thread', 'main', 'main', {...f.thread, epoch: 9}));} finally {writer.close();}
  expect(() => f.reads.history({...f.target, scopeKey: fresh.scopeKey})).toThrow(/resync/i);
});

it('withholds a captured page if another canonical writer changes authority during its read', () => {
  const f = fixture(); f.message('message', 'Old captured content'); const scope = f.scope(), writer = new Store(f.store.dataDir);
  let changed = false;
  f.store.db.function('gen_conversation_revision', body => {
    if (!changed) {changed = true; writer.internal('thread.changed', 'main', () => writer.put('thread', 'main', 'main', {...f.thread, epoch: 8}));}
    return createHash('sha256').update(String(body)).digest('hex');
  });
  try {expect(() => f.reads.history(scope)).toThrow(/resync/i);} finally {writer.close();}
});

it('reads no Snapshot, broad entities or event payloads even for multi-megabyte messages and progress', () => {
  const f = fixture(); f.message('large', 'x'.repeat(2 * 1024 * 1024));
  for (const method of ['snapshot', 'all', 'get', 'eventsAfter'] as const) vi.spyOn(f.store, method).mockImplementation(() => {throw Error('Broad Store read forbidden');});
  const context = f.reads.context(f.target), scope = {...f.target, scopeKey: context.scopeKey}, page = f.reads.history(scope);
  expect(page.messages[0].content.length).toBe(4096); expect(JSON.stringify(page).length).toBeLessThan(8000);
  expect(f.reads.content({...scope, cursor: page.messages[0].nextContentCursor!}).message.content.length).toBe(4096);
  f.store.internal('operation.progress', 'main', () => {});
  expect(f.reads.updates({...scope, checkpoint: context.checkpoint}).transcriptChanged).toBe(true);
});

it('fails closed after disposal or synchronous host revocation', () => {
  const f = fixture(); let active = true;
  const reads = new ConversationReadModels(f.store, {assertHostActive: () => {if (!active) throw new HarnessError('CAPABILITY_DENIED', 'Host revoked');}}); cleanup.push(() => reads.dispose());
  const context = reads.context(f.target); active = false;
  expect(() => reads.history({...f.target, scopeKey: context.scopeKey})).toThrow(/revoked/i);
  f.reads.dispose(); expect(() => f.reads.context(f.target)).toThrow(/unavailable/i);
});
