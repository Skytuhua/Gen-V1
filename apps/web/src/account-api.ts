import type { AccountAuthStatus, AccountAuthTarget } from '../../../packages/contracts/authentication';
import { authenticated, read, csrfToken } from './api';

export const getAccountAuth = (target: AccountAuthTarget) => authenticated(() => fetch('/api/account-auth?' + new URLSearchParams({ providerId: target.providerId, accountId: target.accountId ?? '' }), { credentials: 'same-origin', cache: 'no-store' })).then(read<AccountAuthStatus>);
export const signOutAccount = (target: AccountAuthTarget) => authenticated(() => fetch('/api/account-auth/signout', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'x-harness-csrf': csrfToken }, body: JSON.stringify(target) })).then(read<AccountAuthStatus>);
export const cancelAccountPredictions = () => authenticated(() => fetch('/api/composer-prediction/cancel', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'x-harness-csrf': csrfToken }, body: '{}' })).then(read<{cancelled: boolean}>);
