import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach } from 'vitest';
import { createEffectAuthenticator, type RevocableEffectAuthenticator } from '../../packages/core/host-effect-authenticator.ts';

const owned = new Set<RevocableEffectAuthenticator>();
afterEach(() => { for (const signer of owned) signer.revoke(); owned.clear(); });

/** Explicit fixture injection. This exercises real crypto, not protected OS custody. */
export function testEffectAuthenticator(): RevocableEffectAuthenticator {
  const signer = createEffectAuthenticator(randomBytes(32), randomUUID());
  owned.add(signer);
  return signer;
}
