import { test, expect, type Page } from '@playwright/test';
import type { RelationshipData } from '../../packages/ui-catalog/workflow';
import { serveTaskFixture, taskFixture, type TaskSpec } from './task-interface-fixture';

// Authored protocol fixtures exercise the shared renderer, not GitHub or a model.
const spec = (orientation: 'horizontal' | 'vertical'): TaskSpec => ({ root: 'graph', elements: {
  graph: { type: 'RelationshipGraph', props: { dataBinding: 'network', stateKey: 'selected', orientation, label: 'Collection branches' }, children: ['continue'] },
  continue: { type: 'Button', props: { actionId: 'feedback', label: 'Continue review', tone: 'primary' } },
} });
const network = (): RelationshipData => ({
  source: 'Authored collection fixture; no remote effects.',
  nodes: [
    { id: 'base', label: 'Shared collection', lane: 0, column: 0, kind: 'point', tone: 'neutral', hash: '1ab3f25' },
    { id: 'main', label: 'Review printing', lane: 0, column: 1, kind: 'point', tone: 'teal', hash: '2bc4a36' },
    { id: 'topic', label: 'Review ceramics', lane: 1, column: 1, tone: 'blue', hash: '3cd5b47', conflictCount: 2, status: 'pending', detail: 'materials.ts 路 line 18', excerpts: [{ label: 'Mira', text: 'const process = kiln;' }, { label: 'You', text: 'const process = glaze;' }] },
    { id: 'next', label: 'Review framing', lane: 0, column: 2, tone: 'teal', hash: '4de6c58', conflictCount: 1, status: 'pending', detail: 'frames.ts 路 line 42', excerpts: [{ label: 'Jules', text: 'return frame(paper);' }, { label: 'You', text: 'return frame(board);' }] },
    { id: 'end', label: 'Ready to combine', lane: 0, column: 4, kind: 'endpoint', status: 'pending' },
  ],
  edges: [{ from: 'base', to: 'main' }, { from: 'base', to: 'topic' }, { from: 'main', to: 'next' }, { from: 'next', to: 'end', prospective: true, status: 'pending' }, { from: 'topic', to: 'end', prospective: true, status: 'pending' }],
  branchLabels: [{ label: 'Print collection', lane: 0, column: 1, tone: 'teal' }, { label: 'Ceramic collection', lane: 1, column: 1, tone: 'blue' }],
  summary: { label: 'Three comparisons need review', status: 'pending' },
});
async function fixture(page: Page, orientation: 'horizontal' | 'vertical' = 'horizontal') {
  const snapshot = taskFixture(spec(orientation), { network: network() });
  snapshot.artifacts[0].presentation = { width: 'compact', frame: 'card' };
  const host = await serveTaskFixture(page, snapshot); await page.goto('/');
  await expect(page.locator('.task-graph')).toBeVisible();
  await expect.poll(() => page.locator('.task-graph').evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  return host;
}
const graphNode = (page: Page, name: string) => page.locator('.task-graph').getByRole('button', { name: new RegExp('^' + name) });
const dot = (page: Page, name: string) => graphNode(page, name).locator('.task-graph-dot');
const center = async (page: Page, name: string) => { const box = await dot(page, name).boundingBox(); return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }; };

test('explicit columns preserve concurrency and existing geometry when a new branch point arrives', async ({ page }) => {
  const host = await fixture(page);
  const main = await center(page, 'Review printing'), topic = await center(page, 'Review ceramics');
  expect(main.x).toBeCloseTo(topic.x, 0);
  expect(topic.y - main.y).toBeGreaterThan(30); expect(topic.y - main.y).toBeLessThan(65);
  await graphNode(page, 'Review ceramics').click();
  await expect.poll(() => host.snapshot.userStates[0].values.selected).toBe('topic');
  await dot(page, 'Review ceramics').evaluate(node => { node.setAttribute('data-retained', 'yes'); });
  const updated = network(); updated.nodes.splice(2, 0, { id: 'inserted', label: 'Review lighting', lane: 2, column: 2, kind: 'point', tone: 'purple' });
  host.setInput('network', updated); await host.publish();
  await expect(graphNode(page, 'Review lighting')).toBeVisible();
  expect((await center(page, 'Review ceramics')).x).toBeCloseTo(topic.x, 0);
  await expect(dot(page, 'Review ceramics')).toHaveAttribute('data-retained', 'yes');
  await expect(graphNode(page, 'Review ceramics')).toHaveAttribute('aria-pressed', 'true');
});

