import { test, expect, type Page } from '@playwright/test';
import { branchGraphData, branchGraphSpec, migrationTableSpec, serveTaskFixture, taskFixture } from './task-interface-fixture';

const flushFrames = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const scrollSettled = (locator: ReturnType<Page['locator']>) => locator.evaluate(node => new Promise<void>(resolve => {
  let last = node.scrollTop, still = 0, frames = 0;
  const tick = () => { const delta = Math.abs(node.scrollTop - last); last = node.scrollTop; still = delta < .5 ? still + 1 : 0; if (++frames > 240 || still >= 10) resolve(); else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}));

test('a rapid graph reversal brakes from its visible velocity while paths stay attached', async ({ page }) => {
  const host = await serveTaskFixture(page, taskFixture(branchGraphSpec('vertical'), { graph: branchGraphData })); await page.goto('/');
  const graph = page.locator('.task-graph'); await expect(graph.locator('[data-node-id=base]')).toBeVisible();
  const inserted = Array.from({ length: 6 }, (_, index) => ({ id: `prep-${index}`, label: `Preparation ${index + 1}`, lane: 0, status: 'neutral' }));
  host.setInput('graph', { ...branchGraphData, nodes: [...inserted, ...branchGraphData.nodes] }); await host.publish();
  await graph.evaluate(async graph => {
    const started = performance.now();
    while (graph.querySelector('[data-node-id=base] .task-graph-dot')!.getBoundingClientRect().y - graph.getBoundingClientRect().top < 80) {
      if (performance.now() - started > 1000) throw Error('The graph did not begin moving');
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
  });
  await graph.evaluate(graph => {
    const dot = () => graph.querySelector('[data-node-id=base] .task-graph-dot')!.getBoundingClientRect();
    Object.assign(window, { reversalObservation: new Promise(resolve => {
      const observer = new MutationObserver(() => {
        if (graph.querySelector('[data-node-id^="prep-"]')) return; observer.disconnect();
        const baseline = dot().y - graph.getBoundingClientRect().top, frames: { t: number; y: number; gap: number }[] = [], started = performance.now();
        const sample = () => {
          const box = dot(), path = graph.querySelector<SVGPathElement>('.graph-edge')!, point = path.getPointAtLength(0), endpoint = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
          frames.push({ t: performance.now() - started, y: box.y - graph.getBoundingClientRect().top, gap: Math.hypot(endpoint.x - box.x - box.width / 2, endpoint.y - box.y - box.height / 2) });
          if (performance.now() - started < 650) requestAnimationFrame(sample); else resolve({ baseline, frames });
        }; requestAnimationFrame(sample);
      }); observer.observe(graph, { childList: true, subtree: true });
    }) });
  });
  host.setInput('graph', branchGraphData); await host.publish();
  const observation = await page.evaluate(() => (window as unknown as { reversalObservation: Promise<{ baseline: number; frames: {t:number;y:number;gap:number}[] }> }).reversalObservation);
  await test.info().attach('graph-reversal-observation', { body: JSON.stringify(observation), contentType: 'application/json' });
  expect(Math.max(...observation.frames.filter(frame => frame.t < 90).map(frame => frame.y)) - observation.baseline).toBeGreaterThan(.3);
  expect(Math.max(...observation.frames.map(frame => frame.gap))).toBeLessThan(2);
  expect(observation.frames.at(-1)!.y).toBeLessThan(observation.baseline - 10);
});

test('turning on reduced motion settles an in-flight graph instead of leaving its old travel running', async ({ page }) => {
  const host = await serveTaskFixture(page, taskFixture(branchGraphSpec('vertical'), { graph: branchGraphData })); await page.goto('/');
  const row = page.locator('[data-node-id=base]'); await expect(row.locator('.task-graph-dot')).toBeVisible();
  const offsetY = () => row.evaluate(el => new DOMMatrixReadOnly((el as HTMLElement).style.transform).m42);
  const original = await offsetY();
  host.setInput('graph', { ...branchGraphData, nodes: [{ id: 'new', label: 'Accepted resolution', lane: 0 }, ...branchGraphData.nodes] }); await host.publish();
  await expect.poll(offsetY, { intervals: [16, 32, 50, 100, 250] }).toBeGreaterThan(original + 1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(offsetY).toBe(original + 34);
  const settled = await row.evaluate(async el => { const read = () => new DOMMatrixReadOnly((el as HTMLElement).style.transform).m42; const values: number[] = []; for (let index = 0; index < 3; index++) { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); values.push(read()); } return values; });
  expect(Math.max(...settled) - Math.min(...settled)).toBeLessThan(.01);
});
test('a focused node inspection stays anchored while accepted history moves beneath it', async ({ page }) => {
  const host=await serveTaskFixture(page,taskFixture(branchGraphSpec('vertical'),{graph:branchGraphData}));await page.goto('/');
  const anchor=page.getByRole('button',{name:'Refresh release metadata',exact:true});await anchor.focus();await expect(page.getByRole('tooltip').filter({hasText:'Refresh release metadata'})).toBeVisible();
  host.setInput('graph',{...branchGraphData,nodes:[{id:'accepted',label:'Accepted resolution',lane:0},...branchGraphData.nodes]});await host.publish();
  const gaps=await anchor.evaluate(async anchor=>{const gaps:number[]=[];for(let index=0;index<18;index++){await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));const a=anchor.getBoundingClientRect(),tip=document.getElementById(anchor.getAttribute('aria-describedby')!)!.getBoundingClientRect();gaps.push(Math.min(Math.abs(tip.top-a.bottom),Math.abs(a.top-tip.bottom)));}return gaps;});
  expect(Math.max(...gaps)).toBeLessThan(12);
});

