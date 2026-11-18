import { expect, it } from 'vitest';
import { integrationSecretReferenceStatusSchema } from '../packages/contracts/integration-secrets.ts';

const reference = { refId: 'context7.11111111-1111-4111-8111-111111111111', purpose: 'Context7 documentation', owner: 'personal/context7',
  destination: { kind: 'process-env', executableSha256: 'a'.repeat(64), envName: 'CONTEXT7_API_KEY' }, revoked: false };
const current = { version: 1, enabled: true, configured: true, references: [reference] };
it('accepts current, disabled, unconfigured, and bounded unavailable metadata', () => {
  for (const value of [current, { version: 1, enabled: false, configured: true, references: [] },
    { version: 1, enabled: true, configured: false, references: [] },
    { version: 1, enabled: true, configured: true, references: [], unavailableReason: 'The configured Context7 reference is unavailable.' }]) {
    expect(integrationSecretReferenceStatusSchema.parse(value)).toEqual(value);
  }
});
it.each([
  { ...current, secret: 'must never cross this boundary' }, { ...current, version: 2 },
  { ...current, enabled: false }, { ...current, configured: false },
  { ...current, references: [] }, { ...current, references: [reference, reference] },
  { ...current, unavailableReason: 'Conflicting state' },
  { ...current, references: [], unavailableReason: 'x'.repeat(201) },
  { ...current, references: [{ ...reference, valueHash: 'b'.repeat(64) }] },
  { ...current, references: [{ ...reference, owner: 'unrelated/integration' }] },
  { ...current, references: [{ ...reference, destination: { ...reference.destination, envName: 'OTHER_TOKEN' } }] },
  { ...current, references: [{ ...reference, destination: { kind: 'http-header', origin: 'https://example.invalid', header: 'Authorization' } }] },
])('rejects unexpected authority, secret-bearing fields, or contradictory status %#', value => {
  expect(integrationSecretReferenceStatusSchema.safeParse(value).success).toBe(false);
});
