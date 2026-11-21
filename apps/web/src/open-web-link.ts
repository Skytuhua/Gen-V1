// Opens a validated http(s) link: the desktop bridge in the packaged app,
// a new browsing context in the browser host. Never sends a Gen host request.
export async function openWebLink(url: string): Promise<void> {
  const bridge = (globalThis as { harnessDesktop?: { openExternal?: (value: string) => Promise<void> } }).harnessDesktop;
  if (bridge?.openExternal) { await bridge.openExternal(url); return; }
  globalThis.open(url, '_blank', 'noopener,noreferrer');
}