test('rapid orientation changes retain selected nodes and one coupled path geometry', async ({ page }) => {
  const host = await serveTaskFixture(page, taskFixture(branchGraphSpec('vertical'), { graph: branchGraphData })); await page.goto('/');
  const graph = page.locator('.task-graph'), node = graph.getByRole('button', { name: 'Keep retries ordered', exact: true });
  await node.click(); await expect(node).toHaveAttribute('aria-pressed', 'true'); await node.evaluate(node => node.setAttribute('data-retained', 'yes'));
  const gaps: number[] = [];
  for (const orientation of ['horizontal', 'vertical', 'horizontal', 'vertical'] as const) {
    host.snapshot.artifacts[0].spec = branchGraphSpec(orientation); host.snapshot.artifacts[0].revision++; await host.publish();
    await expect(graph).toHaveAttribute('data-orientation', orientation);
    gaps.push(...await graph.evaluate(async graph => {
      const gaps: number[] = [];
      for (let index = 0; index < 5; index++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        for (const path of graph.querySelectorAll<SVGPathElement>('.graph-edge')) for (const endpoint of ['from', 'to'] as const) {
          const dot = graph.querySelector(`[data-node-id="${path.dataset[endpoint]}"] .task-graph-dot`)!.getBoundingClientRect();
          const point = path.getPointAtLength(endpoint === 'from' ? 0 : path.getTotalLength()), screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
          gaps.push(Math.hypot(screen.x - dot.x - dot.width / 2, screen.y - dot.y - dot.height / 2));
        }
      }
      return gaps;
    }));
  }
  expect(Math.max(...gaps)).toBeLessThan(2); await expect(node).toHaveAttribute('data-retained', 'yes'); await expect(node).toHaveAttribute('aria-pressed', 'true');
});

function followingFixture() {
  const snapshot=taskFixture(migrationTableSpec, { rows: Array.from({ length: 60 }, (_, index) => ({ id: String(index + 1), name: `Person ${index + 1}`, workspace_id: null })), projects: [], changes: { rows: [] } });
  snapshot.artifacts[0].placement='expanded';
  return snapshot;
}

test('cloned accepted table snapshots do not restart an ongoing follow movement', async ({ page }) => {
  const host = await serveTaskFixture(page, followingFixture()); await page.goto('/'); const grid = page.getByLabel('Source records', { exact: true }); await expect(grid).toBeVisible();
  await grid.evaluate(node => {
    const original = node.scrollTo.bind(node); Object.assign(window, { tableScrollRequests: 0 });
    node.scrollTo = ((...args: Parameters<HTMLElement['scrollTo']>) => { (window as unknown as {tableScrollRequests:number}).tableScrollRequests++; return original(...args); }) as HTMLElement['scrollTo'];
  });
  host.setInput('changes', { revision: 1, activeRowId: '55', rows: [] }); await host.publish();
  await expect.poll(() => grid.evaluate(node => node.scrollTop)).toBeGreaterThan(20);
  const before = await page.evaluate(() => (window as unknown as {tableScrollRequests:number}).tableScrollRequests);
  host.snapshot.data = structuredClone(host.snapshot.data); await host.publish(); await flushFrames(page);
  const after = await page.evaluate(() => (window as unknown as {tableScrollRequests:number}).tableScrollRequests);
  expect(after).toBe(before);
});

test('interacting with a table cell takes over and freezes automatic following immediately', async ({ page }) => {
  const host = await serveTaskFixture(page, followingFixture()); await page.goto('/'); const grid = page.getByLabel('Source records', { exact: true }); await expect(grid).toBeVisible();
  host.setInput('changes', { revision: 1, activeRowId: '55', rows: [] }); await host.publish();
  await expect.poll(() => grid.evaluate(node => node.scrollTop)).toBeGreaterThan(20);
  await grid.evaluate(node => node.querySelector('td')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 })));
  await expect(grid).toHaveAttribute('data-following', 'false');
  const stopped = await grid.evaluate(node => node.scrollTop); await scrollSettled(grid);
  expect(Math.abs(await grid.evaluate(node => node.scrollTop) - stopped)).toBeLessThan(2);
  host.setInput('changes', { revision: 2, activeRowId: '60', rows: [] }); await host.publish(); await flushFrames(page);
  expect(Math.abs(await grid.evaluate(node => node.scrollTop) - stopped)).toBeLessThan(2);
});

test('a newer row target replaces scrolling direction without a viewport overshoot', async ({ page }) => {
  const host = await serveTaskFixture(page, followingFixture()); await page.goto('/'); const grid = page.getByLabel('Source records', { exact: true }); await expect(grid).toBeVisible();
  host.setInput('changes', { revision: 1, activeRowId: '55', rows: [] }); await host.publish(); await expect.poll(() => grid.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
  await grid.evaluate(node => Object.assign(window, { rowRetargetObservation: new Promise(resolve => {
    const observer = new MutationObserver(() => {
      if (!node.querySelector('[data-row-id="1"][data-active="true"]')) return; observer.disconnect();
      const baseline = node.scrollTop, values: number[] = [], started = performance.now();
      const sample = () => { values.push(node.scrollTop); if (performance.now() - started < 500) requestAnimationFrame(sample); else resolve({ baseline, values }); }; requestAnimationFrame(sample);
    }); observer.observe(node, { attributes: true, subtree: true, attributeFilter: ['data-active'] });
  }) }));
  host.setInput('changes', { revision: 2, activeRowId: '1', rows: [] }); await host.publish();
  const observation = await page.evaluate(() => (window as unknown as {rowRetargetObservation:Promise<{baseline:number;values:number[]}>}).rowRetargetObservation);
  expect(Math.max(...observation.values)).toBeLessThanOrEqual(observation.baseline + 1); expect(observation.values.at(-1)).toBeLessThan(2);
});
