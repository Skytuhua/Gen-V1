import type { Message, RuntimeUsage, Snapshot, WorkspaceEvent } from '../../../packages/contracts';

// Patch the cached snapshot for the streaming-runtime event kinds whose
// payloads carry the upserted entity. Anything structural (thread status,
// artifacts, requests, outbox, settled) returns null so the caller refetches
// the whole snapshot once per real change instead of once per chunk.
export function applyRuntimeEvent(snapshot: Snapshot, event: WorkspaceEvent): Snapshot | null {
  if (!event.threadId || !event.type.startsWith('runtime.')) return null;
  const result = (event.payload as { result?: unknown } | null)?.result;
  if (!result || typeof result !== 'object') return null;
  if (event.type === 'runtime.assistant.delta' || event.type === 'runtime.assistant.message' || event.type === 'runtime.activity') {
    const message = (result as { message?: Message }).message;
    if (!message || typeof message.id !== 'string' || message.threadId !== event.threadId) return null;
    const known = snapshot.messages.some(item => item.id === message.id);
    const messages = known ? snapshot.messages.map(item => item.id === message.id ? message : item) : [...snapshot.messages, message];
    // A stream append retains the current rows. Only a fresh host snapshot
    // replaces the window and can change how many older rows are hidden.
    return { ...snapshot, seq: event.seq, messages };
  }
  if (event.type === 'runtime.usage' || event.type === 'runtime.compaction.start' || event.type === 'runtime.compaction.end') {
    const usage = (result as { usage?: RuntimeUsage }).usage;
    if (!usage || typeof usage !== 'object') return null;
    return { ...snapshot, seq: event.seq, usage: { ...snapshot.usage, [event.threadId]: usage } };
  }
  return null;
}
