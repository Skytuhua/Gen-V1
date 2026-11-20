import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { UsageDialog, type UsageDialogProps } from '../apps/web/src/UsageDialog';
import type { UsageProviderReport } from '../apps/web/src/usage-presentation';

const report = (id: string): UsageProviderReport => ({ id, scopeId: 'alpha', scopeLabel: 'Synthetic Alpha', providerId: 'provider-a', providerLabel: 'Provider A', inputTokens: 100, outputTokens: 50 });
const refreshButtons = (html: string) => html.match(/class="usage-refresh"/g)?.length ?? 0;
const dialog = (props: Omit<UsageDialogProps, 'onClose'>) => renderToStaticMarkup(createElement(UsageDialog, { ...props, onClose: () => {} }));

it('empty state keeps a single Refresh affordance inside the empty-state body', () => {
  const html = dialog({ open: true, reports: [], onRefresh: async () => {} });
  expect(html).toContain('usage-dialog-empty-state');
  expect(html).toContain('No usage reported yet');
  expect(refreshButtons(html)).toBe(1);
  expect(html.indexOf('usage-dialog-empty-state')).toBeLessThan(html.indexOf('class="usage-refresh"'));
});

it('populated state keeps a single header Refresh', () => {
  const html = dialog({ open: true, reports: [report('r1'), report('r2')], onRefresh: async () => {} });
  expect(html).not.toContain('usage-dialog-empty-state');
  expect(refreshButtons(html)).toBe(1);
});

it('loading skeleton does not duplicate the Refresh affordance', () => {
  const html = dialog({ open: true, reports: [], loading: true, onRefresh: async () => {} });
  expect(html).toContain('usage-dialog-skeleton');
  expect(refreshButtons(html)).toBe(0);
});
