import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { UsageSummary } from '../apps/web/src/WorkspacePanelBodies';
import { EMPTY_USAGE } from '../packages/contracts';

it('shows the reported cost without inventing a currency or rounding away tiny nonzero amounts', () => {
  const cost = 1e-8;
  const html = renderToStaticMarkup(createElement(UsageSummary, { usage: { ...EMPTY_USAGE, cost } }));
  const value = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 21 }).format(cost);
  expect(html).toContain('Reported cost</dt><dd>' + value + ' (currency not reported)');
});

it('labels an absent cost as unavailable rather than zero', () => {
  const html = renderToStaticMarkup(createElement(UsageSummary, { usage: EMPTY_USAGE }));
  expect(html).toContain('Reported cost</dt><dd>Unavailable</dd>');
});
