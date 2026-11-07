import type {ConversationContext, ConversationMessage, ConversationTarget} from '../../../../packages/contracts/conversation-read-models';
import {conversationTargetSchema} from '../../../../packages/contracts/conversation-read-models';
import {getConversationContext, getConversationHistory, getConversationContent, getConversationUpdates} from '../conversation-read-api';

/** The parent supplies a canonical navigation admission, never an inventory fallback. */
export interface ConversationSelection {target: ConversationTarget; navigationKey: string}
export interface ReadMessage {
  readonly head: ConversationMessage;
  readonly tail: ConversationMessage;
  readonly text: string;
  readonly loadedCodePoints: number;
  readonly pending: boolean;
  readonly limited: boolean;
}
export interface ConversationReadState {
  readonly selectionKey: string | null;
  readonly phase: 'closed' | 'loading' | 'ready' | 'resync' | 'revoked' | 'error';
  readonly context: ConversationContext | null;
  readonly pending: boolean;
  readonly error: string | null;
  readonly messages: readonly ReadMessage[];
  readonly nextCursor: string | null;
  readonly historyPending: boolean;
  readonly historyLimited: boolean;
}
const PAGE_SIZE = 30, MAX_MESSAGES = 180, MAX_CONTENT = 65_536;
export const closedConversation: ConversationReadState = {selectionKey: null, phase: 'closed', context: null, pending: false, error: null, messages: [], nextCursor: null, historyPending: false, historyLimited: false};
export function conversationSelectionKey(selection: ConversationSelection | null): string | null {
  return selection ? JSON.stringify([selection.navigationKey, selection.target.authority, selection.target.threadId, selection.target.includeArchived ?? false]) : null;
}
const sameIdentity = (a: ConversationMessage, b: ConversationMessage) => a.id === b.id && a.threadId === b.threadId && a.revision === b.revision && a.role === b.role && a.runId === b.runId && a.createdAt === b.createdAt && a.contentLength === b.contentLength && a.contentOffset === b.contentOffset && a.content === b.content;
const invalid = () => Object.assign(new Error('Conversation changed.'), {code: 'INVALID_RESPONSE'});
const wrap = (head: ConversationMessage): ReadMessage => ({head, tail: head, text: head.content, loadedCodePoints: [...head.content].length, pending: false, limited: false});

