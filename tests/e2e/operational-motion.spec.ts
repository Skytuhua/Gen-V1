import { test, expect } from '@playwright/test';
import { graphData, graphSpec } from '../../scripts/review-fixtures';
import { branchGraphData, branchGraphSpec, migrationTableSpec, serveTaskFixture, taskFixture } from './task-interface-fixture';

test('PR phases retain busy actions and add resolution history before merged checks exit', async ({ page }) => {
  const initial = taskFixture(graphSpec('vertical', 'conflicts'), { graph: graphData('conflicts') });
  initial.artifacts[0].actions = { resolve: { kind: 'agent' }, merge: { kind: 'agent' } };
  const fixture = await serveTaskFixture(page, initial); await page.goto('/');
  const resolve = page.getByRole('button', { name: 'Resolve conflicts', exact: true }); await expect(resolve).toBeVisible();
  const identity = await resolve.elementHandle(), beforeRows = await page.locator('[data-node-id]').count();
  fixture.snapshot.artifacts[0].spec = graphSpec('vertical', 'resolving'); fixture.setInput('graph', graphData('resolving', 8)); await fixture.publish();
  const busy = page.getByRole('button', { name: 'Resolving…', exact: true }); await expect(busy).toBeDisabled();
  expect(await busy.evaluate((node, old) => node === old, identity)).toBe(true);
  fixture.snapshot.artifacts[0].spec = graphSpec('vertical', 'ready'); fixture.setInput('graph', graphData('ready')); await fixture.publish();
  await expect(page.getByRole('button', { name: 'Merge', exact: true })).toBeVisible();
  expect(await page.locator('[data-node-id]').count()).toBeGreaterThan(beforeRows);
  fixture.snapshot.artifacts[0].spec = graphSpec('vertical', 'merged'); fixture.setInput('graph', graphData('merged')); await fixture.publish();
  await expect(page.locator('.task-graph')).toHaveAttribute('data-tone', 'merged');
  await expect(page.locator('.task-graph-checks')).toHaveCount(0);
});

