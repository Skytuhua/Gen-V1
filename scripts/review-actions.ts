import { expect, type Page, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Operation } from '../packages/contracts/index.ts';
import type { openReviewHost, Scenario } from './review-host.ts';
import {SYNTHETIC_REVIEW_TOKEN} from './review-fixtures.ts';
type Host = Awaited<ReturnType<typeof openReviewHost>>;

export async function humanClick(page: Page, locator: Locator, hold = 500) {
  await locator.waitFor({ state: 'visible' }); await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox(); if (!box) throw new Error('Control has no visible geometry');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 14 });
  await page.waitForTimeout(120); await locator.click(); await page.waitForTimeout(hold);
}
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
/** Exercise the native write-only slot. The recorder never uses a real secret. */
export async function reviewPrivateToken(page:Page,scope:Locator){
  const input=scope.getByLabel('API token',{exact:true});await expect(input).toBeEnabled();
  await input.pressSequentially(SYNTHETIC_REVIEW_TOKEN,{delay:35});
  const saved=page.waitForResponse(response=>response.request().method()==='PUT'&&/\/credentials\/projectApiToken$/.test(new URL(response.url()).pathname));
  await humanClick(page,scope.getByRole('button',{name:'Save token',exact:true}),600);
  const response=await saved;expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toBe('no-store');expect(await response.json()).toMatchObject({present:true});
  await expect(scope.getByText('Saved for this host session',{exact:true})).toBeVisible();await expect(input).toHaveValue('');
  const removed=page.waitForResponse(response=>response.request().method()==='DELETE'&&/\/credentials\/projectApiToken$/.test(new URL(response.url()).pathname));
  await humanClick(page,scope.getByRole('button',{name:'Remove token',exact:true}),650);expect(await (await removed).json()).toMatchObject({present:false});
  await expect(scope.getByText('No token saved',{exact:true})).toBeVisible();
}
async function hold(page: Page, milliseconds = 700) { await page.waitForTimeout(milliseconds); }
export async function drawMark(page: Page) {
  const target = page.locator('.signature-canvas'); await target.scrollIntoViewIfNeeded(); const box = await target.boundingBox(); if (!box) throw new Error('Signature drawing surface unavailable');
  for (const stroke of [[[.12,.72],[.2,.25],[.28,.73],[.17,.57],[.28,.57]], [[.34,.7],[.42,.48],[.45,.68],[.5,.45],[.55,.67],[.64,.5],[.71,.65],[.8,.4],[.85,.7]]]) {
    await page.mouse.move(box.x + stroke[0][0] * box.width, box.y + stroke[0][1] * box.height); await page.mouse.down();
    for (const [x, y] of stroke.slice(1)) { await page.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 8 }); await page.waitForTimeout(45); } await page.mouse.up();
  }
  await hold(page, 700);
}
async function waitIdle(host: Host, id: string) {
  await expect.poll(() => host.store.get<{ runId: string | null }>('thread', id)?.runId, { timeout: 30000 }).toBeNull();
}
async function nativeApproval(page: Page) {
  const approval = page.getByRole('region', { name: 'Operation approval' });
  const decision = page.locator('.decision[data-operation-id]').filter({ has: button(page, 'Approve operation') }).first();
  await decision.waitFor({ state: 'visible', timeout: 20000 });
  await humanClick(page, decision.getByText('Changes and preconditions', { exact: true }), 800);
  await humanClick(page, decision.getByText('Changes and preconditions', { exact: true }), 300);
  await humanClick(page, decision.getByRole('button', { name: 'Approve operation', exact: true }), 600);
  void approval;
}
export async function runReviewActions(scenario: Scenario, page: Page, host: Host, chapter: (title: string) => Promise<void> = async () => {}, explorationOnly=false, captureTheme:'dark'|'light'='dark') {
  const threadId = host.threads.get(scenario)!.id;
  if (scenario === 'signing') {
    await expect(page.locator('.document-preview canvas').first()).toBeVisible({ timeout: 20000 });
    await chapter('Live document and contextual choices');
    await humanClick(page, page.getByRole('radio', { name: /Acme Studio LLC/ }));
    await humanClick(page, button(page, 'Next step'), 900);
    await humanClick(page, page.getByRole('radio', { name: /Work/ }));
    await humanClick(page, page.getByRole('radio', { name: 'Something else', exact: true }));
    const email = page.getByRole('textbox', { name: 'Something else', exact: true }); await email.fill('legal@studio.example'); await hold(page, 900);
    await humanClick(page, button(page, 'Previous step')); await humanClick(page, button(page, 'Next step'), 700);
    await humanClick(page, button(page, 'Next step'), 1000);
    await chapter('Generate and vary the saved signature');
    await humanClick(page, button(page, 'Edit name'));
    const name = page.getByRole('textbox', { name: 'Type your name', exact: true }); await name.fill('Alex Morgan'); await hold(page, 1000);
    await humanClick(page, button(page, 'Edit name'));
    await humanClick(page, button(page, 'Another style'), 1000);
    await expect.poll(() => host.store.all<{ values: Record<string, unknown> }>('userState', threadId)[0]?.values.signature, { timeout: 15000 }).toMatchObject({ kind: 'image' });
    const mark = host.store.all<{ values: { signature: { resourceId: string } } }>('userState', threadId)[0].values.signature;
    const markGrant = host.store.get<{ path: string }>('resource', mark.resourceId)!;
    const png = await readFile(markGrant.path);
    await humanClick(page, button(page, 'Draw')); await chapter('Draw, clear and preserve multiple strokes'); await drawMark(page);
    await humanClick(page, button(page, 'Clear')); await drawMark(page);
    await humanClick(page, button(page, 'Upload'));
    await chapter('Upload a PNG and restore it after reload');
    await page.getByLabel('Upload PNG signature', { exact: true }).setInputFiles({ name: 'signature.png', mimeType: 'image/png', buffer: png }); await hold(page, 1100);
    await expect.poll(() => host.store.all<{ values: Record<string, unknown> }>('userState', threadId)[0]?.values.signature, { timeout: 15000 }).toMatchObject({ kind: 'image' });
    await page.reload(); await expect(page.locator('.signature-pad img')).toBeVisible(); await expect(page.locator('.document-preview canvas').first()).toBeVisible(); await hold(page, 1000);
    await humanClick(page, button(page, 'Next step'));
    await chapter('Review and exact native approval');
    await humanClick(page, page.getByRole('checkbox', { name: 'I have reviewed these details', exact: true }));
    await humanClick(page, button(page, 'Sign & prepare export'), 1000); await waitIdle(host, threadId);
    await humanClick(page, button(page, 'Review local export'), 700); await nativeApproval(page);
    await expect.poll(() => host.store.all<Operation>('operation', threadId).find(op => op.kind === 'pdf.export')?.status, { timeout: 30000 }).toBe('succeeded');
    await waitIdle(host, threadId); await expect(page.getByText(/^Signed for /)).toBeVisible(); await expect(page.getByRole('link', { name: 'Download PDF', exact: true })).toBeVisible();
    // Native approval focused its receipt. Reframe the completed working object
    // for the review hold without changing application layout or camera scale.
    await page.locator('.artifact').first().evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    await hold(page, 2200);
  } else if (scenario.startsWith('pr-')) {
    const graph = page.locator('.task-graph'); await expect(graph).toBeVisible();
    await chapter('Conflict inspection');
    await hold(page, 1600);
    const node = graph.getByRole('button').filter({ hasText: 'Refresh tokens' }).first();
    if (await node.count()) { await node.hover(); await hold(page, 1200); await page.mouse.move(300, 300); }
    await chapter('Resolution and check progression'); await humanClick(page, button(page, 'Resolve conflicts'), 80); await page.mouse.move(300, 100, { steps: 8 }); await waitIdle(host, threadId);
    await expect(button(page, 'Merge')).toBeVisible(); await hold(page, 1200);
    const check = page.getByText('Tests', { exact: true }).first(); if (await check.count()) { await page.mouse.move(300, 100); await hold(page, 200); await check.hover(); await hold(page, 1100); await page.mouse.move(300, 100); }
    await chapter('Readiness and merge feedback'); await humanClick(page, button(page, 'Merge'), 500); await waitIdle(host, threadId);
    await expect(page.locator('.task-graph-summary')).toContainText('Merged'); await hold(page, 2300);
  } else if (scenario === 'migration') {
    host.runtime.beforeMigrationTable = async table => { await humanClick(page, page.getByRole('tab', { name: table, exact: true }), 350); };
    await chapter('Prepared local migration and exact approval');
    await humanClick(page, button(page, 'Review local migration'), 700); await nativeApproval(page);
    await expect.poll(() => host.store.all<Operation>('operation', threadId).find(op => op.kind === 'database.migration')?.status, { timeout: 30000 }).toBe('succeeded');
    await chapter('Ordered inspection of actual committed changes');
    await waitIdle(host, threadId);
    host.runtime.beforeMigrationTable = undefined;
    await chapter('Revisit every completed table');
    for (const table of ['users', 'projects', 'messages', 'workspaces']) await humanClick(page, page.getByRole('tab', { name: table, exact: true }), 900);
    await hold(page, 1500);
  } else if (scenario === 'context') {
    await humanClick(page, button(page, 'Inspect context usage'), 800);
    await chapter('Anchored context and progressive details');
    await expect(page.getByRole('dialog', { name: 'Context inspector' })).toBeVisible();
    await humanClick(page, page.getByText('Usage details', { exact: true }), 800);
    for (const category of ['Messages', 'Tools']) { const control = page.getByRole('button', { name: new RegExp('^' + category) }).first(); if (await control.count()) { await control.hover(); await hold(page, 1100); } }
    await chapter('Compaction lifecycle'); await humanClick(page, button(page, 'Compact now'), 2200); await waitIdle(host, threadId); await hold(page, 1700);
    await page.keyboard.press('Escape'); await hold(page); await humanClick(page, button(page, 'Inspect context usage'), 1000); await page.keyboard.press('Escape');
  } else if (scenario === 'faq') {
    await chapter('Multiple answers and nested follow-ups');
    for (const question of ['Who can open an account?', 'What documents do I need?', 'How do payments work?', 'How long do international transfers take?']) {
      await humanClick(page, button(page, question), 500); await waitIdle(host, threadId); await hold(page, 650);
    }
    await chapter('A new question joins the existing tree');
    const input = page.getByRole('textbox', { name: 'Your question', exact: true }); await input.fill('Do you support wire transfers?'); await hold(page, 500); await input.press('Enter'); await waitIdle(host, threadId); await hold(page, 1000);
    await humanClick(page, button(page, 'Can I change plans later?'), 500); await waitIdle(host, threadId);
    await humanClick(page, button(page, 'Who can open an account?')); await humanClick(page, button(page, 'Who can open an account?'), 1000);
  } else if (scenario === 'map') {
    await chapter('Linked map and carousel selection');
    await humanClick(page, button(page, 'Next place'), 850); await humanClick(page, button(page, 'Next place'), 850);
    await humanClick(page, page.getByRole('button', { name: 'Select Fern & Fig', exact: true }), 1000);
    await humanClick(page, page.getByLabel('Selected place', { exact: true }).getByText('Place details', { exact: true }), 900);
    await humanClick(page, page.getByLabel('Selected place', { exact: true }).getByText('Place details', { exact: true }), 400);
    await chapter('Selection survives map theme changes'); for (const theme of ['Terrain', 'Night', 'Paper']) await humanClick(page, button(page, theme), 1100);
    await humanClick(page, page.getByRole('button', { name: 'Send feedback request', exact: true }), 900); await waitIdle(host, threadId); await hold(page, 1100);
  } else if (scenario === 'catalog') {
    if(!explorationOnly){
    await chapter('Controls: choice, input, select, toggle, form, steps and button');
    await humanClick(page, page.getByRole('radio', { name: /Download Local/ })); await page.getByRole('textbox', { name: 'Review note', exact: true }).fill('Keep the evidence beside the decision.');
    await page.getByRole('combobox', { name: 'Density', exact: true }).selectOption('compact'); await humanClick(page, page.getByRole('checkbox', { name: 'Keep selection on reload', exact: true }));
    await humanClick(page, button(page, 'Next step')); await humanClick(page, button(page, 'Save choice')); await waitIdle(host, threadId);
    for (const tab of ['Data & visuals', 'Documents', 'Content','Development','Everyday','Interactions']) {
      await humanClick(page, page.getByRole('tab', { name: tab, exact: true }), 1200);
      await chapter(tab);
      const container = page.locator('.conversation-scroll'), panel = page.getByRole('tabpanel').filter({ visible: true }).first();
      const selectors = tab === 'Data & visuals' ? ['.surface-metric', '.surface-progress', 'table', '.chart', '.task-graph', '.task-map', '.timeline', '.tree', '.surface-image'] : tab === 'Documents' ? ['.document-preview', '.signature-pad', '.document', '.code-block', '.diff'] :tab==='Development'?['.software-diagnostics','.software-changes','.software-api','.software-pipeline','.image-compare']:tab==='Everyday'?['.everyday-stats','.everyday-comparison','.credential-entry']:tab==='Interactions'?['.review-queue','.editable-table','.parameter-controls']: ['.task-status', '.evidence-list'];
      for (const selector of selectors) {
        const item = panel.locator(selector).first(); await expect(item).toBeAttached();
        await item.scrollIntoViewIfNeeded(); await hold(page, 1400);
        if (selector === 'table') { const checkbox = item.getByRole('checkbox').first(); if (await checkbox.count()) await humanClick(page, checkbox, 650); }
        if (selector === '.tree') { await humanClick(page, item.locator('summary').first(), 650); await humanClick(page, item.locator('summary').first(), 650); }
        if (selector === '.document-preview') await expect(item.getByRole('status')).toContainText(/preview.*Page/, { timeout: 15000 });
        if (selector === '.signature-pad') { await humanClick(page, item.getByRole('button', { name: 'Draw', exact: true })); await drawMark(page); }
        if(selector==='.software-diagnostics'){await humanClick(page,item.getByRole('tab',{name:'empty basket returns zero',exact:true}));await humanClick(page,item.getByRole('tab',{name:'includes item quantity',exact:true}));}
        if(selector==='.software-changes'){await humanClick(page,item.getByRole('tab',{name:'tests/total.test.ts',exact:true}));await humanClick(page,item.getByRole('tab',{name:'src/total.ts',exact:true}));}
        if(selector==='.software-api'){await humanClick(page,item.getByRole('tab',{name:'Response 409',exact:true}));await humanClick(page,item.getByRole('tab',{name:'GET /orders/{id}',exact:true}));}
        if(selector==='.software-pipeline'){await humanClick(page,item.getByRole('tab',{name:'Tests',exact:true}));await humanClick(page,item.getByRole('tab',{name:'Typecheck',exact:true}));await humanClick(page,item.getByRole('tab',{name:'Build',exact:true}));}
        if(selector==='.everyday-stats'){await humanClick(page,item.getByRole('tab',{name:'Response time',exact:true}));await humanClick(page,item.getByRole('tab',{name:'Cost',exact:true}));await humanClick(page,item.getByRole('tab',{name:'Requests',exact:true}));}
        if(selector==='.everyday-comparison'){await humanClick(page,item.getByRole('button',{name:'Select Studio',exact:true}));await humanClick(page,item.getByRole('checkbox',{name:'Differences only',exact:true}));}
        if(selector==='.credential-entry')await reviewPrivateToken(page,item);
        if(selector==='.review-queue'){await humanClick(page,item.getByRole('radio',{name:'Accept',exact:true}));await humanClick(page,item.getByRole('button',{name:'Next item',exact:true}));await humanClick(page,item.getByRole('radio',{name:'Request changes',exact:true}));await item.getByRole('textbox',{name:'Review comment',exact:true}).fill('Name the callers that were checked.');}
        if(selector==='.editable-table'){await item.getByRole('spinbutton',{name:'Prints \u00b7 Quantity',exact:true}).fill('6');await item.getByRole('combobox',{name:'Prints \u00b7 Priority',exact:true}).selectOption('urgent');await hold(page,700);}
        if(selector==='.parameter-controls'){await item.getByRole('slider',{name:'Quality',exact:true}).focus();await page.keyboard.press('ArrowRight');await item.getByRole('combobox',{name:'Format',exact:true}).selectOption('webp');await hold(page,700);}

      }
      if (tab === 'Content') await humanClick(page, button(page, 'What is included?'), 900);
      await container.evaluate(element => element.scrollTo({ top: 0, behavior: 'smooth' })); await hold(page, 900);
    }
    }
    await humanClick(page,page.getByRole('tab',{name:'Explore',exact:true}),700);
    await chapter('Image feedback: durable source-bound pins');
    await expect(button(page,'Add pin')).toBeEnabled();await humanClick(page,button(page,'Add pin'),400);
    await page.getByRole('textbox',{name:'Pin feedback',exact:true}).pressSequentially('Give the preview and settings more separation.',{delay:18});
    await page.getByRole('button',{name:'Pin 1',exact:true}).press('Shift+ArrowRight');await page.getByRole('button',{name:'Pin 1',exact:true}).press('Shift+ArrowRight');await hold(page,700);
    await humanClick(page,button(page,'Send feedback'),600);await waitIdle(host,threadId);
    await humanClick(page,page.getByRole('tab',{name:'Schedule',exact:true}),700);await chapter('Supplied windows: timezone, availability and proposal');
    await humanClick(page,page.getByRole('option',{name:'Design review',exact:true}),900);await humanClick(page,button(page,'Propose this time'),600);await waitIdle(host,threadId);
    await humanClick(page,page.getByRole('tab',{name:'Logs',exact:true}),700);await chapter('Logs: local filtering, selected evidence and continuation');
    await page.getByRole('searchbox',{name:'Search logs',exact:true}).pressSequentially('quantity',{delay:80});await hold(page,700);
    await humanClick(page,page.getByRole('option',{name:'error: Quantity assertion failed',exact:true}),900);await humanClick(page,button(page,'Investigate event'),600);await waitIdle(host,threadId);
    await chapter('Reload preserves the selected evidence and local filters');
    await page.reload();await expect(page.getByRole('searchbox',{name:'Search logs',exact:true})).toHaveValue('quantity');await expect(page.getByRole('option',{name:'error: Quantity assertion failed',exact:true})).toHaveAttribute('aria-selected','true');await hold(page,1000);
  } else {
    await chapter('Workspace launcher and unavailable integrations');
    await humanClick(page, button(page, 'Open workspace panel'), 1000);
    await expect(page.getByRole('region', { name: 'Workspace launcher' })).toBeVisible();
    await humanClick(page, button(page, 'Close workspace panel'));
    await chapter('Same artifact in the right workspace');
    await humanClick(page, button(page, 'Open artifact in workspace'), 900);
    await humanClick(page, button(page, 'Maximize workspace panel'), 700); await humanClick(page, button(page, 'Restore workspace panel'), 700);
    for (const tab of ['Files', 'Diff', 'Output', 'Usage', 'Artifact']) await humanClick(page, page.getByRole('tab', { name: tab, exact: true }), 700);
    await humanClick(page, button(page, 'Close workspace panel'));
    const sidebarSize = page.getByRole('separator', { name: 'Resize sidebar', exact: true }); await sidebarSize.focus(); await sidebarSize.press('ArrowRight'); await hold(page, 600); await sidebarSize.press('ArrowLeft');
    await chapter('Settings inventory, working controls and unavailable features');
    await humanClick(page, page.getByRole('button', { name: 'Settings', exact: true }), 800);
    const navigation = page.getByRole('navigation', { name: 'Settings sections' });
    for (const section of await navigation.getByRole('button').all()) await humanClick(page, section, 500);
    await page.getByRole('searchbox', { name: 'Search all settings' }).fill('recording'); await hold(page, 1200);
    await page.getByRole('searchbox', { name: 'Search all settings' }).fill('Color scheme'); await expect(page.getByRole('combobox', { name: 'Color scheme', exact: true })).toHaveValue(captureTheme); await hold(page, 1100);
    await humanClick(page, button(page, 'Close settings')); await humanClick(page, button(page, 'Collapse sidebar')); await hold(page, 700); await humanClick(page, button(page, 'Toggle sidebar')); await hold(page, 1100);
  }
}
