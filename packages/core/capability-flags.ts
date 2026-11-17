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

// M04 flag set: context compiler observation, progressive tool disclosure and
// loss-aware compaction gates.
export const M04_FLAG_KEYS = ["context.compilerV1", "tools.deferredV1", "context.lossAwareCompactionV1", "context.precomputeExperimentV1"] as const;
export type M04FlagKey = (typeof M04_FLAG_KEYS)[number];

// M08 flag set: managed-workspace lifecycle. All default false and only the
// host that owns this registry can enable one — the provenance journal,
// checkpoint provider/restore protocol, and the write-delegate child
// worktrees each stay behind their own key.
export const M08_FLAG_KEYS = [
  "workspace.provenanceV1",
  "workspace.checkpointsV1",
  "workspace.restoreV1",
  "workspace.writeDelegateV1",
] as const;
export type M08FlagKey = (typeof M08_FLAG_KEYS)[number];

export const M04_CORE_FLAG_KEYS = ["context.compilerV1"] as const;
export type M04CoreFlagKey = (typeof M04_CORE_FLAG_KEYS)[number];

export const M05_FLAG_KEYS = ["memory.projectV1", "memory.externalRecallExperimentV1"] as const;
export type M05FlagKey = (typeof M05_FLAG_KEYS)[number];

// M09 flag set: typed multi-agent work. The single key admits the
// AgentWorkV1 coordinator surface; role availability stays separately gated
// by each role's own registered host capability proof.
export const M09_FLAG_KEYS = ["agents.workV1"] as const;
export type M09FlagKey = (typeof M09_FLAG_KEYS)[number];

// M11 flag set: model transport. Instrumentation ships on; the optimizer
// surfaces each stay behind its own key until paired cold/repeated evidence,
// account isolation and cancellation tests pass.
export const M11_FLAG_KEYS = [
  "models.requestMetricsV1",
  "models.publicStreamingV1",
  "models.statelessPoolExperimentV1",
  "models.newTaskProfilesV1",
] as const;
export type M11FlagKey = (typeof M11_FLAG_KEYS)[number];

export const M15_FLAG_KEYS = ["ui.sourceWorkbenchV1"] as const;
export type M15FlagKey = (typeof M15_FLAG_KEYS)[number];

// M10 flag set: durable background work and human handoffs. Each risky
// sub-capability keeps its own key and proof; contracts and ordinary RUN jobs
// never unlock service lifetime, idle review forks or external intake.
export const M10_FLAG_KEYS = [
  "jobs.backgroundV1",
  "jobs.serviceLifetimeV1",
  "jobs.idleReviewV1",
  "integrations.intakeV1",
] as const;
export type M10FlagKey = (typeof M10_FLAG_KEYS)[number];

export type CapabilityFlagKey = M02FlagKey | M08FlagKey | M04FlagKey | M04CoreFlagKey | M05FlagKey | M09FlagKey | M11FlagKey | M15FlagKey | M10FlagKey;

const hostFlags = createCapabilityFlags<CapabilityFlagKey>([
  { key: "ui.sourceWorkbenchV1", owner: "m15", description: "Owner-validated source selections and read-only operator workbench contributions." },
  { key: "context.compilerV1", owner: "m04-core", description: "Host-issued immutable request preparation and measured context receipts." },
  { key: "memory.projectV1", owner: "m05", description: "Opt-in source-linked project memory; reviewed request integration required." },
  { key: "memory.externalRecallExperimentV1", owner: "m05", description: "Separate bounded external recall experiment; provider and egress consent required." },
  { key: "audit.effectsV1", owner: "m02", description: "Append-only tool-effect ledger and owner-fenced read models." },
  { key: "security.authorityV1", owner: "m02", description: "Single-use approvals and the pre-dispatch authority gate." },
  { key: "workspace.provenanceV1", owner: "m08", description: "Edit provenance journal: prepared markers and proven/process-window receipts." },
  { key: "workspace.checkpointsV1", owner: "m08", description: "File checkpoint capture and the host checkpoint provider behind the read adapter." },
  { key: "workspace.restoreV1", owner: "m08", description: "Reviewed restore protocol with pre-restore checkpoint and per-file preimage checks." },
  { key: "workspace.writeDelegateV1", owner: "m08", description: "Write-capable child worktrees gated by the M03 child profile and an M02 approval." },
  { key: "agents.workV1", owner: "m09", description: "Typed multi-agent work admission: role-gated child dispatch, ordered inputs, budget reservation and verified outputs." },
  { key: "models.requestMetricsV1", owner: "m11", description: "Publish measured per-request observations into the thread Usage dialog." },
  { key: "models.publicStreamingV1", owner: "m11", description: "Public streaming via a typed parser-approved delta channel; off until a real source parser integration exists." },
  { key: "models.statelessPoolExperimentV1", owner: "m11", description: "Warm stateless transport reuse experiment; off until adapter proof and paired evidence." },
  { key: "models.newTaskProfilesV1", owner: "m11", description: "Operator-approved static task-role routing applied only at new-task creation." },
  { key: "tools.deferredV1", owner: "m04", description: "Progressive tool schema disclosure." },
  { key: "context.lossAwareCompactionV1", owner: "m04", description: "Loss-aware native compaction." },
  { key: "context.precomputeExperimentV1", owner: "m04", description: "Experimental summary precomputation." },
  { key: "jobs.backgroundV1", owner: "m10", description: "Durable background work records, one Store scheduler and owned RUN-lifetime commands." },
  { key: "jobs.serviceLifetimeV1", owner: "m10", description: "APPROVED_SERVICE lifetime; off until an installed supervisor has target-platform PASS evidence." },
  { key: "jobs.idleReviewV1", owner: "m10", description: "Opt-in idle verification/review work; off until the pinned fork API and auxiliary budget are proven." },
  { key: "integrations.intakeV1", owner: "m10", description: "Authenticated read-only GitHub polling intake; proposals only until explicit user approval." },
]);

export function capabilityEnabled(key: CapabilityFlagKey): boolean {
  return hostFlags.enabled(key);
}
export function registeredCapabilityFlags(): Record<CapabilityFlagKey, boolean> {
  return hostFlags.snapshot() as Record<CapabilityFlagKey, boolean>;
}
/** Test-only seam: flips a flag without touching user-visible preferences. All
 * defaults are false, so `undefined` restores the default. */
export function __setCapabilityFlagForTests(key: CapabilityFlagKey, value: boolean | undefined): void {
  hostFlags.set(key, value === true);
}
