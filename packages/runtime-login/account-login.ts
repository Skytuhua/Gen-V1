import { Store } from '../storage/store.ts';
import { withAccountProfile } from '../runtime/account-profile.ts';
import { beginAccountLogin, endAccountLogin, holdAccountLogin, resolveLoginAccount } from '../core/accounts.ts';
import type { ConnectionProviderId } from '../contracts/connections.ts';

/** Hold a metadata lease; native runtimes exclusively own the credential bytes. */
export async function withAccountLogin(request: { dataDir: string; provider: ConnectionProviderId; accountId?: string }, run: (dataDir: string) => Promise<void>): Promise<void> {
  const store = new Store(request.dataDir);
  let lease: ReturnType<typeof beginAccountLogin> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const accountId = request.accountId ?? null;
    const account = resolveLoginAccount(store, request.provider, accountId);
    lease = beginAccountLogin(store, request.provider, accountId);
    // Native login handlers abort on SIGTERM. Bound active login time, but never
    // infer native shutdown from the deadline or a dead console's PID.
    deadline = setTimeout(() => process.emit('SIGTERM'), 14 * 60 * 1000); deadline.unref();
    await withAccountProfile(store.dataDir, account, async root => {
      try { await run(root); }
      catch (error) {
        if ((error as {code?: unknown} | null)?.code === 'PI_CANCEL_UNCONFIRMED') holdAccountLogin(store, lease!);
        throw error;
      }
    });
  } finally {
    clearTimeout(deadline);
    try { if (lease) endAccountLogin(store, lease); } finally { store.close(); }
  }
}
