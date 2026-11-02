import type { ConnectionProviderId } from './connections.ts';

/** Local labels and opaque IDs only; credentials stay in the native profile. */
export interface ConnectionAccount {
  id: string;
  providerId: ConnectionProviderId;
  label: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
export type AccountSelections = Partial<Record<ConnectionProviderId, string | null>>;
export function isAccountId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}
export interface AccountUseLease { id:string; nonce:string }
export interface RuntimeAccountResolver {
  get(id: string): ConnectionAccount | null;
  isSigningIn?(providerId: ConnectionProviderId, accountId: string | null): boolean;
  claimUse?(providerId: ConnectionProviderId, accountId: string | null): AccountUseLease;
  releaseUse?(lease:AccountUseLease):void;
}
