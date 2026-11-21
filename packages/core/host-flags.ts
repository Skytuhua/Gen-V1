/** The shared finite registry of host-owned security flags. Only these keys
 * exist; default is false for every key. Flags are host process configuration —
 * never strict UI preferences and never writable by agents, tools or plug-ins.
 * Each risky sub-capability carries its own key and its own proof. */

export interface HostFlagDefinition {
  readonly default: false;
  readonly description: string;
}

export const HOST_FLAG_REGISTRY = Object.freeze({
  'security.projectTrustV1': Object.freeze({
    default: false,
    description: 'Project trust records: canonical root identity, approved executable/configuration digests, scope and explicit user decisions.',
  }),
  'security.secretRefsV1': Object.freeze({
    default: false,
    description: 'SecretRefV1 opaque references resolved only inside an authorized executor after approval; values never enter model context or journals.',
  }),
  'security.executionProfilesV1': Object.freeze({
    default: false,
    description: 'ExecutionProfileV1 confined launch evaluation requiring an approved backend with a PASS platform proof.',
  }),
  'verification.workflowV1': Object.freeze({
    default: false,
    description: 'Verification workflow: approved recipes, check/visual observations, bounded repair and the additive completion read model.',
  }),
  'coding.intelligenceV1': Object.freeze({
    default: false,
    description: 'Language intelligence bridge: revision-aware diagnostics and bounded navigation through an approved language-server adapter.',
  }),
  'coding.renameV1': Object.freeze({
    default: false,
    description: 'Safe rename: preview, exact approval and a guarded apply with a durable recovery journal under the workspace mutation lock.',
  }),
  'coding.debuggerV1': Object.freeze({
    default: false,
    description: 'Restricted debugger: launch only from an approved recipe on a proven backend, with inspect separated from effectful commands.',
  }),
} as const satisfies Record<string, HostFlagDefinition>);

export type RegisteredHostFlag = keyof typeof HOST_FLAG_REGISTRY;
export const HOST_FLAG_NAMES = Object.keys(HOST_FLAG_REGISTRY) as RegisteredHostFlag[];



/** Environment channel: HARNESS_FLAG_<KEY uppercased, '.'/'-' as '_',
 * camelCase humps as '_'>. Only the exact values 1/true enable a flag;
 * anything else stays disabled. */
export function hostFlagEnvName(name: RegisteredHostFlag): string {
  return 'HARNESS_FLAG_' + name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toUpperCase();
}

export function hostFlagEnabled(name: RegisteredHostFlag, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const value = env[hostFlagEnvName(name)];
  return value === '1' || value === 'true';
}

