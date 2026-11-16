import type { AccountAuthStatus, AccountAuthTarget } from '../../../packages/contracts/authentication';
import type {ModelInfo} from '../../../packages/contracts';
import { authenticated, read, csrfToken } from './api';

export type AccountAuthChanged = (target: AccountAuthTarget, reason: 'completed' | 'signed-out', flowId?: string) => Promise<void>;
type AccountCatalogChanged = (target: AccountAuthTarget, reason: 'completed' | 'signed-out' | 'reconciled', flowId?: string) => Promise<void>;
const authListeners = new Set<AccountCatalogChanged>();
export const onAccountCatalogChanged = (listener: AccountCatalogChanged) => {authListeners.add(listener);return () => {authListeners.delete(listener);};};
export const notifyAccountCatalogChanged: AccountCatalogChanged = async (target, reason, flowId) => {await Promise.all([...authListeners].map(listener=>listener(target,reason,flowId)));};
export const notifyAccountAuthChanged: AccountAuthChanged = notifyAccountCatalogChanged;
export const mergeAccountModels=(current:ModelInfo[],next:ModelInfo[],target?:AccountAuthTarget)=>target?[...current.filter(model=>model.provider!==target.providerId),...next.filter(model=>model.provider===target.providerId)]:next;

export const getAccountAuth = (target: AccountAuthTarget, signal?: AbortSignal) => authenticated(() => fetch('/api/account-auth?' + new URLSearchParams({ providerId: target.providerId, accountId: target.accountId ?? '' }), { credentials: 'same-origin', cache: 'no-store', signal })).then(read<AccountAuthStatus>);
export const signOutAccount = (target: AccountAuthTarget) => authenticated(() => fetch('/api/account-auth/signout', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'x-harness-csrf': csrfToken }, body: JSON.stringify(target) })).then(read<AccountAuthStatus>);
export const cancelAccountPredictions = () => authenticated(() => fetch('/api/composer-prediction/cancel', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'x-harness-csrf': csrfToken }, body: '{}' })).then(read<{cancelled: boolean}>);
