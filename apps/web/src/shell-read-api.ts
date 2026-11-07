import type {DraftTransferReferences, NavigationPage, ShellPage, ShellResourceRow, ShellSettingsReadModel, ThreadNavigationRow} from '../../../packages/contracts/shell-read-models.ts';
import {authenticated, csrfToken, read} from './api.ts';

export interface ShellNavigationQuery {limit?: number; cursor?: string; archived?: boolean; text?: string}
const query = (input: Record<string, string | number | boolean | undefined>) => new URLSearchParams(Object.entries(input).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])).toString();
const get = <T,>(path: string, signal?: AbortSignal) => authenticated(() => fetch(path, {credentials: 'same-origin', cache: 'no-store', signal})).then(read<T>);
export const getShellNavigation = (input: ShellNavigationQuery = {}, signal?: AbortSignal) => get<NavigationPage>('/api/shell/navigation?' + query({...input}), signal);
export const getShellNavigationItem = (id: string, signal?: AbortSignal) => get<ThreadNavigationRow>('/api/shell/navigation/' + encodeURIComponent(id), signal);
export const getShellSettingsReadModel = (signal?: AbortSignal) => get<ShellSettingsReadModel>('/api/shell/settings', signal);
export const getShellResources = (input: {limit?: number; cursor?: string} = {}, signal?: AbortSignal) => get<ShellPage<ShellResourceRow>>('/api/shell/resources?' + query({...input}), signal);
export const getDraftTransferReferences = (keys: string[], signal?: AbortSignal) => authenticated(() => fetch('/api/shell/draft-references', {method: 'POST', credentials: 'same-origin', cache: 'no-store', signal, headers: {'Content-Type': 'application/json', 'x-harness-csrf': csrfToken}, body: JSON.stringify({keys})})).then(read<DraftTransferReferences>);
