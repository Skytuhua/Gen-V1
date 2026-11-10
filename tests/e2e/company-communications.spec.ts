import {expect, test, type Page} from '@playwright/test';

async function isolatedHost(page: Page) {
  const calls: {path: string; method: string}[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    calls.push({path, method: request.method()});
    if (path === '/api/bootstrap') return route.fulfill({json: {csrfToken: 'PUBLIC-stage1-test'}});
    if (path === '/api/company/connection') return route.fulfill({status: 503, json: {error: {code: 'COMPANY_UNAVAILABLE', message: 'No live fixture host'}}});
    return route.fulfill({status: 403, json: {error: {code: 'FORBIDDEN', message: 'Unexpected operation'}}});
  });
  return calls;
}
const surfaces = (page: Page) => page.getByRole('navigation', {name: 'Communication surfaces'});

test('project room → task thread → addressed inbox preserves one canonical identity and honest delivery states', async ({page}) => {
  const calls = await isolatedHost(page);
  await page.goto('/company/communications?fixture=communications');
  await expect(page.getByRole('heading', {name: 'Communications', exact: true})).toBeVisible();
  await expect(page.getByText('Synthetic fixture · no live employees', {exact: true})).toBeVisible();
  const message = page.getByRole('article');
  await expect(message).toHaveCount(1);
  const id = await message.getAttribute('data-message-id');
  expect(id).toMatch(/^[a-f0-9-]{36}$/);
  await expect(message.getByText('Accepted by service', {exact: true})).toBeVisible();
  await expect(message.getByText('Received by supervisor', {exact: true})).toBeVisible();
  await expect(message.getByText('Consumed: unavailable', {exact: true})).toBeVisible();
  await message.getByRole('button', {name: 'Open task thread'}).click();
  await expect(page.getByRole('heading', {name: 'Inspect the backend handoff', exact: true})).toBeVisible();
  await expect(page.getByRole('article')).toHaveAttribute('data-message-id', id!);
  await page.getByRole('article').getByRole('button', {name: 'Addressed inbox', exact: true}).click();
  await expect(page.getByRole('combobox', {name: 'Addressed employee'})).toHaveValue('E11');
  await expect(page.getByRole('article')).toHaveAttribute('data-message-id', id!);
  await expect(page.getByRole('button', {name: 'Approve unavailable'})).toBeDisabled();
  await surfaces(page).getByRole('button', {name: 'Plain text fallback'}).click();
  await expect(page.getByLabel('Plain communication records')).toContainText(`Message ${id}`);
  await expect(page.getByLabel('Plain communication records')).toContainText('Consumed: unavailable');
  expect(calls.every(call => ['GET'].includes(call.method) && ['/api/bootstrap', '/api/company/connection'].includes(call.path))).toBe(true);
});

test('task draft, view and open evidence survive updates, disconnect, reconnect and reload without submission', async ({page, context}) => {
  const calls = await isolatedHost(page);
  await page.goto('/company/communications?fixture=communications');
  await surfaces(page).getByRole('button', {name: 'Task thread', exact: true}).click();
  const draft = page.getByRole('textbox', {name: 'Task reply draft'});
  await expect(draft).toBeEnabled();
  await draft.fill('Keep this question for the backend review.');
  await expect(page.getByText('Saved on this device · not sent', {exact: true})).toBeVisible();
  await page.getByText('Delivery and evidence', {exact: true}).click();
  await page.getByRole('button', {name: 'Refresh communication view'}).click();
  await expect(draft).toHaveValue('Keep this question for the backend review.');
  await expect(page.getByText('Consumed by model', {exact: true})).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText(/Disconnected · showing the last loaded view/)).toBeVisible();
  await expect(page.getByRole('button', {name: 'Refresh communication view'})).toBeDisabled();
  await expect(draft).toHaveValue('Keep this question for the backend review.');
  await context.setOffline(false);
  await page.getByRole('button', {name: 'Refresh communication view'}).click();
  await page.reload();
  await expect(draft).toHaveValue('Keep this question for the backend review.');
  await expect(page.getByText('Consumed by model', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Send unavailable'})).toBeDisabled();
  await page.getByText('Delivery and evidence', {exact: true}).click();
  await expect(page.getByText('Consumed by model', {exact: true})).toBeHidden();
  await page.reload();
  await expect(draft).toHaveValue('Keep this question for the backend review.');
  await expect(page.getByText('Consumed by model', {exact: true})).toBeHidden();
  expect(calls.every(call => call.method === 'GET')).toBe(true);
});

test('unconfigured company data never silently substitutes fixtures; narrow layout stays usable', async ({page}) => {
  await isolatedHost(page);
  await page.goto('/company/communications');
  await expect(page.getByRole('heading', {name: 'Communication data unavailable'})).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('combobox', {name: 'Communication data source'})).toHaveValue('company');
  await page.getByRole('button', {name: 'Open Stage 1 fixture'}).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(surfaces(page).getByRole('button', {name: 'Task thread', exact: true})).toBeVisible();
  await page.getByRole('combobox', {name: 'Communication data source'}).selectOption('company');
  await page.reload();
  await expect(page.getByRole('combobox', {name: 'Communication data source'})).toHaveValue('company');
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('trusted read adapter keeps drafts on transport failure and clears protected data on current access denial', async ({page}) => {
  await isolatedHost(page);
  await page.goto('/company/communications');
  await expect(page.getByRole('heading', {name: 'Communication data unavailable'})).toBeVisible();
  await page.evaluate(async path => {const {mount} = await import(/* @vite-ignore */ path); mount();}, `/@fs/${process.cwd().replaceAll('\\', '/')}/tests/e2e/company-communication-adapter.tsx`);
  const host = page.getByTestId('trusted-read-test');
  await expect(host.getByRole('article')).toHaveCount(1);
  await host.getByRole('navigation', {name: 'Communication surfaces'}).getByRole('button', {name: 'Task thread', exact: true}).click();
  const draft = host.getByRole('textbox', {name: 'Task reply draft'});
  await draft.fill('Retain this private unsent draft.');
  await expect(host.getByText('Saved on this device · not sent', {exact: true})).toBeVisible();
  await host.getByRole('button', {name: 'Refresh communication view'}).click();
  await expect(host.getByRole('alert')).toContainText('previous read remains visible');
  await expect(host.getByRole('article')).toHaveCount(1);
  await expect(draft).toHaveValue('Retain this private unsent draft.');
  await host.getByRole('button', {name: 'Refresh communication view'}).click();
  await expect(host.getByRole('alert')).toContainText('Protected records have been cleared');
  await expect(host.getByRole('article')).toHaveCount(0);
  await expect(host).not.toContainText('DO-NOT-RENDER-PRIVATE-ERROR');
  await host.getByRole('button', {name: 'Refresh communication view'}).click();
  await expect(draft).toHaveValue('Retain this private unsent draft.');
});
