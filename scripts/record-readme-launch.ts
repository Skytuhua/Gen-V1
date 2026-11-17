import { mkdir, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium, expect, type Locator, type Page } from '@playwright/test';
import { graphData, graphSpec, type PRPhase } from './review-pr.ts';
import { recordWindow } from './review-capture.ts';
import { serveTaskFixture, taskFixture, type TaskSpec } from '../tests/e2e/task-interface-fixture.ts';

const output = resolve(process.argv[2] ?? '.harness-readme-launch');
await mkdir(output, { recursive: true });
process.env.GEN_E2E = '1';
const server = await createServer({ server: { host: '127.0.0.1', port: 5579, strictPort: true, fs: { allow: [resolve('.'), realpathSync('node_modules')] } }, configLoader: 'runner' });
await server.listen();
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
        const stop = await recordWindow(chromiumServer, page, join(output, name + '.mp4'));
        try { await play(); }
        finally { manifest.push({ name, capture: await stop() }); }
        await page.screenshot({ path: join(output, name + '.png') });
      } finally { await context.close(); }
    };
    const hold = (page: Page, ms = 750) => page.waitForTimeout(ms);
    const zoomTo = async (page: Page, factor: number) => {
      await page.evaluate(value => { (document.body.style as CSSStyleDeclaration).transition = 'zoom 650ms ease-in-out'; document.body.style.zoom = String(value); }, factor);
      await hold(page, 750);
    };
    async function point(page: Page, target: Locator) {
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      if (!box) throw Error('The demo control was not visible.');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 9 });
    }
    const mode = process.env.GEN_README_FLOWS;
    if(!mode || mode === 'original') await capture('pull-request', async page => {
      const snapshot = taskFixture(graphSpec('vertical', 'conflicts'), { graph: graphData('conflicts') });
      snapshot.settings.theme = 'dark';
      snapshot.threads[0].title = 'Review a pull request';
      snapshot.threads[0].projectName = 'Release review';
      snapshot.messages[0].content = 'Review the branch differences and follow the checks before merging this sample pull request.';
      Object.assign(snapshot.artifacts[0], { title: 'Session refresh Â· PR #128', actions: { resolve: { kind: 'agent' }, merge: { kind: 'agent' } } });
      let publish: () => Promise<void>;
      const phase = (value: PRPhase) => {
        const artifact = snapshot.artifacts[0];
        artifact.spec = graphSpec('vertical', value); artifact.revision++;
        snapshot.data[0].value = graphData(value); snapshot.data[0].revision++;
        return publish();
      };
      const handle = await serveTaskFixture(page, snapshot, async command => {
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
    if(!mode || mode === 'original') await capture('interactive-table', async page => {
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
      snapshot.messages[0].content = 'Hereâ€™s the launch checklist. Sort the work or select the items you want to review.';
      snapshot.artifacts[0].title = 'Launch checklist';
      await serveTaskFixture(page, snapshot);
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
    type Demo = {
      name: string; title: string; prompt: string; reply: string;
      artifactTitle: string; spec: TaskSpec; data?: Record<string, unknown>; values?: Record<string, unknown>;
      followup?: {prompt: string; reply: string}; branchReview?: boolean;
      interact(page: Page): Promise<void>;
    };
    const workflow = async (demo: Demo) => capture(demo.name, async page => {
      const snapshot = taskFixture(demo.spec, demo.data, demo.values);
      snapshot.settings.theme = 'dark';
      const thread = snapshot.threads[0]; thread.title = demo.title; thread.projectName = '';
      thread.createdAt = thread.updatedAt = new Date().toISOString();
      const assistant = snapshot.messages.pop()!;
      const artifact = snapshot.artifacts.pop()!;
      assistant.content = demo.reply; artifact.title = demo.artifactTitle;
      if(demo.branchReview) artifact.actions = {resolve:{kind:'agent'},merge:{kind:'agent'}};
      let publish: () => Promise<void>;
      const phase = (value: PRPhase, completed?: number) => {
        artifact.spec = graphSpec('vertical', value); artifact.revision++;
        snapshot.data[0].value = graphData(value, completed); snapshot.data[0].revision++;
        return publish();
      };
      const host = await serveTaskFixture(page, snapshot, async command => {
        if(demo.branchReview && command.payload.actionId === 'resolve') {
          await phase('resolving');
          setTimeout(() => void phase('resolving', 28), 550);
          setTimeout(() => void phase('ready'), 1600);
        }
        if(demo.branchReview && command.payload.actionId === 'merge') {
          await phase('merging');
          setTimeout(() => void phase('merged'), 800);
        }
        return {};
      });
      publish = host.publish;
      await page.route('**/api/plugins', route => route.fulfill({json: {plugins: [], theme: 'dark'}}));
      await page.route('**/api/attention', route => route.fulfill({json: {items: [], unread: 0, sequence: 0}}));
      let sends = 0;
      await page.route('**/api/commands', async route => {
        const command = route.request().postDataJSON() as typeof host.commands[number];
        if (command.type !== 'message.send') return route.fallback();
        host.commands.push(command); sends++;
        const expected = sends === 1 ? demo.prompt : demo.followup?.prompt;
        if (command.payload.content !== expected) {
          return route.fulfill({status: 422, json: {error: {message: 'Unexpected capture input'}}});
        }
        snapshot.messages.push({ ...assistant, id: 'demo-prompt-' + sends, role: 'user', content: expected! });
        await hold(page, 430);
        snapshot.messages.push(sends === 1 ? assistant : {...assistant, id: 'demo-followup', content: demo.followup!.reply});
        if (sends === 1) snapshot.artifacts.push(artifact);
        await route.fulfill({json: {commandId: command.id, seq: ++snapshot.seq, result: {}}});
        await host.publish();
      });
      await page.goto(url);
      const composer = page.getByRole('textbox', {name: 'Message', exact: true});
      const send = page.getByRole('button', {name: 'Send message', exact: true});
      await expect(composer).toBeEditable({timeout: 30000});
      await expect(page.getByText('Plug-ins could not be loaded.', {exact:true})).toHaveCount(0);
      const ask = async (prompt: string) => {
        await point(page, composer); await composer.click();
        await composer.pressSequentially(prompt, {delay: 14});
        await hold(page, 1000);
        await expect(send).toBeEnabled({timeout: 10000}); await point(page, send); await send.click();
      };
      return async () => {
        await hold(page, 500); await ask(demo.prompt);
        await expect(page.getByText(demo.reply, {exact:true})).toBeVisible({timeout: 12000});
        await expect(page.locator('.artifact-content')).toBeVisible(); await hold(page, 650);
        await zoomTo(page, 1.25); await hold(page, 400);
        await demo.interact(page);
        await zoomTo(page, 1.0); await hold(page, 350);
        if (demo.followup) {
          await ask(demo.followup.prompt);
          await expect(page.getByText(demo.followup.reply, {exact:true})).toBeVisible({timeout: 12000});
        }
        await page.mouse.move(429, 600);
        await hold(page, 1500);
      };
    });
    if(!mode || mode === 'scenarios') {
      await workflow({
        name: 'migration-checklist', title: 'Break down the session-store migration', artifactTitle: 'Migration checklist',
        prompt: 'Break the session-store migration into steps I can check off.',
        reply: 'Four steps, ordered so each lands on its own. Check off the ones already done.',
        spec: {root:'table', elements:{table:{type:'Table', props:{
          rowsBinding:'rows', rowKey:'id', stateKey:'selected', caption:'Migration steps',
          columns:[{key:'step',label:'Step'},{key:'scope',label:'Scope'},{key:'effort',label:'Effort'}],
        }}}},
        data: {rows:[
          {id:'iface',step:'Extract token storage behind an interface',scope:'packages/core',effort:'Small'},
          {id:'reads',step:'Migrate reads to the new store',scope:'apps/server',effort:'Medium'},
          {id:'dual',step:'Dual-write behind a flag',scope:'packages/storage',effort:'Medium'},
          {id:'cleanup',step:'Remove the legacy path',scope:'packages/storage',effort:'Small'},
        ]},
        values:{selected:[]},
        async interact(page) {
          for(const row of ['iface','reads']) {
            const checkbox=page.locator(`.task-table [data-row-id=${row}] input`);
            await point(page, checkbox); await checkbox.check(); await expect(checkbox).toBeChecked(); await hold(page, 650);
          }
        },
      });
      await workflow({
        name:'runtime-comparison', title:'Compare candidate base images', artifactTitle:'Base image shortlist',
        prompt:'Compare the three candidate base images by size, cold start and open CVEs.',
        reply:'All three pass the smoke suite. Sort by the constraint that matters to the deployment.',
        spec:{root:'table',elements:{table:{type:'Table',props:{
          rowsBinding:'rows',rowKey:'id',stateKey:'selected',caption:'Compare base images',
          columns:[{key:'name',label:'Image'},{key:'size',label:'Size (MB)'},{key:'cold',label:'Cold start (ms)'},{key:'cves',label:'Open CVEs'}],
        }}}},
        data:{rows:[
          {id:'slim',name:'node24-slim',size:320,cold:410,cves:7},
          {id:'alpine',name:'node24-alpine',size:128,cold:390,cves:3},
          {id:'distroless',name:'node24-distroless',size:210,cold:520,cves:1},
        ]},values:{selected:[]},
        async interact(page) {
          const table=page.locator('.task-table');
          for(const [name,expected] of [['Sort Size (MB)','node24-alpine'],['Sort Open CVEs','node24-distroless']]) {
            const button=page.getByRole('button',{name,exact:true});
            await point(page,button);await button.click();await expect(table.locator('tbody tr').first()).toContainText(expected);await hold(page,850);
          }
          const pick=table.locator('[data-row-id=distroless] input');
          await point(page,pick);await pick.check();await expect(pick).toBeChecked();
        },
      });
      await workflow({
        name:'rollout-plan',title:'Plan the cache rollout',artifactTitle:'Rollout and rollback',
        prompt:'Draft a staged rollout for the Redis cache. Include a rollback.',
        reply:'Three phases, each flag-gated with its own rollback step.',
        spec:{root:'list',elements:{
          list:{type:'Stack',props:{gap:'sm'},children:['shadow','dual','rollback']},
          shadow:{type:'Disclosure',props:{title:'Phase 1 · Shadow reads',text:'Read from Redis alongside the current store and log mismatches.',stateKey:'shadow'}},
          dual:{type:'Disclosure',props:{title:'Phase 2 · Dual writes',text:'Write both stores behind the rollout flag; reads still prefer the legacy store.',stateKey:'dual'}},
          rollback:{type:'Disclosure',props:{title:'Rollback · Disable the flag',text:'Turn the flag off to return all traffic to the legacy store immediately.',stateKey:'rollback'}},
        }},
        followup:{prompt:'Gate phase 2 on the rollback checks passing.',reply:'Dual writes now wait for a verified rollback path before enabling.'},
        async interact(page) {
          const rollback=page.getByRole('button',{name:'Rollback · Disable the flag',exact:true});
          await point(page,rollback);await rollback.click();await expect(rollback).toHaveAttribute('aria-expanded','true');
          await expect(page.getByText('Turn the flag off to return all traffic to the legacy store immediately.',{exact:true})).toBeVisible();
          await hold(page,1000);
        },
      });
    }
    if(!mode || mode === 'developer') {
      await workflow({
        name:'pr-review-workflow',title:'Review PR #128',artifactTitle:'Session refresh Â· PR #128',
        prompt:'Review PR #128. Show me what changed and what needs to pass before I merge.',
        reply:'Three conflicts block this merge. Open a commit to compare the changes.',
        spec:graphSpec('vertical','conflicts'),data:{graph:graphData('conflicts')},branchReview:true,
        async interact(page) {
          const graph=page.locator('.task-graph').first();
          await expect(graph.locator('.task-graph-summary')).toContainText('3 conflicts');
          const change=graph.getByRole('button',{name:/Handle inactive sessions/}).first();
          await point(page,change); await change.click();
          const excerpt=page.getByRole('tooltip').getByText('return await refreshSession(token, signal);',{exact:true}).first();
          await expect(excerpt).toBeVisible(); await hold(page,1000);
          const resolve=page.getByRole('button',{name:'Resolve conflicts',exact:true});
          await point(page,resolve); await resolve.click();
          await expect(graph.locator('.task-graph-summary')).toContainText('Running checks');
          const merge=page.getByRole('button',{name:'Merge',exact:true});
          await expect(merge).toBeVisible();
          await expect(graph.locator('.task-graph-summary')).toContainText('Ready to merge');
          await point(page,merge); await hold(page,1100); await merge.click();
          await expect(graph.locator('.task-graph-summary')).toContainText('Merged');
          await graph.locator('.task-graph-summary').scrollIntoViewIfNeeded();
        },
      });
      await workflow({
        name:'ci-log-workflow',title:'Investigate a failed CI run',artifactTitle:'Windows CI Â· run 294',
        prompt:'Show where CI failed. Let me filter the build log to find the first error.',
        reply:'The Windows job stopped at typecheck. Filter the log and open the error for details.',
        spec:{root:'logs',elements:{logs:{type:'LogExplorer',props:{dataBinding:'logs',stateKey:'logView'}}}},
        data:{logs:{title:'Build events',events:[
          {id:'setup',level:'info',message:'Dependencies installed',stream:'setup',timestamp:'2026-11-14T09:00:15Z'},
          {id:'bundled',level:'info',message:'Renderer assets built',stream:'renderer',timestamp:'2026-11-14T09:00:32Z'},
          {id:'failure',level:'error',message:'Typecheck failed',stream:'compiler',timestamp:'2026-11-14T09:00:36Z',detail:'TS2322: Type string is not assignable to type ReviewStatus.'},
          {id:'exit',level:'warning',message:'Browser checks were skipped',stream:'runner',timestamp:'2026-11-14T09:00:37Z'},
        ]}},
        async interact(page) {
          const filter=page.getByRole('searchbox',{name:'Search logs'});
          await point(page,filter); await filter.click(); await filter.fill('typecheck');
          const log=page.getByRole('listbox',{name:'Log events'});
          await expect(log.getByRole('option')).toHaveCount(1); await hold(page,700);
          const failure=log.getByRole('option',{name:'error: Typecheck failed'});
          await point(page,failure); await failure.click();
          await expect(failure).toHaveAttribute('aria-selected','true');
          const details=page.getByText('Event details',{exact:true});
          await point(page,details); await details.click();
          await expect(page.getByText('TS2322: Type string is not assignable to type ReviewStatus.',{exact:true})).toBeVisible();
        },
      });
    }
    await writeFile(join(output, 'capture.json'), JSON.stringify(manifest, null, 2));
    await browser.close();
  } finally { await chromiumServer.close(); }
} finally { await server.close(); }
