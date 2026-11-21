import { authenticated, read } from './api.ts';
import { terminalShellCatalogSchema, type TerminalShellCatalog } from '../../../packages/contracts/terminal-shell.ts';

/** Authenticated shell catalog read; schema-validated, abortable, refresh bypasses the host cache. */
export const getTerminalShells = (refresh = false, signal?: AbortSignal) =>
  authenticated(() => fetch(`/api/terminal-shells${refresh ? '?refresh=1' : ''}`, { credentials: 'same-origin', cache: 'no-store', signal }))
    .then(read<TerminalShellCatalog>)
    .then(value => terminalShellCatalogSchema.parse(value));
