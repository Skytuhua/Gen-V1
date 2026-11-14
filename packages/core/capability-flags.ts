/** M01 capability-flag registry (vendored for M02): a finite, host-injected
 * set of rollout flags. Flags are never part of strict UI preferences and
 * default off until their coverage and regression gates pass. */
export const CAPABILITY_FLAG_KEYS = ["audit.effectsV1", "security.authorityV1"] as const;
export type CapabilityFlagKey = (typeof CAPABILITY_FLAG_KEYS)[number];

const defaults: Record<CapabilityFlagKey, boolean> = {
  "audit.effectsV1": false,
  "security.authorityV1": false,
};
const overrides = new Map<CapabilityFlagKey, boolean>();

export function capabilityEnabled(key: CapabilityFlagKey): boolean {
  if (!(CAPABILITY_FLAG_KEYS as readonly string[]).includes(key)) throw new Error("Unregistered capability flag: " + key);
  return overrides.get(key) ?? defaults[key];
}
export function registeredCapabilityFlags(): Record<CapabilityFlagKey, boolean> {
  return { ...defaults };
}
/** Test-only seam: flips a flag without touching user-visible preferences. */
export function __setCapabilityFlagForTests(key: CapabilityFlagKey, value: boolean | undefined): void {
  if (value === undefined) overrides.delete(key); else overrides.set(key, value);
}
