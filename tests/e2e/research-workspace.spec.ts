import {test, expect, type Page} from '@playwright/test';
import {resolve} from 'node:path';
const fixture = '/@fs/' + resolve('tests/e2e/research-workspace-fixture.tsx').replaceAll('\\', '/');
async function action(page: Page, action: string) {
  await page.evaluate(async action => {
    const boot = await fetch('/api/bootstrap').then(r => r.json());
    const response = await fetch('/api/__research-test', {method: 'POST', headers: {'content-type': 'application/json', 'x-harness-csrf': boot.csrfToken}, body: JSON.stringify({action})});
    if (!response.ok) throw Error(await response.text());
  }, action);
}
async function importText(page: Page, text = 'abc') {
  await page.getByRole('button', {name: 'Add source', exact: true}).click();
  await page.getByRole('textbox', {name: 'Source title', exact: true}).fill('Evidence');
  await page.getByRole('textbox', {name: 'Source text', exact: true}).fill(text);
  await page.getByRole('button', {name: 'Capture source', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Evidence', exact: true})).toBeVisible();
}
async function newFindings(page: Page) {
  await page.getByRole('button', {name: 'New document', exact: true}).click();
  await page.getByRole('menuitem', {name: 'Findings', exact: true}).click();
}
test.beforeEach(async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.route(url => url.pathname === '/research-workspace', route => route.fulfill({contentType: 'text/html', body: `<html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root" style="height:100dvh"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>`}));
  await page.goto('/research-workspace'); await action(page, 'reset'); await page.reload();
});
test('imports real text, saves complete findings, reloads, and inspects the pinned exact passage', async ({page}) => {
  await importText(page, 'α research\nExact evidence.');
  await page.getByRole('button', {name: 'Read captured source', exact: true}).click();
  await expect(page.getByRole('textbox', {name: 'Captured passage', exact: true})).toHaveValue('α research\nExact evidence.');
  await page.getByRole('button', {name: 'Cite passage in findings', exact: true}).click();
  const body = 'Complete synthesis.\n'.repeat(1000);
  await page.getByRole('textbox', {name: 'Document title', exact: true}).fill('Evidence findings');
  await page.getByRole('textbox', {name: 'Document body', exact: true}).fill(body);
  await page.getByRole('button', {name: 'Save document', exact: true}).click();
  await expect(page.getByRole('status')).toContainText('Saved revision 1');
  await page.reload(); await page.getByRole('button', {name: /Evidence findings/}).click();
  await expect(page.getByRole('textbox', {name: 'Document body', exact: true})).toHaveValue(body);
  const response = page.waitForResponse(r => r.url().includes('/passage?'));
  await page.getByRole('button', {name: /Inspect citation 1/}).click();
  const url = new URL((await response).url());
  expect(Object.fromEntries(url.searchParams)).toMatchObject({revision: '1', start: '0', end: '27'});
  expect(url.searchParams.get('sha256')).toMatch(/^[a-f0-9]{64}$/);
  await expect(page.getByRole('region', {name: 'Passage inspector'})).toContainText('Exact evidence.');
  await action(page, 'revise');
  await page.getByRole('button', {name: 'Close passage', exact: true}).click();
  await page.getByRole('button', {name: /Inspect citation 1/}).click();
  await expect(page.getByRole('region', {name: 'Passage inspector'})).toContainText('Stale capture');
  await expect(page.getByRole('region', {name: 'Passage inspector'})).toContainText('Exact evidence.');
});
test('preserves a local draft through navigation/remount and CAS conflict without overwriting either version', async ({page}) => {
  await newFindings(page); await page.getByRole('textbox', {name: 'Document body', exact: true}).fill('Initial');
  await page.getByRole('button', {name: 'Save document', exact: true}).click();
  await expect(page.getByRole('status')).toContainText('Saved revision 1');
  await page.getByRole('textbox', {name: 'Document body', exact: true}).fill('My unsaved version');
  await page.getByRole('button', {name: 'Toggle workspace'}).click(); await page.getByRole('button', {name: 'Toggle workspace'}).click();
  await page.getByRole('button', {name: /Untitled findings/}).click();
  await expect(page.getByRole('textbox', {name: 'Document body', exact: true})).toHaveValue('My unsaved version');
  await action(page, 'conflict'); await page.getByRole('button', {name: 'Save document', exact: true}).click();
  await expect(page.getByRole('textbox', {name: 'Document body', exact: true})).toHaveValue('My unsaved version');
  await expect(page.getByRole('region', {name: 'Saved version'})).toContainText('Saved elsewhere');
  await page.getByRole('button', {name: 'Save draft as separate document', exact: true}).click();
  await expect(page.getByRole('textbox', {name: 'Document body', exact: true})).toHaveValue('My unsaved version');
  await expect(page.locator('.research-document > p.research-meta')).toContainText('Saved revision 1');
});

test('save acknowledgement pins its own revision when another writer saves before the follow-up read', async ({page}) => {
  await newFindings(page); await page.getByRole('textbox', {name: 'Document body', exact: true}).fill('My acknowledged revision');
  let changed = false;
  await page.route('**/api/research/documents/**', async route => {
    if (!changed) {changed = true; await action(page, 'conflict');}
    await route.continue();
  });
  await page.getByRole('button', {name: 'Save document', exact: true}).click();
  await expect(page.getByRole('status')).toContainText('Saved revision 1');
  await page.getByRole('textbox', {name: 'Document body', exact: true}).fill('My next draft');
  await page.getByRole('button', {name: 'Save document', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Saved version'})).toContainText('Saved elsewhere');
  await expect(page.getByRole('textbox', {name: 'Document body', exact: true})).toHaveValue('My next draft');
});

test('browser unavailable and bookmark states never fetch or claim to read a URL', async ({page}) => {
  const external: string[] = [];
  page.on('request', request => {if (new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url());});
  await page.getByRole('button', {name: 'Add source', exact: true}).click();
  await page.getByRole('combobox', {name: 'Source type', exact: true}).click();
  await page.getByRole('option', {name: 'Browser capture', exact: true}).click();
  await expect(page.getByRole('dialog')).toContainText('Browser capture is unavailable');
  await expect(page.getByRole('button', {name: 'Capture source', exact: true})).toBeDisabled();
  await page.getByRole('combobox', {name: 'Source type', exact: true}).click();
  await page.getByRole('option', {name: 'URL bookmark', exact: true}).click();
  await page.getByRole('textbox', {name: 'Source title', exact: true}).fill('Unread bookmark');
  await page.getByRole('textbox', {name: 'Source URL', exact: true}).fill('https://example.com/private-source');
  await page.getByRole('button', {name: 'Save bookmark', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Unread bookmark', exact: true})).toBeVisible();
  await expect(page.locator('.research-reading')).toContainText('Page content has not been read');
  await expect(page.getByRole('button', {name: 'Read captured source', exact: true})).toHaveCount(0);
  expect(external).toEqual([]);
});

test('retrying a capture after its acknowledgement read fails does not create a duplicate source', async ({page}) => {
  let failed = false;
  await page.route('**/api/research/sources/*?**', async route => {
    if (!failed) {failed = true; await route.abort('internetdisconnected');} else await route.continue();
  });
  await page.getByRole('button', {name: 'Add source', exact: true}).click();
  await page.getByRole('textbox', {name: 'Source title', exact: true}).fill('One captured source');
  await page.getByRole('textbox', {name: 'Source text', exact: true}).fill('abc');
  await page.getByRole('button', {name: 'Capture source', exact: true}).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.getByRole('button', {name: 'Capture source', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'One captured source', exact: true})).toBeVisible();
  await expect(page.locator('.research-source-row')).toHaveCount(1);
});

test('verified file digest is required and a revoked passage is denied then explicitly retried', async ({page}) => {
  await page.getByRole('button', {name: 'Add source', exact: true}).click();
  await page.getByRole('combobox', {name: 'Source type', exact: true}).click();
  await page.getByRole('option', {name: 'Granted file', exact: true}).click();
  await page.getByRole('textbox', {name: 'Source title', exact: true}).fill('Granted evidence');
  await expect(page.getByRole('button', {name: 'Capture source', exact: true})).toBeDisabled();
  await page.getByRole('button', {name: 'Verify granted file', exact: true}).click();
  await expect(page.getByRole('dialog')).toContainText('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  await page.getByRole('button', {name: 'Capture source', exact: true}).click();
  await page.getByRole('button', {name: 'Read captured source', exact: true}).click();
  await expect(page.getByRole('textbox', {name: 'Captured passage', exact: true})).toHaveValue('abc');
  await page.getByRole('button', {name: 'Cite passage in findings', exact: true}).click();
  await action(page, 'revoke'); await page.getByRole('button', {name: /Inspect citation 1/}).click();
  await expect(page.getByRole('region', {name: 'Passage inspector'})).toContainText('Access revoked or denied');
  await expect(page.getByRole('region', {name: 'Passage inspector'}).locator('blockquote')).toHaveCount(0);
  await action(page, 'restore'); await page.getByRole('button', {name: 'Retry passage', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Passage inspector'}).locator('blockquote')).toHaveText('abc');
  await action(page, 'revoke'); await page.getByRole('button', {name: /Inspect citation 1/}).click();
  await expect(page.getByRole('region', {name: 'Passage inspector'})).toContainText('Access revoked or denied');
  await expect(page.getByRole('region', {name: 'Passage inspector'}).locator('blockquote')).toHaveCount(0);
  expect(await page.locator('.research-workspace').innerText()).not.toMatch(/[A-Z]:\\|gen-research-/);
});

test('loads every metadata page without repeating source essays', async ({page}) => {
  await action(page, 'many'); await page.getByRole('button', {name: 'Refresh research', exact: true}).click();
  await expect(page.locator('.research-source-row')).toHaveCount(40);
  await page.getByRole('button', {name: 'More sources', exact: true}).click();
  await expect(page.locator('.research-source-row')).toHaveCount(45);
  await page.getByRole('button', {name: /Synthetic source 44/}).click();
  await expect(page.getByRole('heading', {name: 'Synthetic source 44', exact: true})).toBeVisible();
  await expect(page.locator('.research-navigator')).not.toContainText('abc');
});

test('source paging preserves every UTF-8 byte at a multibyte page boundary', async ({page}) => {
  await importText(page, 'a'.repeat(63999) + '😀tail');
  await page.getByRole('button', {name: 'Read captured source', exact: true}).click();
  await expect(page.getByRole('textbox', {name: 'Captured passage', exact: true})).toHaveValue('a'.repeat(63999));
  await page.getByRole('button', {name: 'Next passage', exact: true}).click();
  await expect(page.getByRole('textbox', {name: 'Captured passage', exact: true})).toHaveValue('😀tail');
  const captured = page.getByRole('textbox', {name: 'Captured passage', exact: true});
  await captured.focus();
  await captured.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(2, 6));
  await captured.dispatchEvent('keyup', {key: 'ArrowRight'});
  expect(await captured.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 6]);
  await page.getByRole('button', {name: 'Cite passage in findings', exact: true}).click();
  await page.getByRole('button', {name: /Inspect citation 1/}).click();
  await expect(page.getByRole('region', {name: 'Passage inspector'})).toContainText('bytes 64003–64007');
  await expect(page.getByRole('region', {name: 'Passage inspector'}).locator('blockquote')).toHaveText('tail');
});

test('pending refresh retains the document and missing/unverified citation states expose retry', async ({page}) => {
  await importText(page); await page.getByRole('button', {name: 'Read captured source', exact: true}).click();
  await page.getByRole('button', {name: 'Cite passage in findings', exact: true}).click();
  const body = page.getByRole('textbox', {name: 'Document body', exact: true}); await body.fill('Keep during loading');
  let release: (() => void) | undefined;
  const held = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/research?**', async route => {await held; await route.continue();});
  await page.getByRole('button', {name: 'Refresh research', exact: true}).click();
  await expect(page.getByRole('status')).toContainText('Loading research');
  await expect(body).toHaveValue('Keep during loading');
  release!(); await page.unroute('**/api/research?**'); await expect(page.getByRole('status')).toHaveCount(0);
  await page.route('**/api/research/sources/*/passage?**', route => route.fulfill({status: 404, json: {error: {code: 'NOT_FOUND', message: 'Synthetic missing material'}}}));
  await page.getByRole('button', {name: /Inspect citation 1/}).click();
  await expect(page.getByRole('region', {name: 'Passage inspector'})).toContainText('Missing revision');
  await page.unroute('**/api/research/sources/*/passage?**');
  await page.route('**/api/research/sources/*/passage?**', route => route.abort('internetdisconnected'));
  await page.getByRole('button', {name: 'Retry passage', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Passage inspector'})).toContainText('Unverified passage');
  await expect(page.getByRole('region', {name: 'Passage inspector'}).locator('blockquote')).toHaveCount(0);
});

test('shows loading, scoped offline retry, empty state, and protects IME submit and draft epochs', async ({page}) => {
  await expect(page.locator('.research-reading')).toContainText('Select a source');
  await newFindings(page); const body = page.getByRole('textbox', {name: 'Document body', exact: true});
  await body.fill('IME draft');
  await body.dispatchEvent('keydown', {key: 'Enter', ctrlKey: true, isComposing: true});
  await expect(page.locator('.research-document > .research-meta')).toContainText('Unsaved draft');
  await page.getByRole('button', {name: 'Add source', exact: true}).click();
  await page.getByRole('textbox', {name: 'Source title', exact: true}).fill('Keep composition');
  await page.getByRole('dialog').dispatchEvent('keydown', {key: 'Escape', isComposing: true});
  await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: 'Add source', exact: true})).toBeFocused();
  await page.route('**/api/research?**', route => route.abort('internetdisconnected'));
  await page.getByRole('button', {name: 'Refresh research', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('Check the connection');
  await expect(body).toHaveValue('IME draft');
  await page.unroute('**/api/research?**'); await page.getByRole('button', {name: 'Retry research', exact: true}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', {name: 'Next epoch'}).click();
  await expect(page.getByRole('textbox', {name: 'Document body', exact: true})).toHaveCount(0);
});

test('optional parent chat remains bounded, resizable and preserves its draft when hidden', async ({page}) => {
  await page.getByRole('button', {name: 'Show chat', exact: true}).click();
  await page.getByRole('textbox', {name: 'Chat draft', exact: true}).fill('Parent-owned draft');
  const divider = page.getByRole('separator', {name: 'Resize source navigator', exact: true});
  await divider.focus(); await page.keyboard.press('ArrowRight'); await expect(divider).toHaveAttribute('aria-valuenow', '260');
  const size = page.getByRole('slider', {name: 'Chat height', exact: true}); await size.fill('40');
  for (const width of [1120, 390]) {
    await page.setViewportSize({width, height: 620});
    const bounds = await page.evaluate(async () => {await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); return {reading: document.querySelector('.research-reading')!.getBoundingClientRect().toJSON(), chat: document.querySelector('.research-chat')!.getBoundingClientRect().toJSON()};});
    expect(bounds.reading.bottom).toBeLessThanOrEqual(bounds.chat.top + 1);
    expect(bounds.chat.bottom).toBeLessThanOrEqual(620);
  }
  await page.getByRole('button', {name: 'Hide chat', exact: true}).click();
  await page.getByRole('button', {name: 'Show chat', exact: true}).click();
  await expect(page.getByRole('textbox', {name: 'Chat draft', exact: true})).toHaveValue('Parent-owned draft');
});

test('bounded regions remain readable in dark/light, narrow/short, density, and CSS zoom', async ({page}, testInfo) => {
  await importText(page, 'Complete captured source'); await page.getByRole('button', {name: 'Read captured source', exact: true}).click();
  await expect(page.getByRole('textbox', {name: 'Captured passage', exact: true})).toBeVisible();
  const rows = [
    {name: 'desktop-dark', width: 1120, height: 740, theme: 'dark', zoom: 1},
    {name: 'desktop-light', width: 1120, height: 740, theme: 'light', zoom: 1},
    {name: 'narrow-dark', width: 390, height: 680, theme: 'dark', zoom: 1},
    {name: 'short-light', width: 900, height: 420, theme: 'light', zoom: 1},
    {name: 'zoom125', width: 1120, height: 740, theme: 'dark', zoom: 1.25},
    {name: 'zoom150', width: 1120, height: 740, theme: 'light', zoom: 1.5},
    {name: 'touch-short', width: 390, height: 420, theme: 'light', zoom: 1, density: 'touch'},
  ];
  const geometry: unknown[] = [];
  for (const row of rows) {
    await page.setViewportSize({width: row.width, height: row.height});
    await page.evaluate(async row => {document.documentElement.dataset.theme = row.theme; document.documentElement.dataset.density = row.density ?? 'compact'; document.documentElement.style.zoom = String(row.zoom); document.getElementById('root')!.style.height = `${row.height / row.zoom}px`; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));}, row);
    await expect.poll(() => page.locator('#root').evaluate(node => node.getBoundingClientRect().height)).toBeCloseTo(row.height, 0);
    const measured = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>('.research-main')!, toolbar = document.querySelector<HTMLElement>('.research-toolbar')!;
      return {ancestors: ['#root', '#root > div', '#root main', '.research-workspace', '.research-main'].map(selector => {const node = document.querySelector<HTMLElement>(selector)!; return {selector, inline: node.style.cssText, height: node.getBoundingClientRect().height, cssHeight: getComputedStyle(node).height, minHeight: getComputedStyle(node).minHeight};}), bodyWidth: document.body.scrollWidth, viewport: innerWidth, toolbar: parseFloat(getComputedStyle(toolbar).height), inset: getComputedStyle(main).padding,
        reading: document.querySelector('.research-reading')!.getBoundingClientRect().toJSON(), nav: document.querySelector('.research-navigator')!.getBoundingClientRect().toJSON()};
    });
    await page.screenshot({path: testInfo.outputPath(`${row.name}.png`)});
    expect(measured.bodyWidth).toBeLessThanOrEqual(row.width);
    expect(measured.toolbar).toBe(row.density === 'touch' ? 48 : 36); expect(measured.inset).toBe('16px');
    expect(measured.reading.bottom).toBeLessThanOrEqual(row.height + 1);
    expect(measured.reading.height).toBeGreaterThan(80);
    await expect(page.locator('.research-workspace h1')).toHaveCount(0);
    geometry.push({row, measured});
  }
  await testInfo.attach('geometry', {body: JSON.stringify(geometry, null, 2), contentType: 'application/json'});
});

test('a source read completed after blur cannot restore text before access is rechecked', async ({page}) => {
 await importText(page, 'Sensitive captured material');
 await page.evaluate(() => {
  const original = window.fetch.bind(window);
  window.fetch = (...args) => original(...args).finally(() => {
   if (String(args[0]).includes('/passage?')) (window as Window & {researchReadSettled?: boolean}).researchReadSettled = true;
  });
 });
 let release!: () => void;
 const held = new Promise<void>(resolve => {release = resolve;});
 let requested!: () => void;
 const captured = new Promise<void>(resolve => {requested = resolve;});
 await page.route('**/api/research/sources/*/passage?**', async route => {
  const response = await route.fetch(); requested(); await held;
  await route.fulfill({response}).catch(() => {});
 });
 await page.getByRole('button', {name: 'Read captured source', exact: true}).click();
 await captured;
 await page.evaluate(() => window.dispatchEvent(new Event('blur')));
 release();
 await page.waitForFunction(() => (window as Window & {researchReadSettled?: boolean}).researchReadSettled);
 await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
 await expect(page.getByRole('status')).toHaveCount(0);
 await expect(page.getByRole('textbox', {name: 'Captured passage', exact: true})).toHaveCount(0);
 await page.unroute('**/api/research/sources/*/passage?**');
 await page.getByRole('button', {name: 'Read captured source', exact: true}).click();
 await expect(page.getByRole('textbox', {name: 'Captured passage', exact: true})).toHaveValue('Sensitive captured material');
});

test('retrying an uncertain copy save keeps one document and its original local draft', async ({page}) => {
 await newFindings(page);
 await page.getByRole('textbox', {name: 'Document body', exact: true}).fill('Initial');
 await page.getByRole('button', {name: 'Save document', exact: true}).click();
 await expect(page.getByRole('status')).toContainText('Saved revision 1');
 await page.getByRole('textbox', {name: 'Document body', exact: true}).fill('My retained draft');
 await action(page, 'conflict');
 await page.getByRole('button', {name: 'Save document', exact: true}).click();
 await expect(page.getByRole('region', {name: 'Saved version'})).toBeVisible();
 let lostAcknowledgments = 0;
 await page.route('**/api/commands', async route => {
  if (lostAcknowledgments < 2 && route.request().postDataJSON().type === 'research.document.save') {
   lostAcknowledgments++; const response = await route.fetch(); expect(response.ok()).toBe(true);
   await route.abort('internetdisconnected');
  } else await route.continue();
 });
 await page.getByRole('button', {name: 'Save draft as separate document', exact: true}).click();
 await expect(page.getByRole('alert')).toContainText('Check the connection');
 await expect(page.getByRole('textbox', {name: 'Document body', exact: true})).toHaveValue('My retained draft');
 await page.getByRole('button', {name: 'Save draft as separate document', exact: true}).click();
 await expect(page.locator('.research-document > p.research-meta')).toContainText('Saved revision 1');
 await page.getByRole('button', {name: 'Refresh research', exact: true}).click();
 await expect(page.locator('.research-source-row')).toHaveCount(2);
});
