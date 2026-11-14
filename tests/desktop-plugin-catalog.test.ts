import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { PluginDesktopView } from '../apps/web/src/DesktopEntry.tsx';

const catalog = vi.hoisted(() => vi.fn());
vi.mock('../apps/web/src/PluginFrame', () => ({ usePluginCatalog: catalog, PluginFrame: () => 'plugin frame' }));
vi.mock('../apps/web/src/App', () => ({ App: () => null, OperationDecision: () => null }));
vi.mock('../apps/web/src/desktop-context', () => ({
  useDesktop: () => ({ context: { surface: { kind: 'plugin', pluginId: 'sample' } }, closing: false, bridge: {} }),
  DesktopWindowActions: () => null,
}));

function render(options: Record<string, unknown>) {
  catalog.mockReturnValue({ plugins: [], theme: 'dark', retry: vi.fn(), ...options });
  return renderToStaticMarkup(createElement(PluginDesktopView));
}

it('keeps a pending native plug-in catalog in a loading state', () => {
  expect(render({ loaded: false })).toContain('Opening the owning plug-in');
});

it('shows a retry for a failed native plug-in catalog request', () => {
  const html = render({ loaded: false, failed: true });
  expect(html).toContain('Plug-ins could not be loaded');
  expect(html).toContain('Retry loading plug-ins');
  expect(html).not.toContain('Opening the owning plug-in');
});

it('reports a missing owner after the catalog resolves without mounting a frame', () => {
  const html = render({ loaded: true, error: 'The saved plug-in could not load.' });
  expect(html).toContain('The saved plug-in could not load.');
  expect(html).not.toContain('Opening the owning plug-in');
  expect(html).not.toContain('plugin frame');
});
