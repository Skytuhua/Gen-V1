import { describe, expect, it, vi } from 'vitest';
import { SecretReferenceLedger } from '../packages/core/secret-references.ts';
import type { SecretDestinationV1, SecretRefV1 } from '../packages/contracts/execution-profile.ts';

const destinations: SecretDestinationV1[] = [
  { kind: 'process-env', executableSha256: 'a'.repeat(64), envName: 'TOKEN' },
  { kind: 'http-header', origin: 'https://api.example.com', header: 'Authorization' },
];

for (const destination of destinations) describe(`secret approval lifetime: ${destination.kind}`, () => {
  function fixture() {
    let time = 1_000;
    const ledger = new SecretReferenceLedger(() => time);
    const resolve = vi.fn(() => 'synthetic-secret-only');
    const ref: SecretRefV1 = { version: 1, refId: 'ttl-fixture', purpose: 'lifetime fixture', owner: 'account-1', destination };
    ledger.register(ref, resolve);
    return { ledger, resolve, advanceTo: (next: number) => { time = next; } };
  }

  it.each([NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid lifetime %s before issuing an approval', ttlMs => {
    const { ledger, resolve } = fixture();
    expect(() => ledger.approve('ttl-fixture', destination, { ttlMs })).toThrowError(/finite safe integer/);
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, 60_000], [25, 25], [0, 1], [-10, 1], [600_000, 300_000],
  ] as const)('retains finite lifetime normalization for %s and rejects exact expiry', async (ttlMs, expected) => {
    const { ledger, resolve, advanceTo } = fixture();
    const approval = ledger.approve('ttl-fixture', destination, { ttlMs });
    expect(approval.expiresAt).toBe(1_000 + expected);
    advanceTo(approval.expiresAt);
    await expect(ledger.resolve('ttl-fixture', destination, approval)).rejects.toMatchObject({ code: 'SECRET_REF_APPROVAL' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('preserves an unrelated valid approval after a refused request and consumes it once', async () => {
    const { ledger, resolve } = fixture();
    const approval = ledger.approve('ttl-fixture', destination, { ttlMs: 50 });
    expect(() => ledger.approve('ttl-fixture', destination, { ttlMs: NaN })).toThrowError(/finite safe integer/);
    const result = await ledger.resolve('ttl-fixture', destination, approval);
    expect(destination.kind === 'process-env' ? result.env?.TOKEN : result.headers?.Authorization).toBe('synthetic-secret-only');
    await expect(ledger.resolve('ttl-fixture', destination, approval)).rejects.toMatchObject({ code: 'SECRET_REF_APPROVAL' });
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
