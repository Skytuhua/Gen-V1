import { z } from 'zod';
import { HarnessError } from '../contracts/index.ts';
import type { Store } from '../storage/store.ts';

type AdmissionMode = 'AUDIT' | 'AUTHENTICATED';
type Flags = { enabled(key: 'audit.effectsV1' | 'security.authorityV1'): boolean };
const kind = 'toolEffectAdmissionPolicy', id = 'global';
const policySchema = z.strictObject({ version: z.literal(1), mode: z.enum(['AUDIT', 'AUTHENTICATED']) });

/** A profile that has used the ledger never falls back to legacy admission.
 * This latch preserves required policy; it does not enable either host flag. */
export class EffectAdmissionPolicy {
  private required: AdmissionMode | null = null;
  private invalid = false;
  constructor(store: Store, private readonly flags: Flags) {
    try {
      const query = store.db.prepare('SELECT body FROM entities WHERE kind=? AND id=?');
      const read = () => query.get(kind, id) as { body: string } | undefined;
      const row = read(), prior = row === undefined ? null : policySchema.parse(JSON.parse(row.body)).mode;
      const present = store.db.prepare('SELECT 1 FROM entities WHERE kind=? LIMIT 1');
      // Existing receipts identify pre-latch profiles without changing them.
      // Any approval requires the authenticated path; effects or a key marker
      // at least prohibit falling back to an unobserved legacy admission.
      const history: AdmissionMode | null = present.get('approval') ? 'AUTHENTICATED'
        : present.get('toolEffect') || present.get('effectAuthorityProfile') ? 'AUDIT' : null;
      const selected: AdmissionMode | null = flags.enabled('security.authorityV1') ? 'AUTHENTICATED'
        : flags.enabled('audit.effectsV1') ? 'AUDIT' : null;
      this.required = [prior, history, selected].includes('AUTHENTICATED') ? 'AUTHENTICATED'
        : prior || history || selected;
      if (selected && this.required && this.required !== prior) store.internal('toolEffect.policy', null, () => {
        if (read()?.body !== row?.body) throw Error('Effect admission policy changed');
        store.put(kind, id, null, { version: 1, mode: this.required });
      });
    } catch {
      // Malformed or unpersistable policy blocks admission, while Service and
      // historical read models can still be constructed for inspection.
      this.invalid = true;
    }
  }
  get disabled(): boolean {
    return this.invalid || (this.required === 'AUTHENTICATED' ? !this.flags.enabled('security.authorityV1')
      : this.required === 'AUDIT' && !this.flags.enabled('audit.effectsV1') && !this.flags.enabled('security.authorityV1'));
  }
  assertEnabled(): void {
    if (this.disabled) throw new HarnessError('EFFECT_ADMISSIONS_DISABLED', 'Effect admissions are disabled for this protected profile.');
  }
}
