import type { ServerResponse } from 'node:http';
import type { HostCommand, Snapshot } from '../packages/contracts/index.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium, expect, type Locator, type Page } from '@playwright/test';
import { graphData, graphSpec, type PRPhase } from './review-pr.ts';
import { recordWindow } from './review-capture.ts';
import { taskFixture, type TaskSpec } from '../tests/e2e/task-interface-fixture.ts';

const output = resolve(process.argv[2] ?? '.harness-readme-launch');
await mkdir(output, { recursive: true });
process.env.GEN_E2E = '1';
const server = await createServer({ server: { host: '127.0.0.1', port: 5579, strictPort: true }, configLoader: 'runner' });
const streams = new Set<ServerResponse>();
server.middlewares.use('/api/events', (_request, reply) => {
  reply.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  reply.write(': demo connection active\n\n');
  streams.add(reply);
  reply.on('close', () => streams.delete(reply));
});
await server.listen();

async function fixture(page: Page, snapshot: Snapshot, action?: (command: HostCommand) => Promise<unknown>) {
  async function publish() {
    snapshot.seq++;
    for (const reply of streams) reply.write('data: ' + JSON.stringify({ seq: snapshot.seq, type: 'fixture.changed' }) + '\n\n');
  }
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const send = (json: unknown) => route.fulfill({ json });
    if (path === '/api/events') return route.continue();
    if (path === '/api/bootstrap') return send({ csrfToken: 'demo-csrf' });
    if (path === '/api/snapshot') return send(snapshot);
    if (path === '/api/shell-settings') return send(snapshot.settings);
    if (path === '/api/plugins') return send({ plugins: [], theme: 'dark' });
    if (path === '/api/models') return send({ models: [{ id: 'test/model', provider: 'fixture', name: 'Demo fixture' }] });
    if (path === '/api/workspace') return send({ projects: [], state: { version: 1, revision: 0, activeCanvasId: 'workspace', canvases: [{ id: 'workspace', name: 'Workspace', preset: 'workspace', panels: [], viewport: { x: 0, y: 0, zoom: 1 } }], profiles: [], disabledKinds: [], integrations: {} } });
    if (path === '/api/split-workspace/profiles') return send({ profiles: [] });
    if (path === '/api/commands') {
      const command = route.request().postDataJSON() as HostCommand;
      let result: unknown = {};
      if (command.type === 'state.save') {
        const saved = snapshot.userStates[0];
        saved.values = command.payload.values as Record<string, unknown>; saved.revision++;
        result = saved;
      }
      if (command.type === 'action.submit') result = await action?.(command) ?? {};
      return send({ commandId: command.id, eventSeq: snapshot.seq, result });
    }
    return send({ items: [], nextCursor: null });
  });
  return { publish };
}
try {
  const chromiumServer = await chromium.launchServer({ headless: true, args: ['--force-device-scale-factor=1', '--disable-background-timer-throttling'] });
  try {
    const browser = await chromium.connect(chromiumServer.wsEndpoint());
    const url = 'http://127.0.0.1:5579';
    const manifest: unknown[] = [];
    const capture = async (name: string, setup: (page: Page) => Promise<() => Promise<void>>) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark', serviceWorkers: 'block' });
      await context.route('**/*', route => new URL(route.request().url()).origin === url ? route.fallback() : route.abort());
      const page = await context.newPage();
      try {
        const play = await setup(page);
        await page.evaluate(() => document.fonts.ready);
        await expect.poll(() => streams.size).toBe(1);
        await expect(page.getByText('Reconnecting', { exact: true })).toHaveCount(0);
        await expect(page.getByText(/Plug-ins could not be loaded/)).toHaveCount(0);
        const stop = await recordWindow(chromiumServer, page, join(output, name + '.mp4'));
        try { await play(); }
        finally { manifest.push({ name, capture: await stop() }); }
        await page.screenshot({ path: join(output, name + '.png') });
      } finally { await context.close(); }
    };
    const hold = (page: Page, ms = 750) => page.waitForTimeout(ms);
    async function point(page: Page, target: Locator) {
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      if (!box) throw Error('The demo control was not visible.');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 9 });
    }
    await capture('pull-request', async page => {
      const snapshot = taskFixture(graphSpec('vertical', 'conflicts'), { graph: graphData('conflicts') });
      snapshot.settings.theme = 'dark';
      snapshot.threads[0].title = 'Review a pull request';
      snapshot.threads[0].projectName = 'Release review';
      snapshot.messages[0].content = 'Review the branch differences and follow the checks before merging this sample pull request.';
      Object.assign(snapshot.artifacts[0], { title: 'Session refresh · PR #128', actions: { resolve: { kind: 'agent' }, merge: { kind: 'agent' } } });
      let publish: () => Promise<void>;
      const phase = (value: PRPhase) => {
        const artifact = snapshot.artifacts[0];
        artifact.spec = graphSpec('vertical', value); artifact.revision++;
        snapshot.data[0].value = graphData(value); snapshot.data[0].revision++;
        return publish();
      };
      const handle = await fixture(page, snapshot, async command => {
        if (command.payload.actionId === 'resolve') {
          await phase('resolving'); setTimeout(() => void phase('ready'), 1150);
        }
        if (command.payload.actionId === 'merge') {
          await phase('merging'); setTimeout(() => void phase('merged'), 900);
        }
        return {};
      });
      publish = handle.publish;
      await page.goto(url);
      const graph = page.locator('.task-graph').first();
      await expect(graph).toBeVisible({ timeout: 30000 });
      return async () => {
        await hold(page, 700);
        await point(page, graph.getByRole('button', { name: /Handle inactive sessions/ }).first());
        await hold(page, 1100);
        const resolve = page.getByRole('button', { name: 'Resolve conflicts', exact: true });
        await point(page, resolve); await resolve.click();
        const merge = page.getByRole('button', { name: 'Merge', exact: true });
        await expect(merge).toBeVisible();
        await point(page, merge); await hold(page, 950); await merge.click();
        await expect(graph.locator('.task-graph-summary')).toContainText('Merged');
        await hold(page, 1400);
      };
    });
    await capture('interactive-table', async page => {
      const spec: TaskSpec = { root: 'table', elements: { table: { type: 'Table', props: { rowsBinding: 'rows', rowKey: 'id', stateKey: 'selected', caption: 'Launch checklist', columns: [{ key: 'task', label: 'Task' }, { key: 'owner', label: 'Owner' }, { key: 'status', label: 'Status' }] } } } };
      const rows = [
        { id: 'a', task: 'Record product demo', owner: 'Mira', status: 'In review' },
        { id: 'b', task: 'Check keyboard navigation', owner: 'Avery', status: 'Ready' },
        { id: 'c', task: 'Verify Windows build', owner: 'Jules', status: 'Passing' },
        { id: 'd', task: 'Prepare changelog', owner: 'Lena', status: 'Ready' },
        { id: 'e', task: 'Refresh setup guide', owner: 'Sam', status: 'In review' },
      ];
      const snapshot = taskFixture(spec, { rows }, { selected: [] });
      snapshot.settings.theme = 'dark'; snapshot.threads[0].title = 'Prepare launch checklist';
      snapshot.threads[0].projectName = 'Release review';
      snapshot.messages[0].content = 'Here’s the launch checklist. Sort the work or select the items you want to review.';
      snapshot.artifacts[0].title = 'Launch checklist';
      await fixture(page, snapshot);
      await page.goto(url);
      const sort = page.getByRole('button', { name: 'Sort Task', exact: true });
      await expect(sort).toBeVisible({ timeout: 30000 });
      return async () => {
        await hold(page, 700); await point(page, sort); await sort.click();
        await expect(page.locator('.task-table tbody tr').first()).toContainText('Check keyboard navigation');
        await hold(page, 800);
        const row = page.locator('.task-table [data-row-id=b] input');
        await point(page, row); await row.check(); await expect(row).toBeChecked();
        await hold(page, 500);
        const next = page.locator('.task-table [data-row-id=c] input');
        await point(page, next); await next.check(); await expect(next).toBeChecked();
        await hold(page, 1300);
      };
    });
    await writeFile(join(output, 'capture.json'), JSON.stringify(manifest, null, 2));
    await browser.close();
  } finally { await chromiumServer.close(); }
} finally { for (const reply of streams) reply.end(); await server.close(); }
