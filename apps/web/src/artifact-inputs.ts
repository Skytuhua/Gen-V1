import type { ArtifactRecord, DataBinding, DataRecord, Snapshot } from '../../../packages/contracts';

type InputArtifact = Pick<ArtifactRecord, 'id' | 'threadId' | 'stateId' | 'bindings'>;
interface Source { alias: string; binding: DataBinding; record?: DataRecord }
interface CachedInput { version: string; value: unknown }

function sources(artifact: InputArtifact, snapshot: Pick<Snapshot, 'data'>): Source[] {
  return Object.entries(artifact.bindings).map(([alias, binding]) => {
    const id = binding.mode === 'snapshot' ? binding.ref.id : binding.id;
    let record: DataRecord | undefined;
    for (const candidate of snapshot.data) {
      if (candidate.id !== id || candidate.threadId !== artifact.threadId) continue;
      if (binding.mode === 'snapshot') {
        if (candidate.revision === binding.ref.revision) { record = candidate; break; }
      } else if (!record || candidate.revision > record.revision) record = candidate;
    }
    return { alias, binding, record };
  });
}

function pointer(value: unknown, path?: string): unknown {
  if (!path || path === '') return value;
  if (!path.startsWith('/')) return undefined;
  return path.slice(1).split('/').reduce<unknown>((current, token) => {
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
    if (['__proto__', 'constructor', 'prototype'].includes(key) || !current || typeof current !== 'object') return undefined;
    return Object.hasOwn(current, key) ? (current as Record<string, unknown>)[key] : undefined;
  }, value);
}

/** One resolver per mounted artifact. Host data versions are immutable; only
 * binding/version metadata is compared, never the potentially large payload.
 * Every snapshot still rechecks source presence and thread ownership. */
export function createArtifactInputResolver() {
  let owner: string | undefined;
  let cached = new Map<string, CachedInput>();
  let inputs: Record<string, unknown> = {};
  return (artifact: InputArtifact, snapshot: Pick<Snapshot, 'data'>): Record<string, unknown> => {
    const nextOwner = JSON.stringify([artifact.threadId, artifact.id, artifact.stateId]);
    const selected = sources(artifact, snapshot), next = new Map<string, CachedInput>();
    let changed = owner !== nextOwner || cached.size !== selected.length;
    for (const { alias, binding, record } of selected) {
      const version = JSON.stringify([binding, record ? [record.threadId, record.id, record.revision] : null]);
      const previous = owner === nextOwner ? cached.get(alias) : undefined;
      if (previous?.version === version) next.set(alias, previous);
      else {
        changed = true;
        next.set(alias, { version, value: pointer(record?.value, binding.mode === 'snapshot' ? binding.ref.pointer : binding.pointer) });
      }
    }
    if (changed) inputs = Object.fromEntries([...next].map(([alias, entry]) => [alias, entry.value]));
    owner = nextOwner; cached = next;
    return inputs;
  };
}
