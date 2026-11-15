import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { implementationEvidenceV3Schema, validateImplementationEvidence, sourceLockV3Schema } from '../packages/contracts/implementation-evidence.ts';
import { createToolEffectFlags } from '../packages/core/tool-effects.ts';

it('uses independent host flag instances with default-off rollout', () => {
  const configured = createToolEffectFlags({ 'audit.effectsV1': true });
  const untouched = createToolEffectFlags();
  expect(configured.snapshot()).toEqual({ 'audit.effectsV1': true, 'security.authorityV1': false });
  expect(untouched.snapshot()).toEqual({ 'audit.effectsV1': false, 'security.authorityV1': false });
});

it('accepts M02 evidence using the unmodified M01 schema', () => {
  const evidence = JSON.parse(readFileSync(new URL('../docs/implementation/v3/M02-verification.json', import.meta.url), 'utf8'));
  const parsed = implementationEvidenceV3Schema.parse(evidence);
  const lockBytes = readFileSync(new URL('../docs/implementation/v3/M02-source-lock.json', import.meta.url));
  const lock = sourceLockV3Schema.parse(JSON.parse(lockBytes.toString('utf8')));
  expect(parsed.sourceLockDigest).toBe(createHash('sha256').update(lockBytes).digest('hex'));
  expect(validateImplementationEvidence(parsed, {
    expectedBaseSha: lock.executionBaseSha,
    requiredContracts: lock.publicContracts,
  })).toEqual([]);
  expect(parsed.flags.every(flag => !flag.enabled)).toBe(true);
});