/** In-memory read fences only. This controller provides no command authority. */
export function createConversationReader(options: {onState?: (state: ConversationReadState) => void} = {}) {
  let state = closedConversation, selection: ConversationSelection | null = null, generation = 0, transcriptVersion = 0, pages = 1;
  let session = new AbortController(), timer: ReturnType<typeof setTimeout> | undefined;
  let polling: Promise<void> | null = null;
  const listeners = new Set<() => void>(), reads = new Set<AbortController>();
  function publish(patch: Partial<ConversationReadState>) {
    state = {...state, ...patch};
    // Invalidation reaches the owner before subscribers can render stale source tools.
    options.onState?.(state);
    for (const listener of listeners) listener();
  }
  function cancelReads() {transcriptVersion++; for (const read of reads) read.abort(); reads.clear();}
  function stop() {generation++; session.abort(); session = new AbortController(); clearTimeout(timer); timer = undefined; polling = null; cancelReads();}
  function current(version: number) {return version === generation && !session.signal.aborted && selection !== null;}
  function schedule(version: number) {
    clearTimeout(timer);
    if (current(version) && state.context) timer = setTimeout(() => {void poll();}, 1500);
  }
  function clear(phase: ConversationReadState['phase'], error: string | null = null) {
    publish({...closedConversation, selectionKey: conversationSelectionKey(selection), phase, error, pending: phase === 'loading' || phase === 'resync'});
  }
  async function acquire(version: number, canResync = false) {
    if (!selection) return;
    try {
      const context = await getConversationContext(selection.target, session.signal);
      if (!current(version)) return;
      publish({context});
      await history(version, true, [], canResync);
      if (current(version) && state.context) {publish({phase: 'ready', pending: false}); schedule(version);}
    } catch (error) {if (current(version)) await fail(error, false);}
  }
  async function fail(error: unknown, reacquire = true) {
    const code = (error as {code?: string})?.code;
    const resync = ['RESYNC_REQUIRED', 'INVALID_RESPONSE', 'INVALID_CURSOR'].includes(code ?? '');
    stop(); pages = 1;
    if (resync && reacquire && selection) {clear('resync'); await acquire(generation);}
    else clear(['CAPABILITY_DENIED', 'AUTH_REQUIRED', 'FORBIDDEN'].includes(code ?? '') ? 'revoked' : 'error', resync ? 'Conversation changed. Reload.' : code === 'CAPABILITY_DENIED' ? 'Conversation unavailable.' : 'Could not load conversation. Retry.');
  }
  function readFence() {
    const controller = new AbortController(); reads.add(controller);
    const version = generation, transcript = transcriptVersion;
    return {signal: controller.signal, valid: () => current(version) && transcript === transcriptVersion && !controller.signal.aborted, done: () => reads.delete(controller)};
  }
  function checkSequence(sequence: number) {if (!state.context || sequence < state.context.sequence) throw invalid();}
  async function history(version: number, replace: boolean, previous: readonly ReadMessage[] = [], canResync = true) {
    const context = state.context;
    if (!context || !current(version)) return;
    const fence = readFence();
    publish({historyPending: true});
    try {
      let cursor = replace ? undefined : state.nextCursor ?? undefined;
      const loaded: ReadMessage[] = [], seen = new Map<string, ConversationMessage>();
      const requestedPages = replace ? pages : 1;
      for (let i = 0; i < requestedPages; i++) {
        const page = await getConversationHistory(context, {limit: PAGE_SIZE, cursor}, fence.signal);
        if (!fence.valid()) return;
        checkSequence(page.sequence);
        const batch: ReadMessage[] = [];
        for (const message of page.messages) {
          const duplicate = seen.get(message.id);
          if (duplicate) {if (!sameIdentity(duplicate, message)) throw invalid(); continue;}
          seen.set(message.id, message);
          // A fresh full-body revision check may retain an expanded, pinned original.
          const retained = previous.find(item => sameIdentity(item.head, message));
          batch.push(retained ? {...retained, pending: false} : wrap(message));
        }
        loaded.unshift(...batch); cursor = page.nextCursor ?? undefined;
        if (!cursor) break;
      }
      if (!fence.valid()) return;
      let messages = loaded;
      if (!replace) {
        const existing = new Map(state.messages.map(item => [item.head.id, item]));
        messages = loaded.filter(item => {
          const duplicate = existing.get(item.head.id);
          if (duplicate && !sameIdentity(duplicate.head, item.head)) throw invalid();
          return !duplicate;
        }).concat(state.messages);
        pages++;
      }
      if (messages.length > MAX_MESSAGES) throw invalid();
      publish({messages, nextCursor: cursor ?? null, historyLimited: Boolean(cursor) && (messages.length >= MAX_MESSAGES || pages >= MAX_MESSAGES / PAGE_SIZE), historyPending: false});
    } catch (error) {if (fence.valid()) await fail(error, canResync);}
    finally {fence.done();}
  }
  async function poll() {
    if (polling) return polling;
    const context = state.context, version = generation;
    if (!context) return;
    clearTimeout(timer);
    const work = async () => {
      try {
        const update = await getConversationUpdates(context, session.signal);
        if (!current(version)) return;
        // owner:null still carries a new sequenced checkpoint.
        const next = update.owner ?? {...context, sequence: update.sequence, checkpoint: update.checkpoint};
        if (update.transcriptChanged) {
          const previous = state.messages;
          cancelReads();
          publish({context: next, messages: [], nextCursor: null, pending: true, historyPending: false});
          await history(version, true, previous);
          if (current(version) && state.context) publish({pending: false});
        } else publish({context: next});
      } catch (error) {if (current(version)) await fail(error);}
      finally {if (version === generation) {polling = null; schedule(version);}}
    };
    polling = work(); return polling;
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    async select(next: ConversationSelection | null) {
      stop(); selection = next; pages = 1;
      if (!next) {clear('closed'); return;}
      const parsed = conversationTargetSchema.safeParse(next.target);
      if (!parsed.success || typeof next.navigationKey !== 'string' || !next.navigationKey.trim()) {clear('revoked', 'Conversation unavailable.'); return;}
      selection = {target: parsed.data, navigationKey: next.navigationKey};
      clear('loading'); await acquire(generation, true);
    },
    retry: async () => {stop(); pages = 1; if (selection) {clear('loading'); await acquire(generation, true);}},
    poll,
    async loadOlder() {
      if (!state.context || state.pending || state.historyPending || !state.nextCursor || state.historyLimited) return;
      await history(generation, false);
    },
    async loadContent(id: string) {
      const context = state.context, message = state.messages.find(item => item.head.id === id);
      if (!context || !message || message.pending || !message.tail.nextContentCursor || message.limited) return;
      const fence = readFence();
      const patch = (value: Partial<ReadMessage>) => publish({messages: state.messages.map(item => item === message || item.head === message.head ? {...item, ...value} : item)});
      patch({pending: true});
      try {
        const page = await getConversationContent(context, message.tail, fence.signal);
        if (!fence.valid()) return;
        checkSequence(page.sequence);
        const count = message.loadedCodePoints + [...page.message.content].length;
        if (count > MAX_CONTENT) {patch({pending: false, limited: true}); return;}
        patch({tail: page.message, text: message.text + page.message.content, loadedCodePoints: count, pending: false, limited: count >= MAX_CONTENT && page.message.nextContentCursor !== null});
      } catch (error) {if (fence.valid()) await fail(error);}
      finally {fence.done();}
    },
    close() {stop(); selection = null; clear('closed');},
  };
}
export type ConversationReader = ReturnType<typeof createConversationReader>;
