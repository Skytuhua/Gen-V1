import {Store} from '../storage/store.ts';
import {HarnessError, type Thread} from '../contracts/index.ts';
import {
  AGENT_WORK_LIMITS,
  AgentInputV1Schema,
  AgentMessageV1Schema,
  type AgentInputKind,
  type AgentInputV1,
  type AgentMessageV1,
  type AgentWorkOwner,
} from '../contracts/agent-work.ts';

export interface AgentInputSpec {
  inputId: string;
  taskId: string;
  targetOwner: AgentWorkOwner;
  kind: AgentInputKind;
  text: string;
  dedupeKey: string;
  sourceRefs?: {id: string; revision: number}[];
}

export interface AgentMessageSpec {
  messageId: string;
  taskId: string;
  recipientOwner: AgentWorkOwner;
  topic: string;
  text?: string;
  artifactRef?: {id: string; revision: number};
  replyTo?: string;
  expiresAt?: string;
}

const utf8 = (value: string) => new TextEncoder().encode(value).byteLength;
const INPUT_KIND = 'agentInputV1';
const TEXT_KIND = 'agentInputText';
const MESSAGE_KIND = 'agentMessageV1';

/** Ordered, durable agent input. Acceptance is a queue position, never a
 * delivery claim: only adapter acknowledgements move an input to
 * ENTERED_RUNTIME and HANDLED, and ambiguity resolves from the native
 * receipt rather than a blind replay. */
export class AgentInbox {
  constructor(private readonly hooks: {store: Store}) {}

  liveSteerRequired(spec: Pick<AgentInputSpec, 'kind'>, adapter: {liveSteer: boolean}): boolean {
    return spec.kind === 'STEER' && !adapter.liveSteer;
  }

