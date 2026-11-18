import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HarnessError, type RuntimeAdapter } from '../../packages/contracts/index.ts';
import type { Service, ServiceOptions } from '../../packages/core/service.ts';
import { createToolEffectFlags } from '../../packages/core/tool-effects.ts';
import { initializeEffectKey, openEffectKey, type EffectAuthenticator, type EffectKeyCustody } from '../../packages/core/host-effect-authenticator.ts';
import type { Store } from '../../packages/storage/store.ts';
import { createHermesService } from './hermes-service.ts';

export type EffectServiceOptions = Pick<ServiceOptions, 'toolEffectFlags'>;
interface EffectServiceFactories {
  initializeKey: typeof initializeEffectKey;
  openKey: typeof openEffectKey;
  createService: typeof createHermesService;
}
const markerKind = 'effectAuthorityProfile', markerId = 'global';
const markerSchema = z.strictObject({ version: z.literal(1), keyId: z.string().uuid(), state: z.enum(['initializing', 'ready']) });
const unavailable = () => new HarnessError('EFFECT_KEY_UNAVAILABLE', 'Protected effect authority is unavailable.');

/** The caller owns the profile lease before constructing this production host.
 * A persisted reservation is never interpreted as permission to replace a key. */
export async function createProtectedHermesService(store: Store, native: RuntimeAdapter, options: EffectServiceOptions = {},
  overrides: Partial<EffectServiceFactories> = {}): Promise<Service> {
  const make = { initializeKey: initializeEffectKey, openKey: openEffectKey, createService: createHermesService, ...overrides };
  const flags = createToolEffectFlags(options.toolEffectFlags), toolEffectFlags = flags.snapshot();
  if (!flags.enabled('audit.effectsV1') && !flags.enabled('security.authorityV1')) return make.createService(store, native, { toolEffectFlags });

  let custody: EffectKeyCustody | undefined, authenticator: EffectAuthenticator | undefined, custodyClosing: Promise<void> | undefined;
  const closeCustody = () => custodyClosing ??= (async () => { await custody?.close(); })();
  try {
    // Inspect row presence separately: a retained JSON null is corrupt state,
    // not a new profile for which another signing key may be generated.
    const query = store.db.prepare('SELECT body FROM entities WHERE kind=? AND id=?');
    const read = () => query.get(markerKind, markerId) as { body: string } | undefined;
    const row = read(), fresh = row === undefined;
    const marker = fresh ? { version: 1 as const, keyId: randomUUID(), state: 'initializing' as const }
      : markerSchema.parse(JSON.parse(row.body));
    let expectedBody = fresh ? JSON.stringify(marker) : row.body;
    const assertReserved = () => { if (read()?.body !== expectedBody) throw unavailable(); };
    if (fresh) store.internal('effectAuthority.reserved', null, () => {
      if (read() !== undefined) throw unavailable();
      store.put(markerKind, markerId, null, marker);
    });
    assertReserved();
    custody = fresh
      ? await make.initializeKey(store.dataDir, { keyId: marker.keyId })
      : await make.openKey(store.dataDir, { expectedKeyId: marker.keyId });
    if (custody.authenticator.keyId !== marker.keyId) throw unavailable();
    assertReserved();
    if (marker.state === 'initializing') {
      const ready = { ...marker, state: 'ready' as const };
      store.internal('effectAuthority.ready', null, () => { assertReserved(); store.put(markerKind, markerId, null, ready); });
      expectedBody = JSON.stringify(ready); assertReserved();
    }
    authenticator = custody.authenticator;
  } catch {
    // History remains available. The enabled ledger rejects all new signing
    // and admission without a provider. Retain cleanup failure for disposal.
    await closeCustody().catch(() => {});
  }

  let service: Service;
  try { service = make.createService(store, native, { toolEffectFlags, ...(authenticator ? { toolEffectAuthenticator: authenticator } : {}) }); }
  catch (error) {
    try { await closeCustody(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Product Service setup and key cleanup failed.'); }
    throw error;
  }
  const dispose = service.dispose.bind(service); let closing: Promise<void> | undefined;
  service.dispose = () => closing ??= (async () => {
    const failures: unknown[] = [];
    try { await dispose(); } catch (error) { failures.push(error); }
    finally { try { await closeCustody(); } catch (error) { failures.push(error); } }
    if (failures.length) throw new AggregateError(failures, 'Product Service and protected key cleanup could not be confirmed.');
  })();
  return service;
}
