import { randomUUID } from 'node:crypto';
import type { AccountLoginFlow } from '../../packages/contracts/authentication.ts';
import type { ConnectionProviderId } from '../../packages/contracts/connections.ts';
import type { DesktopSignInHandle } from './auth-launcher.ts';

/** Main-process ownership survives renderer navigation. Only an owning flow can cancel. */
export function createAccountLoginFlows(launch: (provider: ConnectionProviderId, accountId: string | null, signal: AbortSignal) => Promise<DesktopSignInHandle>) {
  const history = new Map<string, AccountLoginFlow>();
  type Owner = { flow: AccountLoginFlow; control: AbortController; handle?: DesktopSignInHandle; starting?: Promise<void> };
  let active: Owner | undefined;
  const update = (owner: Owner, state: AccountLoginFlow['state'], message: string) => {
    owner.flow = { ...owner.flow, state, message, updatedAt: new Date().toISOString() }; history.set(owner.flow.id, owner.flow);
  };
  const status = (id: string) => { const flow = history.get(id); return flow ? { ...flow } : null; };
  return {
    status,
    async start(providerId: ConnectionProviderId, accountId: string | null): Promise<AccountLoginFlow> {
      if (active) {
        if (active.flow.providerId !== providerId || active.flow.accountId !== accountId || active.flow.state === 'blocked') throw Error('Finish the current sign-in and confirm native cleanup before starting another.');
        return { ...active.flow };
      }
      const stamp = new Date().toISOString();
      const owner: Owner = active = { flow: { id: randomUUID(), providerId, accountId, state: 'opening', startedAt: stamp, updatedAt: stamp, message: 'Opening the private connection console.' }, control: new AbortController() };
      history.set(owner.flow.id, owner.flow);
      while (history.size > 100) history.delete(history.keys().next().value!);
      owner.starting = (async () => {
        try {
          owner.handle = await launch(providerId, accountId, owner.control.signal);
          if (active !== owner) return;
          update(owner, 'waiting', 'Complete sign-in in the private native console.');
          void owner.handle.completion.then(() => {
            if (active !== owner) return;
            update(owner, 'completed', 'Console completed. Check connection status to confirm readiness.'); active = undefined;
          }, (error: unknown) => {
            if (active !== owner || owner.flow.state === 'cancelling' || owner.flow.state === 'blocked') return;
            if ((error as {code?:unknown})?.code === 'RUNTIME_TEARDOWN_FAILED') { update(owner, 'blocked', 'Native shutdown could not be confirmed. This account remains blocked.'); return; }
            update(owner, 'failed', 'The sign-in console did not complete. Check connection status before retrying.'); active = undefined;
          });
        } catch (error) {
          if (active === owner) {
            if ((error as {code?:unknown})?.code === 'RUNTIME_TEARDOWN_FAILED') { update(owner, 'blocked', 'Native shutdown could not be confirmed. This account remains blocked.'); return; }
            update(owner, owner.flow.state === 'cancelling' ? 'cancelled' : 'failed', owner.flow.state === 'cancelling' ? 'Console startup cancelled. Check connection status before retrying.' : 'The sign-in console could not open. Check connection status before retrying.'); active = undefined;
          }
        }
      })();
      return { ...owner.flow };
    },
    async cancel(id: string): Promise<AccountLoginFlow> {
      const owner = active;
      if (!owner || owner.flow.id !== id) throw Error('This sign-in flow is no longer active.');
      if(owner.flow.state==='blocked')throw Error('Native shutdown could not be confirmed.');
      update(owner, 'cancelling', 'Closing the owned sign-in console.'); owner.control.abort();
      try {
        await owner.starting;
        if(status(owner.flow.id)?.state==='blocked')throw Error('Native shutdown could not be confirmed.');
        await owner.handle?.cancel();
        if (active === owner) { update(owner, 'cancelled', 'Console closed. Check connection status; native cleanup may still require recovery.'); active = undefined; }
      } catch { if (active === owner) update(owner, 'blocked', 'Native shutdown could not be confirmed. This account remains blocked.'); throw Error('Native shutdown could not be confirmed.'); }
      return { ...owner.flow };
    },
    async close() { if (active) await this.cancel(active.flow.id); },
  };
}
