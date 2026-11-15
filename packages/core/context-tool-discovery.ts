import { createHash } from 'node:crypto';

export type ContextToolExposure = 'DIRECT' | 'DEFERRED' | 'SCRIPT_ONLY' | 'HIDDEN';
type Registration = { readonly name: string; readonly description: string; readonly schema: object; readonly exposure: ContextToolExposure };
type PublicTool = { name: string; description: string; schema: object };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const frozen = <T>(value: T): T => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) frozen(child); Object.freeze(value); }
  return value;
};
const MAX_SCHEMA_BYTES = 128 * 1024;

/** Projects admitted schemas; does not register or dispatch tools. */
export function createContextToolDiscovery(registrations: readonly Registration[], isAdmitted: (name: string) => boolean) {
  if (registrations.length > 5000) throw new RangeError('Tool catalog exceeds the supported size');
  const catalog = new Map<string, Registration>();
  for (const input of registrations.toSorted((a, b) => compare(a.name, b.name))) {
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(input.name) || catalog.has(input.name))
      throw new Error('Invalid or duplicate tool identity');
    const serialized = JSON.stringify(input.schema);
    if (Buffer.byteLength(serialized) > MAX_SCHEMA_BYTES) throw new RangeError('Tool schema exceeds the request byte limit');
    catalog.set(input.name, frozen({ name: input.name, description: input.description.slice(0, 240),
      schema: JSON.parse(serialized) as object, exposure: input.exposure }));
  }
  const accessible = (entry: Registration) =>
    (entry.exposure === 'DIRECT' || entry.exposure === 'DEFERRED') && isAdmitted(entry.name) === true;
  const describePublic = ({ name, description, schema }: Registration): PublicTool => ({ name, description, schema });
  return {
    discover(query: string) {
      const search = query.slice(0, 128).trim().toLowerCase();
      const result: { name: string; description: string }[] = [];
      for (const entry of catalog.values()) {
        if (result.length >= 30) break;
        if ((entry.name.toLowerCase().includes(search) || entry.description.toLowerCase().includes(search)) && accessible(entry))
          result.push({ name: entry.name, description: entry.description });
      }
      return result;
    },
    describe(name: string) {
      const entry = catalog.get(name);
      return entry && accessible(entry) ? frozen(describePublic(entry)) : null;
    },
    freezeRequest(described: readonly string[]) {
      const requested = new Set(described.slice(0, 1000));
      const tools = [...catalog.values()].filter(entry =>
        (entry.exposure === 'DIRECT' || requested.has(entry.name)) && accessible(entry)).map(describePublic);
      const serialized = JSON.stringify(tools), schemaBytes = Buffer.byteLength(serialized);
      if (schemaBytes > MAX_SCHEMA_BYTES) throw new RangeError('Admitted tool schemas exceed the request byte limit');
      return frozen({ tools, schemaBytes, digest: createHash('sha256').update(serialized).digest('hex') });
    },
  };
}

/** Per-owner next-request queue. Description alone never admits invocation in the current view. */
export function createProgressiveToolSession(registrations: readonly Registration[], isAdmitted: (name: string) => boolean) {
  const projection = createContextToolDiscovery(registrations, isAdmitted);
  const described = new Set<string>();
  let visible = new Set<string>();
  return {
    discover: projection.discover,
    describe(name: string) {
      const result = projection.describe(name);
      if (result && described.size < 64) described.add(result.name);
      return result;
    },
    capture() {
      const snapshot = projection.freezeRequest([...described]);
      visible = new Set(snapshot.tools.map(tool => tool.name));
      return snapshot;
    },
    canInvoke(name: string) { return visible.has(name) && isAdmitted(name) === true; },
  };
}
