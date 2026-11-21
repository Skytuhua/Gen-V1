import type { OverlayAnchor } from '../../../packages/ui-shell/overlay-position';

// Composer-row popovers must not paint over the sidebar: keep them inside the
// chat column (`.workspace-layout-workarea`). Outside the workspace shell —
// embedded frames, dialogs — there is no column, so placement falls back to
// the viewport bounds.
export function workareaBoundary(anchor: HTMLElement | null): OverlayAnchor | null {
  return anchor?.closest<HTMLElement>('.workspace-layout-workarea')?.getBoundingClientRect() ?? null;
}