  admit(spec: AgentInputSpec, adapter: {liveSteer: boolean}): AgentInputV1 {
    const store = this.hooks.store;
    const existing = store.all<AgentInputV1>(INPUT_KIND);
    // One input identity survives retries: an identical resubmission replays.
    for (const record of existing) {
      if (record.dedupeKey !== spec.dedupeKey || record.taskId !== spec.taskId) continue;
      const storedText = store.get<{text: string}>(TEXT_KIND, record.inputId)?.text;
      if (record.inputId === spec.inputId && storedText === spec.text && record.kind === spec.kind
        && record.targetOwner.threadId === spec.targetOwner.threadId) return record;
      if (storedText === spec.text && record.kind === spec.kind && record.targetOwner.threadId === spec.targetOwner.threadId) return record;
      return this.reject(spec, `Dedupe key ${spec.dedupeKey} already bound to different content`);
    }
    if (existing.some(record => record.inputId === spec.inputId)) return this.reject(spec, `Input ${spec.inputId} already exists`);
    if (utf8(spec.text) > AGENT_WORK_LIMITS.inputTextBytes) return this.reject(spec, `Input text must fit within ${AGENT_WORK_LIMITS.inputTextBytes} bytes`);
    if (this.queue(spec.targetOwner.threadId).length >= AGENT_WORK_LIMITS.queuedInputsPerTarget)
      return this.reject(spec, `Input queue for ${spec.targetOwner.threadId} is full (${AGENT_WORK_LIMITS.queuedInputsPerTarget})`);
    this.liveSteerRequired(spec, adapter); // steer with no live steer queues after current; never relabels.
    const now = new Date().toISOString();
    const record: AgentInputV1 = AgentInputV1Schema.parse({
      version: 1,
      inputId: spec.inputId,
      taskId: spec.taskId,
      targetOwner: spec.targetOwner,
      kind: spec.kind,
      textRef: {id: spec.inputId, revision: 1},
      sourceRefs: spec.sourceRefs ?? [],
      createdSeq: store.sequence,
      order: existing.filter(item => item.targetOwner.threadId === spec.targetOwner.threadId).length,
      delivery: 'ACCEPTED',
      dedupeKey: spec.dedupeKey,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    store.internal('agentInput.admit', spec.taskId, () => {
      store.put(INPUT_KIND, record.inputId, spec.taskId, record);
      store.put(TEXT_KIND, record.inputId, spec.taskId, {id: record.inputId, text: spec.text});
    });
    return record;
  }

  private reject(spec: AgentInputSpec, error: string): AgentInputV1 {
    const now = new Date().toISOString();
    const record: AgentInputV1 = AgentInputV1Schema.parse({
      version: 1,
      inputId: spec.inputId,
      taskId: spec.taskId,
      targetOwner: spec.targetOwner,
      kind: spec.kind,
      textRef: {id: spec.inputId, revision: 1},
      sourceRefs: [],
      createdSeq: this.hooks.store.sequence,
      order: 0,
      delivery: 'REJECTED',
      dedupeKey: spec.dedupeKey,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      error: error.slice(0, 1024),
    });
    // A rejection describes this resubmission only. It must never replace an
    // input identity that already holds a queued or delivered record, or the
    // rejected retry would silently delete the caller's pending input.
    if (!this.hooks.store.get(INPUT_KIND, record.inputId)) this.hooks.store.internal('agentInput.reject', spec.taskId, () => this.hooks.store.put(INPUT_KIND, record.inputId, spec.taskId, record));
    return record;
  }

  private transition(inputId: string, from: AgentInputV1['delivery'][], to: AgentInputV1['delivery'], type: string, error?: string): AgentInputV1 {
    const record = this.hooks.store.get<AgentInputV1>(INPUT_KIND, inputId);
    if (!record) throw new HarnessError('INVALID_AGENT_INPUT', `Unknown input ${inputId}`);
    if (record.delivery === to) return record;
    if (!from.includes(record.delivery)) throw new HarnessError('INVALID_AGENT_INPUT', `Input ${inputId} is ${record.delivery}, not ${from.join('|')}`);
    const next: AgentInputV1 = {...record, delivery: to, revision: record.revision + 1, updatedAt: new Date().toISOString(), ...(error ? {error} : {})};
    this.hooks.store.internal(type, record.taskId, () => this.hooks.store.put(INPUT_KIND, inputId, record.taskId, next));
    return next;
  }

  /** Adapter acknowledged entry into the runtime. */
  markEntered(inputId: string): AgentInputV1 { return this.transition(inputId, ['ACCEPTED'], 'ENTERED_RUNTIME', 'agentInput.entered'); }
  /** Adapter acknowledged handling. */
  markHandled(inputId: string): AgentInputV1 { return this.transition(inputId, ['ENTERED_RUNTIME'], 'HANDLED', 'agentInput.handled'); }
  /** Dispatch outcome is ambiguous: hold UNKNOWN until the native receipt. */
  markUnknown(inputId: string): AgentInputV1 { return this.transition(inputId, ['ACCEPTED', 'ENTERED_RUNTIME'], 'UNKNOWN', 'agentInput.unknown'); }

  reconcileUnknown(inputId: string, nativeReceipt: 'entered' | 'notDelivered'): AgentInputV1 {
    const record = this.hooks.store.get<AgentInputV1>(INPUT_KIND, inputId);
    if (!record) throw new HarnessError('INVALID_AGENT_INPUT', `Unknown input ${inputId}`);
    if (record.delivery !== 'UNKNOWN') return record;
    return this.transition(inputId, ['UNKNOWN'], nativeReceipt === 'entered' ? 'ENTERED_RUNTIME' : 'ACCEPTED', 'agentInput.reconciled');
  }

  cancel(targetThreadId: string, inputId: string): void {
    const record = this.hooks.store.get<AgentInputV1>(INPUT_KIND, inputId);
    if (!record || record.targetOwner.threadId !== targetThreadId) throw new HarnessError('INVALID_AGENT_INPUT', `Unknown input ${inputId}`);
    this.transition(inputId, ['ACCEPTED'], 'REJECTED', 'agentInput.cancelled', 'Cancelled while queued');
  }

  /** Reorder queued inputs; entries that already entered runtime keep order. */
  reorder(targetThreadId: string, orderedIds: string[]): void {
    const queued = this.hooks.store.all<AgentInputV1>(INPUT_KIND)
      .filter(record => record.targetOwner.threadId === targetThreadId && record.delivery === 'ACCEPTED');
    const wanted = new Set(orderedIds);
    if (orderedIds.length !== queued.length || !queued.every(record => wanted.has(record.inputId)))
      throw new HarnessError('INVALID_AGENT_INPUT', 'Reorder must cover exactly the queued inputs in order');
    const taskId = queued[0]?.taskId ?? null;
    this.hooks.store.internal('agentInput.reorder', taskId, () => {
      orderedIds.forEach((inputId, order) => {
        const record = this.hooks.store.get<AgentInputV1>(INPUT_KIND, inputId)!;
        this.hooks.store.put(INPUT_KIND, inputId, record.taskId, {...record, order, revision: record.revision + 1, updatedAt: new Date().toISOString()});
      });
    });
  }

  queue(targetThreadId: string): AgentInputV1[] {
    return this.hooks.store.all<AgentInputV1>(INPUT_KIND)
      .filter(record => record.targetOwner.threadId === targetThreadId && record.delivery === 'ACCEPTED')
      .sort((a, b) => a.order - b.order);
  }

  inspect(inputId: string): AgentInputV1 | null { return this.hooks.store.get<AgentInputV1>(INPUT_KIND, inputId) ?? null; }
  text(inputId: string): string | null { return this.hooks.store.get<{text: string}>(TEXT_KIND, inputId)?.text ?? null; }

  /** Restart: undispatched inputs fail, dispatched-but-unacked go UNKNOWN. */
  recover(): void {
    for (const record of this.hooks.store.all<AgentInputV1>(INPUT_KIND)) {
      if (record.delivery === 'ACCEPTED') this.transition(record.inputId, ['ACCEPTED'], 'REJECTED', 'agentInput.recovered', 'Input was never dispatched');
      else if (record.delivery === 'ENTERED_RUNTIME') this.transition(record.inputId, ['ENTERED_RUNTIME'], 'UNKNOWN', 'agentInput.recovered', 'Delivery was unacknowledged at restart');
    }
  }

  /* ---------------- bounded task message board ---------------- */

  private ownerRegistered(taskId: string, owner: AgentWorkOwner): boolean {
    const thread = this.hooks.store.get<Thread>('thread', owner.threadId);
    if (!thread) return false;
    if (owner.threadId === taskId) return true;
    return thread.kind === 'delegate' && thread.parentThreadId === taskId;
  }

  postMessage(sender: AgentWorkOwner, spec: AgentMessageSpec): AgentMessageV1 {
    const store = this.hooks.store;
    if (!this.ownerRegistered(spec.taskId, sender)) throw new HarnessError('INVALID_AGENT_MESSAGE', `Message sender ${sender.threadId} is not a registered owner of task ${spec.taskId}`);
    if (!this.ownerRegistered(spec.taskId, spec.recipientOwner)) throw new HarnessError('INVALID_AGENT_MESSAGE', `Message recipient ${spec.recipientOwner.threadId} is not a registered owner of task ${spec.taskId}`);
    if (spec.replyTo && !store.get<AgentMessageV1>(MESSAGE_KIND, spec.replyTo)) throw new HarnessError('INVALID_AGENT_MESSAGE', `replyTo ${spec.replyTo} does not reference a posted message`);
    const now = new Date().toISOString();
    const record = AgentMessageV1Schema.parse({
      version: 1,
      messageId: spec.messageId,
      taskId: spec.taskId,
      senderOwner: sender,
      recipientOwner: spec.recipientOwner,
      topic: spec.topic,
      text: spec.text ?? null,
      artifactRef: spec.artifactRef ?? null,
      replyTo: spec.replyTo ?? null,
      expiresAt: spec.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      receipt: {status: 'POSTED', at: now},
      createdSeq: store.sequence,
      createdAt: now,
    });
    // Mailboxes are data, not control: posting never creates grants or runs commands.
    const active = store.all<AgentMessageV1>(MESSAGE_KIND).filter(message => message.taskId === spec.taskId
      && (message.receipt.status === 'POSTED' || message.receipt.status === 'DELIVERED'));
    if (active.length >= AGENT_WORK_LIMITS.activeMessagesPerTask) throw new HarnessError('INVALID_AGENT_MESSAGE', `Task ${spec.taskId} already has ${AGENT_WORK_LIMITS.activeMessagesPerTask} active messages`);
    store.internal('agentMessage.post', spec.taskId, () => store.put(MESSAGE_KIND, record.messageId, spec.taskId, record));
    return record;
  }

  deliverMessage(messageId: string): AgentMessageV1 {
    const record = this.hooks.store.get<AgentMessageV1>(MESSAGE_KIND, messageId);
    if (!record) throw new HarnessError('INVALID_AGENT_MESSAGE', `Unknown message ${messageId}`);
    if (record.receipt.status !== 'POSTED') return record;
    const next: AgentMessageV1 = {...record, receipt: {status: 'DELIVERED', at: new Date().toISOString()}};
    this.hooks.store.internal('agentMessage.delivered', record.taskId, () => this.hooks.store.put(MESSAGE_KIND, messageId, record.taskId, next));
    return next;
  }

  /** Active (not expired) messages for the task, oldest first. */
  messages(taskId: string): AgentMessageV1[] {
    const now = new Date().toISOString();
    return this.hooks.store.all<AgentMessageV1>(MESSAGE_KIND)
      .filter(message => message.taskId === taskId && message.expiresAt > now
        && (message.receipt.status === 'POSTED' || message.receipt.status === 'DELIVERED'))
      .sort((a, b) => a.createdSeq - b.createdSeq);
  }
}
