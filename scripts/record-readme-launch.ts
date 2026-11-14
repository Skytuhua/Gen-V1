import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium, expect, type Locator, type Page } from '@playwright/test';
import { graphData, graphSpec, type PRPhase } from './review-pr.ts';
import { recordWindow } from './review-capture.ts';
import { serveTaskFixture, taskFixture, type TaskSpec } from '../tests/e2e/task-interface-fixture.ts';

const output = resolve(process.argv[2] ?? '.harness-readme-launch');
await mkdir(output, { recursive: true });
process.env.GEN_E2E = '1';
const server = await createServer({ server: { host: '127.0.0.1', port: 5579, strictPort: true }, configLoader: 'runner' });
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
    async function point(page: Page, target: Locator) {
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      if (!box) throw Error('The demo control was not visible.');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 9 });
    }
    if(process.env.GEN_README_FLOWS !== 'everyday') await capture('pull-request', async page => {
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
    if(process.env.GEN_README_FLOWS !== 'everyday') await capture('interactive-table', async page => {
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
      followup?: {prompt: string; reply: string};
      interact(page: Page): Promise<void>;
    };
    const everyday = async (demo: Demo) => capture(demo.name, async page => {
      const snapshot = taskFixture(demo.spec, demo.data, demo.values);
      snapshot.settings.theme = 'dark';
      const thread = snapshot.threads[0]; thread.title = demo.title; thread.projectName = '';
      thread.createdAt = thread.updatedAt = new Date().toISOString();
      const assistant = snapshot.messages.pop()!;
      const artifact = snapshot.artifacts.pop()!;
      assistant.content = demo.reply; artifact.title = demo.artifactTitle;
      const host = await serveTaskFixture(page, snapshot);
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
        await expect(page.locator('.artifact-content')).toBeVisible(); await hold(page, 1050);
        await demo.interact(page);
        if (demo.followup) {
          await ask(demo.followup.prompt);
          await expect(page.getByText(demo.followup.reply, {exact:true})).toBeVisible({timeout: 12000});
        }
        await page.mouse.move(429, 600);
        await hold(page, 1500);
      };
    });
    if(process.env.GEN_README_FLOWS !== 'original') {
      await everyday({
        name: 'study-plan', title: 'Plan a study week', artifactTitle: 'Your study plan',
        prompt: 'I have 30 minutes each night before my quiz. Make me a study checklist.',
        reply: 'Start with the hardest topics. Each session fits in 30 minutes.',
        spec: {root:'table', elements:{table:{type:'Table', props:{
          rowsBinding:'rows', rowKey:'id', stateKey:'selected', caption:'Study sessions',
          columns:[{key:'day',label:'Day'},{key:'task',label:'What to do'},{key:'duration',label:'Time'}],
        }}}},
        data: {rows:[
          {id:'mon',day:'Monday',task:'Review lecture notes',duration:'20 min'},
          {id:'tue',day:'Tuesday',task:'Practice the hardest problems',duration:'30 min'},
          {id:'wed',day:'Wednesday',task:'Make a one-page summary',duration:'25 min'},
          {id:'thu',day:'Thursday',task:'Take a short practice quiz',duration:'30 min'},
        ]},
        values:{selected:[]},
        async interact(page) {
          for(const row of ['mon','tue']) {
            const checkbox=page.locator(`.task-table [data-row-id=${row}] input`);
            await point(page, checkbox); await checkbox.check(); await expect(checkbox).toBeChecked(); await hold(page, 650);
          }
        },
      });
      await everyday({
        name:'laptop-comparison', title:'Compare three laptops', artifactTitle:'Laptop shortlist',
        prompt:'Compare these three sample laptops by price, weight and battery life.',
        reply:'All three are under $1,000. Sort by what matters most to you.',
        spec:{root:'table',elements:{table:{type:'Table',props:{
          rowsBinding:'rows',rowKey:'id',stateKey:'selected',caption:'Compare laptops',
          columns:[{key:'name',label:'Laptop'},{key:'price',label:'Price ($)'},{key:'weight',label:'Weight (lb)'},{key:'battery',label:'Battery (hr)'}],
        }}}},
        data:{rows:[
          {id:'alder',name:'Alder 14',price:849,weight:3.2,battery:10},
          {id:'fern',name:'Fern Air',price:979,weight:2.6,battery:13},
          {id:'pine',name:'Pine 13',price:749,weight:3.1,battery:9},
        ]},values:{selected:[]},
        async interact(page) {
          const table=page.locator('.task-table');
          for(const [name,expected] of [['Sort Price ($)','Pine 13'],['Sort Weight (lb)','Fern Air']]) {
            const button=page.getByRole('button',{name,exact:true});
            await point(page,button);await button.click();await expect(table.locator('tbody tr').first()).toContainText(expected);await hold(page,850);
          }
          const pick=table.locator('[data-row-id=fern] input');
          await point(page,pick);await pick.check();await expect(pick).toBeChecked();
        },
      });
      await everyday({
        name:'weekend-trip',title:'Plan a car-free weekend',artifactTitle:'Saturday itinerary',
        prompt:'Plan a relaxed Saturday trip without a car. Give me a backup if it rains.',
        reply:'Here are two easy versions of the day. Open either to see the details.',
        spec:{root:'list',elements:{
          list:{type:'Stack',props:{gap:'sm'},children:['morning','afternoon','rain']},
          morning:{type:'Disclosure',props:{title:'Morning · Train and coffee',text:'Take the 9:15 train and walk five minutes to the station café.',stateKey:'morning'}},
          afternoon:{type:'Disclosure',props:{title:'Afternoon · Waterfront walk',text:'Leave the afternoon open for the waterfront path and lunch.',stateKey:'afternoon'}},
          rain:{type:'Disclosure',props:{title:'Rain backup · Museum',text:'Swap the waterfront walk for a small museum near the station.',stateKey:'rain'}},
        }},
        followup:{prompt:'Move the rain plan to the morning.',reply:'Museum first, then lunch by the station. Keep the afternoon flexible.'},
        async interact(page) {
          const rain=page.getByRole('button',{name:'Rain backup · Museum',exact:true});
          await point(page,rain);await rain.click();await expect(rain).toHaveAttribute('aria-expanded','true');
          await expect(page.getByText('Swap the waterfront walk for a small museum near the station.',{exact:true})).toBeVisible();
          await hold(page,1000);
        },
      });
    }
    await writeFile(join(output, 'capture.json'), JSON.stringify(manifest, null, 2));
    await browser.close();
  } finally { await chromiumServer.close(); }
} finally { await server.close(); }
