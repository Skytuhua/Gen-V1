import {afterEach, describe, expect, it} from 'vitest';
import {mkdtempSync, realpathSync, lstatSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../packages/storage/store.ts';
import type {Thread} from '../packages/contracts/index.ts';
import {AgentInbox} from '../packages/core/agent-inbox.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

const owner = (threadId: string) => ({threadId, runId: 'run-x', epoch: 1});

function fixture() {
  const base = realpathSync(tmpdir()), directory = mkdtempSync(join(base, 'agent-input-')), store = new Store(directory);
  const inbox = new AgentInbox({store});
  const parent: Thread = {id: 't-parent', title: 'P', projectName: 'proj', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'working', epoch: 1, runId: 'r', modelId: 'm', sessionPath: null, accountId: 'a', projectId: 'p', workspaceId: 'w'};
  const child: Thread = {...parent, id: 't-child', kind: 'delegate', parentThreadId: 't-parent', jobId: 'job-1'};
  store.internal('fixture', 't-parent', () => {store.put('thread', parent.id, parent.id, parent); store.put('thread', child.id, child.id, child);});
  cleanups.push(async () => {store.close(); if (realpathSync(directory) !== resolve(directory) || !directory.startsWith(base + sep) || lstatSync(directory).isSymbolicLink()) throw Error('Unsafe fixture cleanup'); rmSync(directory, {recursive: true, force: true});});
  const input = (over: Record<string, unknown> = {}) => ({inputId: 'in-' + randomUUID().slice(0, 8), taskId: 't-parent', targetOwner: owner('t-child'), kind: 'FOLLOW_UP' as const, text: 'check more', dedupeKey: 'dk-' + randomUUID().slice(0, 8), ...over});
  return {store, inbox, input, parent, child};
}

describe('AgentInputV1 admission and delivery lifecycle', () => {
  it('admits queue-first inputs as ACCEPTED and only adapter acks advance to ENTERED_RUNTIME and HANDLED', () => {
    const f = fixture();
    const record = f.inbox.admit(f.input(), {liveSteer: false});
    expect(record.delivery).toBe('ACCEPTED');
    expect(record.dedupeKey).toBeTruthy();
    expect(record.order).toBe(0);
    f.inbox.markEntered(record.inputId);
    expect(f.inbox.inspect(record.inputId)!.delivery).toBe('ENTERED_RUNTIME');
    f.inbox.markHandled(record.inputId);
    expect(f.inbox.inspect(record.inputId)!.delivery).toBe('HANDLED');
    expect(() => f.inbox.markHandled(record.inputId)).not.toThrow();
  });
  it('one input identity survives retries: resubmitting an identical duplicate returns the same record', () => {
    const f = fixture();
    const spec = f.input({inputId: 'in-1', dedupeKey: 'dk-1'});
    const a = f.inbox.admit(spec, {liveSteer: false});
    const b = f.inbox.admit(spec, {liveSteer: false});
    // Same inputId + dedupeKey + identical content => idempotent replay of the same input identity.
    expect(b).toEqual(a);
    expect(f.inbox.queue('t-child')).toHaveLength(1);
    const c = f.inbox.admit(f.input({inputId: 'in-2', dedupeKey: 'dk-1', text: 'check more'}), {liveSteer: false});
    expect(c.inputId).toBe(a.inputId);
    expect(f.inbox.queue('t-child')).toHaveLength(1);
  });
  it('rejects a conflicting dedupeKey with different content rather than spawning a new input', () => {
    const f = fixture();
    f.inbox.admit(f.input({inputId: 'in-1', dedupeKey: 'dk-1', text: 'first'}), {liveSteer: false});
    const conflict = f.inbox.admit(f.input({inputId: 'in-2', dedupeKey: 'dk-1', text: 'second'}), {liveSteer: false});
    expect(conflict.delivery).toBe('REJECTED');
    expect(conflict.error).toMatch(/dedupe/i);
  });
  it('steering delivers only when the adapter declared live steer; otherwise it queues after current', () => {
    const f = fixture();
    const noSteer = f.inbox.admit(f.input({kind: 'STEER'}), {liveSteer: false});
    expect(noSteer.delivery).toBe('ACCEPTED');
    const admitted = f.inbox.admit(f.input({kind: 'STEER'}), {liveSteer: true});
    expect(admitted.delivery).toBe('ACCEPTED');
    // An adapter without steer support surfaces the capability, never relabels it.
    expect(f.inbox.liveSteerRequired({kind: 'STEER'}, {liveSteer: false})).toBe(true);
    expect(f.inbox.liveSteerRequired({kind: 'FOLLOW_UP'}, {liveSteer: false})).toBe(false);
  });
  it('declares STEER unsupported for adapters lacking steer instead of relabeling as follow-up', () => {
    const f = fixture();
    // Host checks capability before dispatch: steer-capable false means the input queues after current work.
    const record = f.inbox.admit(f.input({kind: 'STEER'}), {liveSteer: false});
    expect(record.kind).toBe('STEER');
    expect(record.delivery).toBe('ACCEPTED');
    expect(f.inbox.queue('t-child')[0].kind).toBe('STEER');
  });
  it('cancels and reorders queue entries only while ACCEPTED', () => {
    const f = fixture();
    const a = f.inbox.admit(f.input({inputId: 'a'}), {liveSteer: false});
    const b = f.inbox.admit(f.input({inputId: 'b'}), {liveSteer: false});
    f.inbox.reorder('t-child', [b.inputId, a.inputId]);
    expect(f.inbox.queue('t-child').map(record => record.inputId)).toEqual(['b', 'a']);
    f.inbox.markEntered(a.inputId);
    expect(() => f.inbox.reorder('t-child', [a.inputId, b.inputId])).toThrow(/order/i);
    expect(() => f.inbox.cancel('t-child', a.inputId)).toThrow();
    f.inbox.cancel('t-child', b.inputId);
    expect(f.inbox.inspect(b.inputId)!.delivery).toBe('REJECTED');
    expect(f.inbox.queue('t-child')).toHaveLength(0);
  });
  it('ambiguous delivery lands UNKNOWN and reconciles only from the native receipt', () => {
    const f = fixture();
    const record = f.inbox.admit(f.input(), {liveSteer: false});
    f.inbox.markUnknown(record.inputId);
    expect(f.inbox.inspect(record.inputId)!.delivery).toBe('UNKNOWN');
    // Native receipt says it entered: reconcile, never blind replay.
    f.inbox.reconcileUnknown(record.inputId, 'entered');
    expect(f.inbox.inspect(record.inputId)!.delivery).toBe('ENTERED_RUNTIME');
    const second = f.inbox.admit(f.input(), {liveSteer: false});
    f.inbox.markUnknown(second.inputId);
    f.inbox.reconcileUnknown(second.inputId, 'notDelivered');
    expect(f.inbox.inspect(second.inputId)!.delivery).toBe('ACCEPTED');
  });
  it('restart rejects un-dispatched inputs and marks dispatched-but-unacked inputs UNKNOWN', () => {
    const f = fixture();
    const queued = f.inbox.admit(f.input(), {liveSteer: false});
    const sent = f.inbox.admit(f.input(), {liveSteer: false});
    f.inbox.markEntered(sent.inputId);
    const fresh = new AgentInbox({store: f.store});
    fresh.recover();
    expect(f.inbox.inspect(queued.inputId)!.delivery).toBe('REJECTED');
    expect(f.inbox.inspect(sent.inputId)!.delivery).toBe('UNKNOWN');
  });
  it('bounding: oversized text and over-full queues are rejected, never truncated', () => {
    const f = fixture();
    const big = f.inbox.admit(f.input({text: 'x'.repeat(9000)}), {liveSteer: false});
    expect(big.delivery).toBe('REJECTED');
    expect(big.error).toMatch(/8/);
    for (let i = 0; i < 8; i++) f.inbox.admit(f.input(), {liveSteer: false});
    const overflow = f.inbox.admit(f.input(), {liveSteer: false});
    expect(overflow.delivery).toBe('REJECTED');
    expect(overflow.error).toMatch(/queue/i);
  });
});

describe('AgentMessageV1 board', () => {
  const sender = {threadId: 't-child', runId: 'run-x', epoch: 1};
  const recipient = {threadId: 't-parent', runId: 'r', epoch: 1};
  it('posts bounded messages between registered owners with a receipt', () => {
    const f = fixture();
    const posted = f.inbox.postMessage(sender, {messageId: 'm1', taskId: 't-parent', recipientOwner: recipient, topic: 'report', text: 'hello'});
    expect(posted.receipt).toMatchObject({status: 'POSTED'});
    f.inbox.deliverMessage('m1');
    expect(f.inbox.messages('t-parent')).toHaveLength(1);
    expect(f.inbox.messages('t-parent')[0]).toMatchObject({receipt: {status: 'DELIVERED'}, text: 'hello'});
  });
  it('rejects spoofed senders, unknown recipients, oversized text and cap overflow', () => {
    const f = fixture();
    expect(() => f.inbox.postMessage({threadId: 'intruder', runId: 'x', epoch: 1}, {messageId: 'm-x', taskId: 't-parent', recipientOwner: recipient, topic: 't', text: 'hi'})).toThrow(/sender/i);
    expect(() => f.inbox.postMessage(sender, {messageId: 'm-y', taskId: 't-parent', recipientOwner: {threadId: 'ghost', runId: null, epoch: 0}, topic: 't', text: 'hi'})).toThrow(/recipient/i);
    expect(() => f.inbox.postMessage(sender, {messageId: 'm-z', taskId: 't-parent', recipientOwner: recipient, topic: 't', text: 'x'.repeat(4097)})).toThrow(/4/);
    for (let i = 0; i < 100; i++) f.inbox.postMessage(sender, {messageId: 'm-' + i, taskId: 't-parent', recipientOwner: recipient, topic: 't', text: 'hi'});
    expect(() => f.inbox.postMessage(sender, {messageId: 'm-over', taskId: 't-parent', recipientOwner: recipient, topic: 't', text: 'hi'})).toThrow(/100/);
  });
  it('artifact-ref messages carry no embedded text and replies chain by messageId', () => {
    const f = fixture();
    const posted = f.inbox.postMessage(sender, {messageId: 'm-art', taskId: 't-parent', recipientOwner: recipient, topic: 'data', artifactRef: {id: 'art-1', revision: 1}});
    expect(posted.text).toBeNull();
    const reply = f.inbox.postMessage(recipient, {messageId: 'm-re', taskId: 't-parent', recipientOwner: sender, topic: 'data', text: 'got it', replyTo: 'm-art'});
    expect(reply.replyTo).toBe('m-art');
    expect(() => f.inbox.postMessage(sender, {messageId: 'm-bad', taskId: 't-parent', recipientOwner: recipient, topic: 't', text: 'hi', replyTo: 'missing'})).toThrow(/replyTo/i);
  });
});