test('vertical row dots and existing SVG endpoints remain attached throughout history insertion', async ({ page }) => {
  const fixture = await serveTaskFixture(page, taskFixture(branchGraphSpec('vertical'), { graph: branchGraphData })); await page.goto('/');
  await expect(page.locator('[data-node-id=base]')).toBeVisible(); await page.waitForTimeout(500);
  fixture.setInput('graph', { ...branchGraphData, nodes: [{ id: 'inserted', label: 'Resolved merge', lane: 0, status: 'success' }, ...branchGraphData.nodes] });
  await fixture.publish(); await expect(page.locator('[data-node-id=inserted]')).toBeVisible();
  const samples = await page.locator('.task-graph').evaluate(async graph => {
    const gaps: number[] = [], rowPositions: number[] = [], arrivingOpacity: number[] = [], start = performance.now();
    while (performance.now() - start < 420) {
      const path = graph.querySelector<SVGPathElement>('.graph-edge')!, point = path.getPointAtLength(0), transform = path.getScreenCTM()!;
      const endpoint = new DOMPoint(point.x, point.y).matrixTransform(transform), dot = graph.querySelector('[data-node-id=base] .task-graph-dot')!.getBoundingClientRect();
      gaps.push(Math.hypot(endpoint.x - dot.x - dot.width / 2, endpoint.y - dot.y - dot.height / 2)); rowPositions.push(dot.y); arrivingOpacity.push(Number(getComputedStyle(graph.querySelector('[data-node-id=inserted]')!).opacity));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    return { gaps, rowPositions, arrivingOpacity };
  });
  expect(Math.max(...samples.gaps)).toBeLessThan(2);
  expect(Math.max(...samples.rowPositions) - Math.min(...samples.rowPositions)).toBeGreaterThan(2);
  expect(Math.min(...samples.arrivingOpacity)).toBeLessThan(.95);
});

test('accepted cell values reveal with the change highlight and sweep follows declared rows without replay', async ({ page }) => {
  const initial = taskFixture(migrationTableSpec, { rows: [{ id: 'one', name: 'Ada', workspace_id: null }, { id: 'two', name: 'Lin', workspace_id: null }], projects: [], changes: { rows: [] } });
  const fixture = await serveTaskFixture(page, initial); await page.goto('/');
  await expect(page.locator('tr[data-row-id=one] td[data-column-key=workspace_id]')).toHaveText('NULL');
  fixture.setInput('rows', [{ id: 'one', name: 'Ada', workspace_id: 'studio' }, { id: 'two', name: 'Lin', workspace_id: null }]);
  fixture.setInput('changes', { revision: 1, activeRowId: 'one', rows: [{ id: 'one', cells: [{ key: 'workspace_id', status: 'updated', before: null }] }] }); await fixture.publish();
  const cell = page.locator('tr[data-row-id=one] td[data-column-key=workspace_id]'); await expect(cell).toContainText('studio');
  await expect.poll(() => cell.evaluate(node => node.querySelector('.task-table-value')?.getAnimations().length ?? 0)).toBeGreaterThan(0);
  const sweep = page.getByLabel('Source records', { exact: true }).locator('.task-table-sweep');
  await expect(sweep).toBeVisible();
  const firstTop = await sweep.evaluate(node => node.getBoundingClientRect().top);
  fixture.setInput('changes', { revision: 2, activeRowId: 'two', rows: [{ id: 'one', cells: [{ key: 'workspace_id', status: 'updated', before: null }] }] }); await fixture.publish();
  await expect.poll(() => sweep.evaluate(node => node.getBoundingClientRect().top)).toBeGreaterThan(firstTop + 20);
  await page.waitForTimeout(450); await fixture.publish();
  expect(await cell.evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
});

test('new column geometry arrives continuously while the existing header stays mounted', async ({ page }) => {
  const spec = { root: 'table', elements: { table: { type: 'Table', props: { rowsBinding: 'rows', columns: [{ key: 'name', label: 'Name' }], rowKey: 'id' } } } };
  const fixture = await serveTaskFixture(page, taskFixture(spec, { rows: [{ id: 'one', name: 'Ada', workspace: 'studio' }] })); await page.goto('/');
  const header = page.getByRole('columnheader', { name: 'Name', exact: true }); const identity = await header.elementHandle();
  await header.evaluate(node => {
    const table = node.closest('table')!;
    Object.assign(window, { operationalColumnMotion: new Promise<number[]>(resolve => {
      const observer = new MutationObserver(() => {
        if (!table.querySelector('th[data-column-key=workspace]')) return;
        observer.disconnect();
        const values: number[] = [], start = performance.now();
        const sample = () => { values.push(node.getBoundingClientRect().x); if (performance.now() - start < 320) requestAnimationFrame(sample); else resolve(values); };
        sample();
      }); observer.observe(table, { childList: true, subtree: true });
    }) });
  });
  fixture.snapshot.artifacts[0].spec!.elements.table.props.columns = [{ key: 'workspace', label: 'Workspace' }, { key: 'name', label: 'Name' }]; fixture.snapshot.artifacts[0].revision++; await fixture.publish();
  await expect(page.getByRole('columnheader', { name: 'Workspace', exact: true })).toBeVisible();
  expect(await header.evaluate((node, old) => node === old, identity)).toBe(true);
  const positions = await page.evaluate(() => (window as unknown as { operationalColumnMotion: Promise<number[]> }).operationalColumnMotion);
  expect(Math.max(...positions) - Math.min(...positions)).toBeGreaterThan(10);
});

test('context shell keeps header, body and footer bands and compacting shimmers without predicting token totals', async ({ page }) => {
  const initial = taskFixture(branchGraphSpec('vertical'), { graph: branchGraphData });
  initial.usage['task-thread'] = { contextTokens: 600000, contextWindow: 1000000, inputTokens: 1000, outputTokens: 500, cost: null, sessionPercent: 68, weeklyPercent: 24, activity: 'idle', contextBreakdown: [{ label: 'System', tokens: 20000 }, { label: 'Messages', tokens: 580000 }] };
  const fixture = await serveTaskFixture(page, initial); await page.goto('/'); await page.getByRole('button', { name: 'Inspect context usage' }).click();
  const dialog = page.getByRole('dialog', { name: 'Context inspector' });
  const identity = await dialog.elementHandle();
  const bands = await dialog.evaluate(node => Array.from(node.querySelectorAll(':scope > header,:scope > .context-inspector-body,:scope > footer')).map(band => band.tagName.toLowerCase()));
  expect(bands).toEqual(['header', 'div', 'footer']);
  expect(await dialog.evaluate(node => [getComputedStyle(node).animationName, getComputedStyle(node).animationDuration])).toEqual(['context-shell-enter', '0.18s']);
  const firstStart = await dialog.evaluate(node => { const animation = node.getAnimations().find(item => (item as CSSAnimation).animationName === 'context-shell-enter'); return animation ? animation.startTime : null; });
  await fixture.publish();
  const nextStart = await dialog.evaluate(node => { const animation = node.getAnimations().find(item => (item as CSSAnimation).animationName === 'context-shell-enter'); return animation ? animation.startTime : null; });
  // A finished entrance may drop out of getAnimations(), but a snapshot must never restart it.
  expect(nextStart === null || nextStart === firstStart).toBe(true);
  expect(await dialog.evaluate((node, old) => node === old, identity)).toBe(true);
  fixture.snapshot.usage['task-thread'].activity = 'compacting'; await fixture.publish();
  await expect(dialog.locator('.context-compaction-shimmer')).toBeVisible(); await expect(dialog.locator('header')).toContainText('60%');
  await page.waitForTimeout(200); await expect(dialog.locator('header')).toContainText('60%');
});

test('reduced motion skips graph travel and context shimmer while preserving source state', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const initial = taskFixture(branchGraphSpec('vertical'), { graph: branchGraphData });
  initial.usage['task-thread'] = { contextTokens: 600000, contextWindow: 1000000, inputTokens: 1000, outputTokens: 500, cost: null, sessionPercent: null, weeklyPercent: null, activity: 'compacting' };
  const fixture = await serveTaskFixture(page, initial); await page.goto('/');
  fixture.setInput('graph', { ...branchGraphData, nodes: [{ id: 'inserted', label: 'Resolved merge', lane: 0 }, ...branchGraphData.nodes] }); await fixture.publish();
  await expect(page.locator('[data-node-id=inserted]')).toBeVisible();
  expect(await page.locator('.task-graph').evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' && ['transform', 'height', 'd'].some(key => animation.effect instanceof KeyframeEffect && animation.effect.getKeyframes().some(frame => Object.hasOwn(frame, key)))).length)).toBe(0);
  await page.getByRole('button', { name: 'Inspect context usage' }).click();
  await expect(page.locator('.context-compaction-shimmer')).toHaveCount(1);
  await expect(page.locator('.context-compaction-shimmer')).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Context inspector' }).locator('header')).toContainText('60%');
});
test('a token decrease without a host receipt never claims freed tokens and keeps controls responsive', async ({ page }) => {
  const initial=taskFixture(branchGraphSpec('vertical'),{graph:branchGraphData});
  initial.usage['task-thread']={contextTokens:600000,contextWindow:1000000,inputTokens:1000,outputTokens:500,cost:null,sessionPercent:null,weeklyPercent:null,activity:'idle'};
  const fixture=await serveTaskFixture(page,initial);await page.goto('/');await page.getByRole('button',{name:'Inspect context usage'}).click();
  const dialog=page.getByRole('dialog',{name:'Context inspector'});await dialog.getByRole('button',{name:'Compact now',exact:true}).click();
  initial.usage['task-thread']={...initial.usage['task-thread'],contextTokens:80000};await fixture.publish();
  await page.waitForTimeout(200);await expect(dialog.getByRole('status')).not.toContainText('Freed');
  await expect(dialog.getByRole('button',{name:'Compact now',exact:true})).toBeEnabled();
  await expect(dialog.getByRole('status')).toContainText('Result not reported',{timeout:2500});
  await expect(dialog.getByRole('status')).not.toContainText('Freed');
});
