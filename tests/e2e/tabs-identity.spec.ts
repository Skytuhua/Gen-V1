import { test, expect } from '@playwright/test';
import { serveTaskFixture, taskFixture, type TaskSpec } from './task-interface-fixture';
import { validateSurface } from '../../packages/ui-catalog';

const tabsSpec = (labels: string[]): TaskSpec => ({ root: 'tabs', elements: {
  tabs: { type: 'Tabs', props: { labels, stateKey: 'selectedTab', statusBinding: 'operation' }, children: ['first', 'second'] },
  first: { type: 'Input', props: { label: 'First draft', stateKey: 'firstDraft' } },
  second: { type: 'Input', props: { label: 'Second draft', stateKey: 'secondDraft' } },
} });
const operation = { status: 'pending', items: [{ label: 'Details', status: 'neutral' }, { label: 'Preview', status: 'neutral' }] };

for (const savedSelection of ['Details', 'Stale selection']) {
  test(`persisted ambiguous tabs fail safely without writing state (${savedSelection})`, async ({ page }) => {
    // This synthetic persisted snapshot deliberately bypasses fresh surface admission.
    const host = await serveTaskFixture(page, taskFixture(tabsSpec(['Details', 'Details']), { operation }, { selectedTab: savedSelection }));
    await page.goto('/');
    await expect(page.getByRole('alert')).toHaveCount(1);
    await expect(page.getByRole('alert')).toHaveText('This saved tab view is invalid because its labels are not unique.');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('tablist', { includeHidden: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { includeHidden: true })).toHaveCount(0);
    await expect(page.getByRole('tabpanel', { includeHidden: true })).toHaveCount(0);
    await expect(page.locator('.artifact-content input')).toHaveCount(0);
    // Allow the real state save debounce to elapse before asserting no writes.
    await page.waitForTimeout(800);
    expect(host.commands.filter(command => ['state.save', 'action.submit'].includes(command.type))).toEqual([]);
    expect(host.snapshot.userStates[0].values).toEqual({ selectedTab: savedSelection });
  });
}

test('unique tabs retain saved selection and mounted drafts', async ({ page }) => {
  const spec = tabsSpec(['Details', 'Preview']); validateSurface(spec);
  const host = await serveTaskFixture(page, taskFixture(spec, { operation }, { selectedTab: 'Preview' }));
  await page.goto('/');
  const details = page.getByRole('tab', { name: 'Details', exact: true });
  const preview = page.getByRole('tab', { name: 'Preview', exact: true });
  const first = page.getByRole('textbox', { name: 'First draft', includeHidden: true });
  const second = page.getByRole('textbox', { name: 'Second draft', includeHidden: true });
  const assertSelected = async (label: string) => {
    await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
    await expect(page.getByRole('tab', { name: label, exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: label, exact: true })).toHaveAttribute('tabindex', '0');
    await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    await expect(page.getByRole('tabpanel', { includeHidden: true })).toHaveCount(2);
  };
  await assertSelected('Preview');
  await second.fill('Preview draft retained');
  const firstNode = await first.elementHandle(), secondNode = await second.elementHandle();
  await details.click(); await assertSelected('Details'); await first.fill('Details draft retained');
  await details.press('ArrowRight'); await assertSelected('Preview'); await expect(preview).toBeFocused();
  await preview.press('ArrowLeft'); await assertSelected('Details'); await expect(details).toBeFocused();
  await details.press('End'); await assertSelected('Preview'); await expect(preview).toBeFocused();
  await preview.press('Home'); await assertSelected('Details'); await expect(details).toBeFocused();
  await details.press('ArrowLeft'); await assertSelected('Preview'); await expect(preview).toBeFocused();
  await expect.poll(() => host.snapshot.userStates[0].values.selectedTab).toBe('Preview');
  for (const status of ['running', 'success']) {
    host.setInput('operation', { title: 'Review drafts', status, items: [{ label: 'Details', status }, { label: 'Preview', status }] });
    await host.publish();
    await expect(preview.locator('.task-tab-status-slot')).toHaveClass(`task-tab-status-slot status-${status}`);
    await assertSelected('Preview');
    expect(await first.evaluate((node, old) => node === old, firstNode)).toBe(true);
    expect(await second.evaluate((node, old) => node === old, secondNode)).toBe(true);
    await expect(first).toHaveValue('Details draft retained'); await expect(second).toHaveValue('Preview draft retained');
  }
  await expect.poll(() => host.snapshot.userStates[0].values).toEqual({ selectedTab: 'Preview', firstDraft: 'Details draft retained', secondDraft: 'Preview draft retained' });
  const saves = host.commands.filter(command => command.type === 'state.save');
  expect(saves.length).toBeGreaterThan(0);
  for (const command of saves) expect(['Details', 'Preview']).toContain((command.payload.values as Record<string, unknown>).selectedTab);
  expect(host.commands.filter(command => command.type === 'action.submit')).toEqual([]);
});

test('an unknown saved label falls back without rewriting state on render', async ({ page }) => {
  const spec = tabsSpec(['Details', 'Preview']); validateSurface(spec);
  const host = await serveTaskFixture(page, taskFixture(spec, { operation }, { selectedTab: 'Unknown label' }));
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Details', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'First draft' })).toBeVisible();
  await page.waitForTimeout(800);
  expect(host.commands.filter(command => ['state.save', 'action.submit'].includes(command.type))).toEqual([]);
  expect(host.snapshot.userStates[0].values).toEqual({ selectedTab: 'Unknown label' });
});
