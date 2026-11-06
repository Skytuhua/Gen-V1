export const CHAT_MIN_WIDTH = 420;
export const PANEL_MIN_WIDTH = 280;
export const PANEL_MAX_WIDTH = 720;
export const PANEL_GAP = 6;

export function workspacePanelBounds(ownerWidth: number, preferred: number) {
  const owner = Math.max(0, Number.isFinite(ownerWidth) ? ownerWidth : 0);
  const stacked = owner < CHAT_MIN_WIDTH + PANEL_MIN_WIDTH + PANEL_GAP;
  const maximum = stacked ? owner : Math.min(PANEL_MAX_WIDTH, owner - CHAT_MIN_WIDTH - PANEL_GAP);
  const minimum = stacked ? owner : PANEL_MIN_WIDTH;
  const desired = Number.isFinite(preferred) ? preferred : 520;
  return { stacked, minimum, maximum, width: Math.max(minimum, Math.min(maximum, desired)) };
}
