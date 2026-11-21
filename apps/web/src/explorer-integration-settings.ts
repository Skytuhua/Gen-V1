// Presentation model for the Windows-only "Open in Gen V1" File Explorer
// settings row (plan r1 T06, T08 design spec state table). Pure and
// dependency-injected: the row itself renders on the main desktop surface only
// when the bridge exposes explorerIntegration (Windows preload), so the model
// never has to reason about platform — only about service states.

import type { ExplorerIntegrationStatus } from '../../../packages/desktop-contract/index.ts';

export const EXPLORER_INTEGRATION_TITLE = 'Show “Open in Gen V1” in File Explorer';
export const EXPLORER_INTEGRATION_HELPER = 'Adds a right-click command on folders in Windows File Explorer that opens the folder as a project here.';
export const EXPLORER_INTEGRATION_PARTIAL = 'Registration is incomplete — turn it off and on to repair.';
export const EXPLORER_INTEGRATION_WRITE_FAILED = 'Couldn’t update File Explorer — Windows refused the registry write.';
export const EXPLORER_INTEGRATION_READ_FAILED = 'Can’t tell whether the Explorer entry is registered.';

export interface ExplorerIntegrationRowInput {
  /** Latest read-back status; null while the first read is in flight. */
  status: ExplorerIntegrationStatus | null;
  applying: boolean;
  failure: 'read' | 'write' | null;
}
export interface ExplorerIntegrationRowModel {
  /** Switch position reflects the actual read state — never an optimistic flip. */
  checked: boolean;
  disabled: boolean;
  helper: string;
  danger: boolean;
  /** Which action the inline Retry link retries; null hides it. */
  retry: 'toggle' | 'read' | null;
}

export function explorerIntegrationRowModel(input: ExplorerIntegrationRowInput): ExplorerIntegrationRowModel {
  const checked = input.status?.enabled === true;
  if (input.applying) return { checked, disabled: true, helper: 'Applying…', danger: false, retry: null };
  if (input.failure === 'write') return { checked, disabled: false, helper: EXPLORER_INTEGRATION_WRITE_FAILED, danger: true, retry: 'toggle' };
  if (input.failure === 'read' || input.status?.state === 'unknown') return { checked: false, disabled: false, helper: EXPLORER_INTEGRATION_READ_FAILED, danger: true, retry: 'read' };
  if (input.status === null) return { checked: false, disabled: true, helper: 'Reading File Explorer registration…', danger: false, retry: null };
  if (input.status.state === 'partial') return { checked: false, disabled: false, helper: `${EXPLORER_INTEGRATION_HELPER} ${EXPLORER_INTEGRATION_PARTIAL}`, danger: false, retry: null };
  return { checked, disabled: false, helper: EXPLORER_INTEGRATION_HELPER, danger: false, retry: null };
}
