import { HarnessError } from '../contracts/index.ts';

// Shared host-injected capability registry. The key set is finite and fixed at
// construction by the owning bundle; unknown keys reject and every flag
// defaults false. Flags never live in strict UI preferences and are never
// toggled by agent or plugin commands — only the host that constructed the
// registry can set a flag, and each risky sub-capability needs its own proof.
export interface CapabilityFlagDefinition {
  readonly key: string;
  readonly owner: string;
  readonly description: string;
}

export class CapabilityFlags<K extends string = string> {
  private readonly definitions = new Map<K, CapabilityFlagDefinition>();
  private readonly values = new Map<K, boolean>();
  constructor(definitions: readonly CapabilityFlagDefinition[], overrides?: Partial<Record<K, boolean>>) {
    for (const definition of definitions) {
      if (!definition.key || this.definitions.has(definition.key as K))
        throw new HarnessError('DUPLICATE_FLAG', `Duplicate or empty capability flag key: ${definition.key}`);
      this.definitions.set(definition.key as K, definition);
      this.values.set(definition.key as K, false);
    }
    for (const key of Object.keys(overrides ?? {}) as K[]) this.set(key, overrides![key] === true);
  }
  private require(key: K | string): K {
    if (!this.definitions.has(key as K))
      throw new HarnessError('UNKNOWN_CAPABILITY_FLAG', `Unknown capability flag: ${String(key)}`);
    return key as K;
  }
  enabled(key: K): boolean { return this.values.get(this.require(key))!; }
  set(key: K, enabled: boolean): void { this.values.set(this.require(key), enabled); }
  keys(): readonly K[] { return [...this.definitions.keys()]; }
  snapshot(): Readonly<Record<K, boolean>> { return Object.freeze(Object.fromEntries(this.values) as Record<K, boolean>); }
}

export function createCapabilityFlags<K extends string>(definitions: readonly CapabilityFlagDefinition[], overrides?: Partial<Record<K, boolean>>): CapabilityFlags<K> {
  return new CapabilityFlags<K>(definitions, overrides);
}

// M02 flag set: the single process registry the host owns. Both flags gate the
// M02 authority gate / effect ledger and stay off until coverage and regression
// gates pass.
export const M02_FLAG_KEYS = ["audit.effectsV1", "security.authorityV1"] as const;
export type M02FlagKey = (typeof M02_FLAG_KEYS)[number];

const m02Flags = createCapabilityFlags<M02FlagKey>([
  { key: "audit.effectsV1", owner: "m02", description: "Append-only tool-effect ledger and owner-fenced read models." },
  { key: "security.authorityV1", owner: "m02", description: "Single-use approvals and the pre-dispatch authority gate." },
]);

export function capabilityEnabled(key: M02FlagKey): boolean {
  return m02Flags.enabled(key);
}
export function registeredCapabilityFlags(): Record<M02FlagKey, boolean> {
  return m02Flags.snapshot() as Record<M02FlagKey, boolean>;
}
/** Test-only seam: flips a flag without touching user-visible preferences. All
 * defaults are false, so `undefined` restores the default. */
export function __setCapabilityFlagForTests(key: M02FlagKey, value: boolean | undefined): void {
  m02Flags.set(key, value === true);
}
