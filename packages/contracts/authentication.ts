import type { ConnectionProviderId } from './connections.ts';

/** Public metadata only. A configured credential does not establish identity or entitlement. */
export interface AccountAuthTarget { providerId: ConnectionProviderId; accountId: string | null }
export interface AccountIdentity {
  availability: 'verified' | 'metadata' | 'unavailable';
  subject: string | null;
  email: string | null;
  organization: string | null;
  subscription: string | null;
}
export interface AccountAuthStatus extends AccountAuthTarget {
  state: 'signed-out' | 'configured' | 'authenticated' | 'signing-in' | 'blocked' | 'unknown' | 'unavailable';
  identity: AccountIdentity;
  lastCheckedAt: string | null;
  localSignout: boolean;
  message: string;
}
export interface AccountLoginFlow extends AccountAuthTarget {
  id: string;
  state: 'opening' | 'waiting' | 'cancelling' | 'completed' | 'cancelled' | 'failed' | 'blocked';
  startedAt: string;
  updatedAt: string;
  message: string;
}
export const unavailableIdentity = (): AccountIdentity => ({ availability: 'unavailable', subject: null, email: null, organization: null, subscription: null });
