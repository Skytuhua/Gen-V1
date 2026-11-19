import {deferred} from './fixtures/deferred.ts';
import { describe, expect, it } from 'vitest';
import { SecretReferenceLedger } from '../packages/core/secret-references.ts';
import type { SecretRefV1, SecretDestinationV1 } from '../packages/contracts/execution-profile.ts';

const destinations: SecretDestinationV1[] = [
  { kind: 'process-env', executableSha256: 'a'.repeat(64), envName: 'API_TOKEN' },
  { kind: 'http-header', origin: 'https://example.test', header: 'Authorization' },
];
const reference = (destination: SecretDestinationV1, refId = 'first'): SecretRefV1 => ({
  version: 1, refId, purpose: 'race fixture', owner: 'account-a', destination,
});

for (const destination of destinations) {
  describe(`M03 pending ${destination.kind} resolution`, () => {
    it('does not release a value revoked while the resolver is pending', async () => {
      const pending = deferred<string>();
      const ledger = new SecretReferenceLedger();
      ledger.register(reference(destination), () => pending.promise);
      const approval = ledger.approve('first', destination);
      const result = ledger.resolve('first', destination, approval);
      const rejected = expect(result).rejects.toMatchObject({ code: 'SECRET_REF_REVOKED' });
      ledger.revoke('first');
      pending.resolve('fixture-not-a-real-credential');
      await rejected;
      await expect(ledger.resolve('first', destination, approval)).rejects.toMatchObject({ code: 'SECRET_REF_REVOKED' });
    });

    it('rechecks expiry before releasing the resolved value', async () => {
      let now = 1_000;
      const pending = deferred<string>();
      const ledger = new SecretReferenceLedger(() => now);
      ledger.register(reference(destination), () => pending.promise);
      const approval = ledger.approve('first', destination, { ttlMs: 50 });
      const result = ledger.resolve('first', destination, approval);
      const rejected = expect(result).rejects.toMatchObject({ code: 'SECRET_REF_APPROVAL' });
      now = 1_050;
      pending.resolve('fixture-not-a-real-credential');
      await rejected;
      await expect(ledger.resolve('first', destination, approval)).rejects.toMatchObject({ code: 'SECRET_REF_APPROVAL' });
    });

    it('preserves unrelated references and single-use approval semantics', async () => {
      const pending = deferred<string>();
      const ledger = new SecretReferenceLedger();
      ledger.register(reference(destination), () => pending.promise);
      ledger.register({ ...reference(destination, 'other'), owner: 'account-b' }, () => 'other-fixture-value');
      const approval = ledger.approve('first', destination);
      const result = ledger.resolve('first', destination, approval);
      ledger.revoke('other');
      pending.resolve('first-fixture-value');
      const resolved = await result;
      expect(Object.values(resolved.env ?? resolved.headers ?? {})).toEqual(['first-fixture-value']);
      await expect(ledger.resolve('first', destination, approval)).rejects.toMatchObject({ code: 'SECRET_REF_APPROVAL' });
    });
  });
}