test('point nodes stay compact while branch captions and future paths retain their own geometry', async ({ page }) => {
  await fixture(page);
  const point = await graphNode(page, 'Review printing').boundingBox();
  expect(point!.width).toBeLessThanOrEqual(30); expect(point!.height).toBeLessThanOrEqual(30);
  await expect(page.locator('.task-graph-branch-label').filter({ hasText: 'Ceramic collection' })).toBeVisible();
  const future = page.locator('.graph-edge[data-prospective="true"]'); await expect(future).toHaveCount(2);
  expect(await future.first().evaluate(node => getComputedStyle(node).strokeDasharray)).not.toBe('none');
  await graphNode(page, 'Review printing').focus();
  await expect(page.getByRole('tooltip')).toContainText('2bc4a36');
});

test('a generated action shares the status footer and source detail stays behind inspection', async ({ page }) => {
  const host = await fixture(page, 'vertical');
  const action = page.getByRole('button', { name: 'Continue review', exact: true }); await expect(action).toBeVisible();
  const footer = page.locator('.task-graph-footer-row');
  const bounds = await footer.boundingBox(), button = await action.boundingBox();
  expect(button!.x).toBeGreaterThan(bounds!.x + bounds!.width / 2);
  expect(Math.abs(button!.y + button!.height / 2 - bounds!.y - bounds!.height / 2)).toBeLessThan(12);
  await expect(page.getByText('Authored collection fixture; no remote effects.', { exact: true })).toBeHidden();
  await page.getByText('Inspect source', { exact: true }).click();
  await expect(page.getByText('Authored collection fixture; no remote effects.', { exact: true })).toBeVisible();
  await action.click(); await expect.poll(() => host.commands.filter(command => command.type === 'action.submit').length).toBe(1);
});

test('aggregate conflicts reveal a readable keyboard-accessible stacked comparison', async ({ page }) => {
  await fixture(page, 'vertical');
  await page.getByRole('button', { name: 'Inspect 3 conflicts', exact: true }).focus();
  const tooltip = page.getByRole('tooltip'); await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('materials.ts 路 line 18'); await expect(tooltip).toContainText('frames.ts 路 line 42');
  await expect(tooltip).toContainText('const process = kiln;'); await expect(tooltip).toContainText('return frame(board);');
  expect((await tooltip.boundingBox())!.width).toBeGreaterThanOrEqual(440);
  const rows = await tooltip.locator('.task-node-excerpts>span').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().y));
  expect(rows[1]).toBeGreaterThan(rows[0]);
});

test('branch identity remains separate from conflict status and explicit completion tone', async ({ page }) => {
  const host = await fixture(page);
  const before = await dot(page, 'Review ceramics').evaluate(node => getComputedStyle(node).backgroundColor);
  const badge = graphNode(page, 'Review ceramics').locator('.task-node-conflicts');
  expect(await badge.evaluate(node => getComputedStyle(node).color)).not.toBe(before);
  const updated = network(); updated.tone = 'merged'; updated.nodes.find(node => node.id === 'topic')!.status = 'merged';
  host.setInput('network', updated); await host.publish();
  await expect.poll(() => dot(page, 'Review ceramics').evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(before);
  expect(await dot(page, 'Review ceramics').evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(await dot(page, 'Review framing').evaluate(node => getComputedStyle(node).backgroundColor));
});

test('narrow inline graphs fit the chat width and reduced motion avoids travelling nodes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await fixture(page);
  const viewport = page.locator('.task-graph-viewport');
  expect(await viewport.evaluate(node => node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const durations = await page.locator('.task-node').first().evaluate(node => getComputedStyle(node).transitionDuration.split(',').map(value => Number.parseFloat(value)));
  expect(Math.max(...durations)).toBeLessThanOrEqual(.001);
  const node=page.locator('.task-graph-body').getByRole('button').first();await node.focus();
  await expect(node).toBeFocused();
});
