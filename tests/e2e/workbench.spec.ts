import {test,expect,type Page} from '@playwright/test';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {cpus,platform,release,totalmem} from 'node:os';
// A trace snapshots every mounted row. Keep both renderer conditions free of
// that measurement overhead; assertion failures still retain logs and context.
test.use({trace:'off'});
async function select(page:Page,selector='#source-text',start=8,end=21){await page.locator(selector).evaluate((element,{start,end})=>{const node=element.firstChild!,range=document.createRange();range.setStart(node,start);range.setEnd(node,end);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);element.dispatchEvent(new MouseEvent('pointerup',{bubbles:true}));document.dispatchEvent(new Event('selectionchange'));},{start,end});}
test('M15 selected visible text exposes explicit actions',async({page})=>{await page.goto('/fixture');await select(page);await expect(page.getByRole('button',{name:'Attach to prompt',exact:true})).toBeVisible();await page.getByRole('button',{name:'Attach to prompt',exact:true}).click();await expect(page.locator('output')).toHaveText('attach:selected text');});
test('M15 forged DOM attributes cannot register a selection',async({page})=>{await page.goto('/fixture');await select(page,'[data-source-id="forged"]',0,6);await expect(page.getByRole('toolbar',{name:'Selected source'})).toHaveCount(0);});
test('M15 hidden and clipped source text is refused',async({page})=>{await page.goto('/fixture');await page.locator('#source-text').evaluate(el=>{el.style.opacity='0';});await select(page);await expect(page.getByRole('toolbar',{name:'Selected source'})).toHaveCount(0);await page.locator('#source-text').evaluate(el=>{el.style.opacity='1';el.style.width='2px';el.style.overflow='hidden';el.style.whiteSpace='nowrap';});await select(page);await expect(page.getByRole('toolbar',{name:'Selected source'})).toHaveCount(0);});
test('M15 refuses a clipped interior span even when both selection endpoints are visible',async({page})=>{
 await page.goto('/fixture');await page.locator('#source-text').evaluate(element=>{element.replaceChildren(document.createTextNode('Visible '),Object.assign(document.createElement('span'),{textContent:'selected text'}),document.createTextNode(' from an assistant.'));const span=element.querySelector('span')!;Object.assign(span.style,{display:'inline-block',width:'2px',overflow:'hidden',whiteSpace:'nowrap'});const range=document.createRange();range.setStart(element.firstChild!,0);range.setEnd(element.lastChild!,5);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await expect(page.getByRole('toolbar',{name:'Selected source'})).toHaveCount(0);await expect(page.locator('output')).toHaveText('');
});
test('M15 refuses transformed Markdown whose visible selection could match a different canonical occurrence',async({page})=>{
 await page.goto('/fixture');const cell=page.locator('#transformed-source td');await expect(cell).toHaveText('left|right');await cell.evaluate(element=>{const range=document.createRange();range.selectNodeContents(element);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await expect(page.getByRole('toolbar',{name:'Selected source'})).toHaveCount(0);await expect(page.locator('output')).toHaveText('');
});
test('M15 Escape respects IME and dismisses pointing without activating buttons',async({page})=>{await page.goto('/fixture');await select(page);const attach=page.getByRole('button',{name:'Attach to prompt',exact:true});await expect(attach).toBeVisible();await attach.focus();await attach.dispatchEvent('keydown',{key:'Escape',isComposing:true});await expect(attach).toBeVisible();await page.keyboard.press('Escape');await expect(attach).toHaveCount(0);await expect(page.locator('output')).toHaveText('');});
test('M15 toolbar stays reachable at both viewports and 200 percent zoom',async({page})=>{for(const viewport of [{width:1280,height:800},{width:1920,height:1080}]){await page.setViewportSize(viewport);await page.goto('/fixture');await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>{document.body.style.zoom='2';});await select(page);const toolbar=page.getByRole('toolbar',{name:'Selected source'});await expect(toolbar).toBeVisible();const rect=await toolbar.boundingBox();expect(rect!.x).toBeGreaterThanOrEqual(0);expect(rect!.x+rect!.width).toBeLessThanOrEqual(viewport.width);expect(rect!.y+rect!.height).toBeLessThanOrEqual(viewport.height);await page.getByRole('button',{name:'Open source',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.locator('output')).toHaveText('open:selected text');}});

async function openOutput(page: Page, mode = 'windowed') {
  await page.goto(`/fixture?fixture=output&mode=${mode}`);
  await expect(page.locator('[data-fixture-ready]')).toHaveText('Ready', {timeout: mode === 'unwindowed' ? 30_000 : 5_000});
}
async function settleOutput(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test('M15 output window stays bounded while streaming preserves the logical anchor', async ({page}) => {
  await openOutput(page);
  const viewport = page.locator('[data-output-viewport]');
  await viewport.evaluate(element => {element.scrollTop = 42420 * 22 + 7;});
  await expect(page.locator('[data-output-anchor]')).toHaveText('line:42420:7');
  const before = await viewport.evaluate(element => element.scrollTop);
  await page.getByRole('button', {name: 'Append 100 retained lines'}).click();
  await settleOutput(page);
  expect(await viewport.evaluate(element => element.scrollTop)).toBe(before);
  expect(await page.locator('[data-output-row-id]').count()).toBeLessThanOrEqual(300);
  await expect(page.locator('[data-output-row-id="line:42420"]')).toBeVisible();
  const counts = await page.evaluate(() => {
    const model = (window as unknown as {__m15ReadModels: {messages: readonly unknown[]; tasks: readonly unknown[]; output: readonly unknown[]}}).__m15ReadModels;
    return {messages: model.messages.length, tasks: model.tasks.length, output: model.output.length, frozen: Object.values(model).every(Object.isFrozen)};
  });
  expect(counts).toEqual({messages: 10_000, tasks: 500, output: 100_000, frozen: true});
});

test('M15 full copy and search use the declared reader fixture beyond mounted DOM', async ({page,context}) => {
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await openOutput(page);
  await expect(page.getByText('Reader: explicit fixture stub, not host authorization.')).toBeVisible();
  await expect(page.locator('[data-output-row-id="line:95001"]')).toHaveCount(0);
  await page.locator('[data-output-row-id="line:0"]').evaluate(element => {element.textContent = 'FORGED MOUNTED DOM';});
  await page.getByRole('button', {name: 'Copy full result', exact: true}).click();
  await expect(page.getByText('Copied full result.', {exact: true})).toBeVisible();
  // The OS clipboard normalizes line endings (CRLF on Windows); compare logical lines.
  const copied = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
  expect(copied.startsWith('Output line 0\nOutput line 1\n')).toBe(true);
  expect(copied.endsWith('Output line 99999\n')).toBe(true);
  expect(copied).not.toContain('FORGED MOUNTED DOM');
  expect(copied.split('\n')).toHaveLength(100_001);
  await page.getByRole('searchbox', {name: 'Search full result', exact: true}).fill('needle');
  await page.getByRole('button', {name: 'Search full result', exact: true}).click();
  await expect(page.getByText('1 of 1 matching lines', {exact: true})).toBeVisible();
  await expect(page.locator('[data-output-row-id="line:95001"]')).toBeVisible();
  await expect(page.locator('[data-full-read-count]')).toHaveText('2');
});

test('M15 delayed full-result response cannot write into a new owner view', async ({page}) => {
  await openOutput(page);
  await page.getByLabel('Hold full reads').check();
  await page.getByRole('searchbox', {name: 'Search full result', exact: true}).fill('needle');
  await page.getByRole('button', {name: 'Search full result', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Searching…', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Switch owner'}).click();
  await expect(page.locator('[data-fixture-owner]')).toHaveText('thread-b');
  await page.getByRole('button', {name: 'Release full reads'}).click();
  await settleOutput(page);
  await expect(page.getByText('1 of 1 matching lines', {exact: true})).toHaveCount(0);
  await expect(page.getByRole('searchbox', {name: 'Search full result', exact: true})).toHaveValue('');
});

test('M15 discards a delayed search result when its query changes', async ({page}) => {
  await openOutput(page);
  await page.getByLabel('Hold full reads').check();
  const search = page.getByRole('searchbox', {name:'Search full result',exact:true});
  await search.fill('needle');
  await page.getByRole('button', {name:'Search full result',exact:true}).click();
  await expect(page.getByRole('button', {name:'Searching…',exact:true})).toBeVisible();
  await search.fill('a different query');
  await page.getByRole('button', {name:'Release full reads'}).click();
  await settleOutput(page);
  await expect(search).toHaveValue('a different query');
  await expect(page.getByText('1 of 1 matching lines', {exact:true})).toHaveCount(0);
  await expect(page.getByRole('button', {name:'Search full result',exact:true})).toBeEnabled();
});

test('M15 real browser journal reload retains canonical draft, source refs and scroll anchor', async ({page}) => {
  await openOutput(page);
  await page.getByLabel('Fixture canonical draft').fill('Keep this prompt across a reload');
  await expect(page.locator('[data-draft-save]')).toHaveText('Saved');
  await page.getByRole('button', {name: 'Attach fixture source'}).click();
  await expect(page.locator('[data-source-count]')).toHaveText('1');
  await page.locator('[data-output-viewport]').evaluate(element => {element.scrollTop = 42420 * 22 + 7;});
  await expect(page.locator('[data-output-anchor]')).toHaveText('line:42420:7');
  await expect(page.locator('[data-anchor-save]')).toHaveText('Saved');
  await page.reload();
  await expect(page.locator('[data-fixture-ready]')).toHaveText('Ready');
  await expect(page.getByLabel('Fixture canonical draft')).toHaveValue('Keep this prompt across a reload');
  await expect(page.locator('[data-source-count]')).toHaveText('1');
  await expect(page.locator('[data-output-row-id="line:42420"]')).toBeVisible();
  expect(await page.locator('[data-output-viewport]').evaluate(element => element.scrollTop)).toBe(42420 * 22 + 7);
});

test('M15 rapid presentation writes preserve the last acknowledged scroll anchor', async ({page}) => {
  await openOutput(page);
  await page.getByRole('button',{name:'Burst presentation writes'}).click();
  await expect(page.locator('[data-burst-result]')).toHaveText('Saved:32:line:31');
  await page.reload();
  await expect(page.locator('[data-fixture-ready]')).toHaveText('Ready');
  await expect(page.locator('[data-output-anchor]')).toHaveText('line:31:0');
  expect(await page.locator('[data-output-viewport]').evaluate(element=>element.scrollTop)).toBe(31*22);
});

test('M15 uncertain handoff and failed flush retain explicit conflict copies in the browser journal', async ({page}) => {
  await openOutput(page);
  await page.getByLabel('Fixture canonical draft').fill('Unacknowledged unsent text');
  await expect(page.locator('[data-draft-save]')).toHaveText('Saved');
  await page.getByRole('button', {name: 'Attach fixture source'}).click();
  await expect(page.locator('[data-source-count]')).toHaveText('1');
  await page.getByLabel('Uncertain handoff acknowledgment').check();
  await page.getByRole('button', {name: 'Switch owner'}).click();
  await expect(page.locator('[data-handoff-result]')).toHaveText('CONFLICT:ACKNOWLEDGMENT_UNCERTAIN:JOURNAL');
  await expect(page.locator('[data-fixture-owner]')).toHaveText('thread-a');
  await expect(page.getByLabel('Fixture canonical draft')).toHaveValue('Unacknowledged unsent text');
  await page.getByLabel('Uncertain handoff acknowledgment').uncheck();
  await page.getByLabel('Fail journal flush').check();
  await page.getByRole('button', {name: 'Switch owner'}).click();
  await expect(page.locator('[data-handoff-result]')).toHaveText('CONFLICT:FLUSH_FAILED:JOURNAL');
  await expect(page.locator('[data-source-count]')).toHaveText('1');
  await page.reload();
  await expect(page.locator('[data-fixture-ready]')).toHaveText('Ready');
  await expect(page.getByLabel('Fixture canonical draft')).toHaveValue('Unacknowledged unsent text');
  await expect(page.locator('[data-source-count]')).toHaveText('1');
});

test('M15 output supports keyboard scrolling, offline retention and reachable controls at both viewports and zoom', async ({page},info) => {
  for (const size of [{width:1280,height:800},{width:1920,height:1080}]) {
    await page.setViewportSize(size); await openOutput(page); await page.emulateMedia({reducedMotion: 'reduce'});
    await page.evaluate(() => {document.body.style.zoom = '2';});
    const viewport = page.locator('[data-output-viewport]');
    await viewport.focus(); await page.keyboard.press('PageDown');
    await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const search = page.getByRole('searchbox', {name:'Search full result',exact:true});
    await search.focus(); await page.keyboard.type('needle'); await page.keyboard.press('Enter');
    await expect(page.getByText('1 of 1 matching lines',{exact:true})).toBeVisible();
    for (const control of [page.getByRole('button',{name:'Copy full result',exact:true}),page.getByRole('button',{name:'Search full result',exact:true})]) {
      await control.scrollIntoViewIfNeeded(); const rect = await control.boundingBox();
      expect(rect!.x).toBeGreaterThanOrEqual(0); expect(rect!.x + rect!.width).toBeLessThanOrEqual(size.width);
      expect(rect!.y).toBeGreaterThanOrEqual(0); expect(rect!.y + rect!.height).toBeLessThanOrEqual(size.height);
    }
    await page.getByLabel('Host disconnected').check();
    await expect(page.getByRole('button',{name:'Copy full result',exact:true})).toBeDisabled();
    await expect(page.getByText('Host disconnected. Retained rows remain visible; full-result reads are unavailable.')).toBeVisible();
    expect(await page.locator('[data-output-row-id]').count()).toBeGreaterThan(0);
    await expect(page.locator('[data-anchor-save]')).toHaveText('Saved');
    await page.locator('.workbench-output').scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath(`output-${size.width}x${size.height}-zoom200.png`)});
  }
});

type LocalInteractionSample = {durationMs: number; trusted: boolean; value: string};
async function observeLocalInteraction(page: Page): Promise<LocalInteractionSample> {
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('[data-benchmark-interaction]')!, output = document.querySelector<HTMLOutputElement>('[data-interaction-result]')!;
    (window as unknown as {__m15Observation: Promise<LocalInteractionSample>}).__m15Observation = new Promise((resolve, reject) => {
      let started = 0, trusted = false;
      button.addEventListener('click', event => {started = performance.now(); trusted = event.isTrusted;}, {capture:true,once:true});
      const before = output.textContent;
      const timer = setTimeout(() => {observer.disconnect(); reject(Error('Interaction did not reach the DOM.'));}, 30_000);
      const observer = new MutationObserver(() => {if (output.textContent === before) return; observer.disconnect(); clearTimeout(timer); resolve({durationMs: performance.now() - started, trusted, value: output.textContent ?? ''});});
      observer.observe(output, {subtree:true,childList:true,characterData:true});
    });
  });
  await page.locator('[data-benchmark-interaction]').click();
  const sample = await page.evaluate(() => (window as unknown as {__m15Observation: Promise<LocalInteractionSample>}).__m15Observation);
  await settleOutput(page);
  return sample;
}

test.describe('M15 controlled renderer benchmark', () => {
test('M15 measures paired controlled renderer latency with 100,000 retained lines', async ({page},info) => {
  test.setTimeout(180_000);
  const measurements: Record<string, {mountedRows:number;samples:LocalInteractionSample[];p95Ms:number}> = {};
  for (const mode of ['unwindowed','windowed']) {
    await openOutput(page, mode); await settleOutput(page);
    for (let warmup = 0; warmup < 3; warmup++) await observeLocalInteraction(page);
    const samples: LocalInteractionSample[] = [];
    for (let index = 0; index < 30; index++) samples.push(await observeLocalInteraction(page));
    const durations = samples.map(sample => sample.durationMs).sort((a,b) => a-b);
    measurements[mode] = {mountedRows:await page.locator('[data-output-row-id]').count(),samples,p95Ms:durations[Math.ceil(samples.length*.95)-1]};
  }
  const files = ['apps/web/src/WorkbenchOutput.tsx','apps/web/src/workbench-window.ts','apps/web/src/workbench-output.css','apps/web/src/workbench-recovery.ts','apps/web/src/journal.ts','apps/web/src/SourceSelectionActions.tsx','apps/web/src/source-workbench.css','apps/web/src/Markdown.tsx','packages/contracts/source-selection.ts','tests/e2e/workbench-fixture.tsx','tests/e2e/workbench.spec.ts'];
  const report = {
    capturedAt:new Date().toISOString(), scope:'Controlled React renderer fixture only. Unwindowed reference and candidate use the same immutable retained data. Not full application, live provider, desktop or universal-device performance.',
    readModel:'Explicit fixture stub. Host authorization has separate host integration tests.',
    metric:'Trusted click event capture to MutationObserver delivery for a local selected-message control; excludes paint and presentation. Thirty measured samples per condition after three warmups; sequential unwindowed then windowed, no CPU or network throttling; trace capture disabled for both measured conditions.',
    hardware:{platform:platform(),release:release(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,totalMemoryBytes:totalmem()},
    runtime:{node:process.version,browser:page.context().browser()?.version(),viewport:page.viewportSize(),headless:true,build:'Vite development fixture with React development runtime'},
    fixture:{messageMetadata:10_000,tasks:500,retainedOutputLines:100_000},
    sourceDigests:Object.fromEntries(await Promise.all(files.map(async path => [path,createHash('sha256').update(await readFile(path)).digest('hex')]))),
    measurements, acceptance:{candidateP95Under100ms:measurements.windowed.p95Ms<100,candidateMountedRowsAtMost300:measurements.windowed.mountedRows<=300},
  };
  const body = JSON.stringify(report,null,2)+'\n';
  await writeFile(info.outputPath('m15-renderer-performance.json'),body,{flag:'wx'});
  await info.attach('m15-renderer-performance',{body,contentType:'application/json'});
  expect(measurements.unwindowed.mountedRows).toBe(100_000);
  expect(measurements.windowed.mountedRows).toBeLessThanOrEqual(300);
  expect(measurements.windowed.p95Ms).toBeLessThan(100);
  expect(Object.values(measurements).flatMap(item=>item.samples).every(sample=>sample.trusted)).toBe(true);
});
});
