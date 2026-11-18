import { createHash } from 'node:crypto';
import { types } from 'node:util';
import type { ContextRelevanceObservationV1 } from '../contracts/request-context.ts';
import { createRelevanceObserver } from './context-relevance.ts';

const LIMITS = { owners: 32, results: 64, inspectionBytes: 64 * 1024, nodes: 4096, recentRequests: 2 } as const;
type Owner = { threadId: string; binding: string };
type Result = { id: string; inputSequence: number; bytes: number; kind: 'tool-result'; completed: true; protected: boolean };
type State = {
  owner: Owner; sequence: number; next: number; omitted: number; results: Result[];
  observer: ReturnType<typeof createRelevanceObserver>; report?: ContextRelevanceObservationV1;
};
type Ticket = { state: State };

/** Measure only bounded plain data. Inspection must not invoke result getters,
 * custom serialization, proxy traps or an additional execution path. */
function resultBytes(value: unknown): number | null {
  if (typeof value === 'string') return value.length <= LIMITS.inspectionBytes && Buffer.byteLength(value) <= LIMITS.inspectionBytes ? Buffer.byteLength(value) : null;
  const pending = [{ value, depth: 0 }], seen = new Set<object>();
  let nodes = 0, bytes = 0;
  while (pending.length) {
    const entry = pending.pop()!;
    if (++nodes > LIMITS.nodes || entry.depth > 32) return null;
    const item = entry.value;
    if (typeof item === 'string') {
      if (item.length > LIMITS.inspectionBytes) return null;
      bytes += Buffer.byteLength(item);
    } else if (item !== null && typeof item === 'object') {
      if (types.isProxy(item) || seen.has(item)) return null;
      seen.add(item);
      const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
      if (array ? prototype !== Array.prototype || item.length > LIMITS.nodes : prototype !== Object.prototype && prototype !== null) return null;
      const keys = Reflect.ownKeys(item);
      if (keys.length > LIMITS.nodes) return null;
      for (const key of keys) {
        if (typeof key !== 'string' || key === 'toJSON') return null;
        if (array && key === 'length') continue;
        const property = Object.getOwnPropertyDescriptor(item, key)!;
        if (!('value' in property)) return null;
        if (!property.enumerable) continue;
        bytes += Buffer.byteLength(key);
        pending.push({ value: property.value, depth: entry.depth + 1 });
      }
    } else if (typeof item !== 'boolean' && typeof item !== 'number' && item !== null) return null;
    if (bytes > LIMITS.inspectionBytes || pending.length > LIMITS.nodes) return null;
  }
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string' || serialized.length > LIMITS.inspectionBytes) return null;
  const size = Buffer.byteLength(serialized);
  return size <= LIMITS.inspectionBytes ? size : null;
}

/** Read-only production observer over host-delivered results. IDs are local
 * observation IDs, not native tool-call IDs. Native membership and semantic
 * relevance remain unproven, so reports never authorize pruning or compaction. */
export function createHostRelevanceObserver() {
  const states = new Map<string, State>();
  return {
    begin(owner: Owner): Ticket | undefined {
      const state = states.get(owner.threadId);
      return state?.owner.binding === owner.binding && state.sequence > 0 ? { state } : undefined;
    },
    complete(ticket: Ticket | undefined, owner: Owner, result: unknown): void {
      if (!ticket || ticket.state !== states.get(owner.threadId) || ticket.state.owner.binding !== owner.binding) return;
      const bytes = resultBytes(result);
      if (!bytes) return;
      const state = ticket.state;
      // Age starts at delivery, so a slow result stays recent even if more
      // requests were observed while the read was in flight.
      state.results.push({ id: 'host-result:' + ++state.next, inputSequence: state.sequence, bytes, kind: 'tool-result', completed: true, protected: false });
      if (state.results.length > LIMITS.results) { state.results.shift(); state.omitted++; }
    },
    observe(owner: Owner, sequence: number, protect: boolean): ContextRelevanceObservationV1 | undefined {
      let state = states.get(owner.threadId);
      if (!state || state.owner.binding !== owner.binding) {
        state = { owner, sequence: 0, next: 0, omitted: 0, results: [], observer: createRelevanceObserver() };
        states.delete(owner.threadId); states.set(owner.threadId, state);
        if (states.size > LIMITS.owners) states.delete(states.keys().next().value!);
      }
      if (sequence <= state.sequence) return state.report;
      state.sequence = sequence;
      const retainedTailStart = sequence - LIMITS.recentRequests;
      const segments = state.results.filter(result => result.inputSequence < retainedTailStart).map(result => ({ ...result, protected: protect }));
      if (!segments.length) return undefined;
      const cutId = createHash('sha256').update(JSON.stringify([owner.binding, segments, state.omitted])).digest('hex');
      if (cutId === state.report?.cutId) return state.report;
      const observation = state.observer.observe({ cutId, retainedTailStart, inspectionBudgetBytes: LIMITS.inspectionBytes, segments });
      if (!observation) return undefined;
      state.report = Object.freeze({ ...observation, cutId, observedAtSequence: sequence, inspectedResults: segments.length,
        protectedResults: protect ? segments.length : 0, omittedResults: state.omitted,
        inspectionBudgetBytes: LIMITS.inspectionBytes, source: 'HOST_READ_RESULTS', measurement: 'BYTE_ONLY' });
      return state.report;
    },
    forget(threadId: string) { states.delete(threadId); },
    clear() { states.clear(); },
  };
}
