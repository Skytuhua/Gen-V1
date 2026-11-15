import {
  REQUEST_CAPABILITY_KEYS,
  requestCapabilitiesV1Schema,
  type RequestCapabilitiesV1,
  type RequestCapabilityKey,
} from '../contracts/model-request.ts';

/**
 * Adapter capability discovery (M11). A capability is asserted by the tested
 * adapter — never inferred from a model name. Every `false` carries a reason
 * so an unsupported feature is a truthful report, and every `true` names the
 * proof that demonstrated it (proofRef).
 */
export function assertCapabilities(
  values: Partial<Record<RequestCapabilityKey, true>>,
  reasons: Partial<Record<RequestCapabilityKey, string>>,
  proofRef: string,
): RequestCapabilitiesV1 {
  const result: Record<string, unknown> = { version: 1, proofRef, reasons: {} };
  const allReasons = {...reasons};
  for (const key of REQUEST_CAPABILITY_KEYS) {
    result[key] = values[key] === true;
    if (values[key] !== true && !allReasons[key])
      allReasons[key] = 'The adapter does not report this capability.';
    if (values[key] === true && allReasons[key]) delete allReasons[key];
  }
  result.reasons = allReasons;
  return requestCapabilitiesV1Schema.parse(result);
}

/**
 * Truthful capability report for the Hermes brokered model transport. The ACP
 * transport buffers each completion into one final chunk, so public streaming
 * is unsupported rather than emulated; the native adapter retains per-session
 * conversation state, so nothing is a stateless transport.
 */
export function hermesModelTransportCapabilities(): RequestCapabilitiesV1 {
  return assertCapabilities(
    {
      // The broker carries provider cache read/write fields end to end.
      supportsUsageCacheBreakdown: true,
      // The owned engine exposes a real compaction path (agent.compact).
      supportsNativeCompaction: true,
      // agent.followUp steering tickets are admitted by the source runtime.
      supportsSteering: true,
    },
    {
      supportsPublicStreaming:
        'The brokered transport buffers each completion and the ACP server emits one final chunk; raw model text is never streamed as public content.',
      supportsStatelessReuse:
        'The native adapter retains per-session conversation state; no adapter in this path exposes a demonstrably stateless transport.',
    },
    'tests/model-transport-v3.test.ts;tests/usage-accounting-v3.test.ts',
  );
}
