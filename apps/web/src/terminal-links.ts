// Pure helpers for clickable terminal links (#1536): http(s) URLs only,
// Ctrl/⌘+click activation, desktop bridge or window.open.

/** Validated href for an openable terminal link, or null when unsafe. */
export function terminalLinkUrl(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;
  if (/[\u0000-\u0020\s]/.test(raw)) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return url.href;
}

/** Activation requires primary button + Ctrl or ⌘; plain clicks stay selection clicks. */
export function terminalLinkModifier(event: { button: number; ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.button === 0 && (event.ctrlKey || event.metaKey);
}

/** Toolbar hint text per platform. */
export function terminalLinkHint(platform: string): string {
  return /^Mac/i.test(platform) ? '⌘+click to open' : 'Ctrl+click to open';
}
