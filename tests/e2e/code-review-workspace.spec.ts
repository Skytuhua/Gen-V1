import {test, expect, type Page} from '@playwright/test';
import {resolve} from 'node:path';
import type {CodeReviewComparison, ComparisonPatch} from '../../packages/contracts/code-review';
const fixture = '/@fs/' + resolve('tests/e2e/code-review-workspace-fixture.tsx').replaceAll('\\', '/');
const local: CodeReviewComparison['identity'] = {kind: 'local', id: 'a'.repeat(64), scope: 'worktree', headOid: '1'.repeat(40), branch: 'topic', revision: 'b'.repeat(64), base: {kind: 'index', revision: 'c'.repeat(64)}, head: {kind: 'worktree', revision: 'b'.repeat(64)}};
const remote: CodeReviewComparison['identity'] = {kind: 'pull-request', id: 'd'.repeat(64), repo: 'owner/repo', number: 48, pullRequestId: 'PR_real', baseOid: '2'.repeat(40), headOid: '3'.repeat(40), mergeBaseOid: '4'.repeat(40), baseRef: 'main', headRef: 'topic', semantics: 'merge-base'};
const staged: CodeReviewComparison['identity'] = {...local, id: '6'.repeat(64), scope: 'staged', base: {kind: 'commit', revision: local.headOid}, head: {kind: 'index', revision: 'c'.repeat(64)}};
const files = [{path: 'src/first.ts', status: 'MM', index: 'M', worktree: 'M', untracked: false, additions: 1, deletions: 1}, {path: 'src/second.ts', oldPath: 'src/old.ts', status: 'renamed', untracked: false, additions: null, deletions: null}];
const comparison = (identity: CodeReviewComparison['identity'] = local): CodeReviewComparison => ({identity, files, filesTruncated: false, checks: identity.kind === 'pull-request' ? [{name: 'Unit tests', status: 'passed'}, {name: 'Integration', status: 'pending'}] : [], observedAt: '2026-11-06T12:00:00Z', access: {mode: identity.kind === 'local' ? 'managed' : 'remote', untrackedIncluded: identity.kind === 'local'}});
const patch = (identity: CodeReviewComparison['identity'] = local, path = 'src/first.ts'): ComparisonPatch => ({identity, file: files.find(file => file.path === path)!, state: 'text', text: '@@ -1 +1 @@\n-old value\n+exact ' + (identity.kind === 'local' ? 'local' : 'remote') + ' ' + path});
async function choose(page: Page, label: string, option: string) {await page.getByRole('combobox', {name: label, exact: true}).click(); await page.getByRole('option', {name: option, exact: true}).click();}
test.beforeEach(async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.route(url => url.pathname === '/review-fixture', route => route.fulfill({contentType: 'text/html', body: `<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>`}));
  await page.route('**/api/bootstrap', route => route.fulfill({json: {csrfToken: 'synthetic'}}));
  await page.route('**/api/projects/**', route => {
    const url = new URL(route.request().url()), identity = url.pathname.includes('pull-request') ? remote : url.searchParams.get('scope') === 'staged' || url.searchParams.get('comparisonId') === staged.id ? staged : local;
    return route.fulfill({json: url.pathname.endsWith('/file') ? patch(identity, url.searchParams.get('path')!) : {state: 'ready', value: comparison(identity)}});
  });
});
test('renders the actual module with file-primary exact local and remote reads', async ({page}) => {
  const urls: string[] = []; page.on('request', request => {if (request.url().includes('/api/projects')) urls.push(request.url());});
  await page.goto('/review-fixture');
  await expect(page.getByRole('region', {name: 'Selected file diff'})).toContainText('exact local src/first.ts');
  await page.getByRole('button', {name: /src\/second.ts/}).click();
  await expect(page.getByRole('region', {name: 'Selected file diff'})).toContainText('exact local src/second.ts');
  await choose(page, 'Comparison', '#48 Exact remote PR');
  await expect(page.getByRole('region', {name: 'Selected file diff'})).toContainText('exact remote src/first.ts');
  await expect(page.getByRole('region', {name: 'Checks'})).toContainText('Unit tests');
  expect(urls.some(url => url.includes('/pull-request-comparison/file?') && url.includes('comparisonId=' + remote.id))).toBe(true);
  await expect(page.getByRole('heading', {name: 'Code Review', exact: true})).toHaveCount(0);
});
test('preserves exact review text across files, projects, PRs and reload', async ({page}) => {
  await page.goto('/review-fixture'); const draft = page.getByRole('textbox', {name: 'Review draft', exact: true});
  await draft.fill('  exact\nlocal draft\n'); await page.getByRole('button', {name: /src\/second.ts/}).click(); await expect(draft).toHaveValue('  exact\nlocal draft\n');
  await choose(page, 'Comparison', '#48 Exact remote PR'); await draft.fill('Remote draft');
  await choose(page, 'Project and working copy', 'Project Two / Copy Two'); await expect(draft).toHaveValue(''); await draft.fill('Other project');
  await choose(page, 'Project and working copy', 'Project One / Copy One'); await choose(page, 'Comparison', '#48 Exact remote PR'); await expect(draft).toHaveValue('Remote draft');
  await choose(page, 'Comparison', 'Working copy'); await expect(draft).toHaveValue('  exact\nlocal draft\n');
  await page.reload(); await expect(draft).toHaveValue('  exact\nlocal draft\n');
});
test('uses canonical stage callback with action revision, never the read revision', async ({page}) => {
  await page.goto('/review-fixture'); await expect(page.getByRole('button', {name: 'Stage file', exact: true})).toBeEnabled(); await page.getByRole('button', {name: 'Stage file', exact: true}).click();
  const result = JSON.parse(await page.getByLabel('Canonical callback').textContent() ?? 'null');
  expect(result[1]).toEqual({paths: ['src/first.ts'], revision: 'e'.repeat(64), expectedHead: '1'.repeat(40)});
  expect(result[2]).toEqual({operation: 'stage'});
  expect(result[0].comparison.revision).toBe('b'.repeat(64));
});
test('blocks a draft when local action identity or remote base changes without losing its text', async ({page}) => {
  await page.goto('/review-fixture'); await choose(page, 'Comparison', '#48 Exact remote PR');
  const draft = page.getByRole('textbox', {name: 'Review draft', exact: true}); await draft.fill('Keep remote draft');
  await page.getByRole('button', {name: 'Change action revision', includeHidden: true}).evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole('button', {name: 'Submit review', exact: true})).toBeDisabled(); await expect(draft).toHaveValue('Keep remote draft');
  await page.getByRole('button', {name: 'Use current comparison', exact: true}).click();
  await page.route('**/pull-requests/48/comparison?*', route => route.fulfill({json: {state: 'ready', value: comparison({...remote, baseOid: '5'.repeat(40)})}}));
  await page.getByRole('button', {name: 'Refresh comparison', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Submit review', exact: true})).toBeDisabled(); await expect(draft).toHaveValue('Keep remote draft');
});
test('preserves uncertain review outcomes across navigation and reload and forbids blind retry', async ({page}) => {
  await page.goto('/review-fixture?uncertain'); await choose(page, 'Comparison', '#48 Exact remote PR');
  await page.getByRole('textbox', {name: 'Review draft', exact: true}).fill('Keep uncertain draft'); await page.getByRole('button', {name: 'Submit review', exact: true}).click();
  await expect(page.getByText('Outcome uncertain. Inspect the canonical action before trying again.', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Submit review', exact: true})).toBeDisabled();
  await choose(page, 'Comparison', 'Working copy'); await choose(page, 'Comparison', '#48 Exact remote PR');
  await expect(page.getByRole('textbox', {name: 'Review draft', exact: true})).toHaveValue('Keep uncertain draft');
  await page.reload(); await choose(page, 'Comparison', '#48 Exact remote PR'); await expect(page.getByRole('button', {name: 'Submit review', exact: true})).toBeDisabled();
});

test('only a canonical not-applied resolution allows explicitly rebinding an uncertain draft', async ({page}) => {
  await page.goto('/review-fixture?uncertain&inspect'); await choose(page, 'Comparison', '#48 Exact remote PR'); await page.getByRole('textbox', {name: 'Review draft', exact: true}).fill('Retain resolved draft');
  await page.getByRole('button', {name: 'Submit review', exact: true}).click(); await page.getByRole('button', {name: 'Inspect action outcome', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Use current comparison', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Submit review', exact: true})).toBeDisabled();
  await page.getByRole('button', {name: 'Use current comparison', exact: true}).click(); await expect(page.getByRole('button', {name: 'Submit review', exact: true})).toBeEnabled();
  await expect(page.getByRole('textbox', {name: 'Review draft', exact: true})).toHaveValue('Retain resolved draft');
});
test('renders loading, empty, error and revoked access without stale patch content', async ({page}) => {
  await page.route('**/git/comparison?*', route => route.fulfill({json: {state: 'loading'}})); await page.goto('/review-fixture'); await expect(page.getByRole('status').filter({hasText: 'Loading comparison'})).toBeVisible();
  await page.route('**/git/comparison?*', route => route.fulfill({json: {state: 'empty', value: {...comparison(), files: []}}})); await page.getByRole('button', {name: 'Refresh comparison', exact: true}).click(); await expect(page.getByText('No changes in this comparison.', {exact: true})).toBeVisible();
  await page.route('**/git/comparison?*', route => route.fulfill({json: {state: 'ready', value: comparison()}})); await page.getByRole('button', {name: 'Refresh comparison', exact: true}).click(); await expect(page.getByRole('region', {name: 'Selected file diff'})).toContainText('exact local');
  await page.route('**/git/comparison?*', route => route.fulfill({json: {state: 'error', error: {code: 'CAPABILITY_DENIED', message: 'private/path must never echo'}}})); await page.getByRole('button', {name: 'Refresh comparison', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('Access unavailable or revoked'); await expect(page.getByText('exact local', {exact: false})).toHaveCount(0); await expect(page.getByText('private/path', {exact: false})).toHaveCount(0);
});
for (const state of ['binary', 'truncated', 'unavailable', 'untracked', 'empty'] as const) test(`shows honest ${state} patch state`, async ({page}) => {
  await page.route('**/git/comparison/file?*', route => route.fulfill({json: {...patch(), state, text: null, ...(state === 'unavailable' ? {reason: 'patch-omitted'} : {})}}));
  await page.goto('/review-fixture'); await expect(page.getByRole('region', {name: 'Selected file diff'})).toContainText({binary: 'Binary file', truncated: 'Patch exceeds the display limit', unavailable: 'Patch unavailable', untracked: 'Untracked file', empty: 'No textual changes'}[state]);
});

test('a late canonical review result preserves newer text after the target is reopened', async ({page}) => {
  await page.goto('/review-fixture?delayed'); await choose(page, 'Comparison', '#48 Exact remote PR');
  const draft = page.getByRole('textbox', {name: 'Review draft', exact: true});
  await draft.fill('Sent text'); await page.getByRole('button', {name: 'Submit review', exact: true}).click();
  await expect(page.getByLabel('Canonical callback')).toHaveText(/Sent text/);
  await choose(page, 'Comparison', 'Working copy'); await choose(page, 'Comparison', '#48 Exact remote PR');
  await draft.fill('New exact text after reopening');
  await page.evaluate(() => window.dispatchEvent(new Event('resolve-review')));
  await expect(page.getByText('Review submitted.', {exact: true})).toBeVisible();
  await expect(draft).toHaveValue('New exact text after reopening');
});

test('retains the commit message across comparison and project navigation', async ({page}) => {
  await page.goto('/review-fixture'); const input = page.getByRole('textbox', {name: 'Commit message'}); await input.fill('  Exact commit\nmessage');
  await choose(page, 'Comparison', 'Staged changes'); await choose(page, 'Comparison', 'Working copy'); await expect(input).toHaveValue('  Exact commit\nmessage');
  await choose(page, 'Project and working copy', 'Project Two / Copy Two'); await expect(input).toHaveValue('');
  await choose(page, 'Project and working copy', 'Project One / Copy One'); await expect(input).toHaveValue('  Exact commit\nmessage');
});

test('revalidates the remote base before invoking any canonical review callback', async ({page}) => {
  await page.goto('/review-fixture'); await choose(page, 'Comparison', '#48 Exact remote PR');
  await page.getByRole('textbox', {name: 'Review draft', exact: true}).fill('Do not submit against a moved base');
  await page.route('**/pull-requests/48/comparison?*', route => route.fulfill({json: {state: 'ready', value: comparison({...remote, baseOid: '9'.repeat(40)})}}));
  await page.getByRole('button', {name: 'Submit review', exact: true}).click();
  await expect(page.getByRole('status').filter({hasText: 'Comparison or permission changed'})).toBeVisible();
  await expect(page.getByLabel('Canonical callback')).toHaveText('');
});

test('revoking review permission during preflight prevents the canonical write', async ({page}) => {
  await page.goto('/review-fixture'); await choose(page, 'Comparison', '#48 Exact remote PR'); await page.getByRole('textbox', {name: 'Review draft', exact: true}).fill('Permission can change');
  let release: (() => Promise<void>) | undefined;
  await page.route('**/pull-requests/48/comparison?*', route => {release = () => route.fulfill({json: {state: 'ready', value: comparison(remote)}});});
  await page.getByRole('button', {name: 'Submit review', exact: true}).click(); await expect.poll(() => !!release).toBe(true);
  await page.getByRole('button', {name: 'Revoke review', includeHidden: true}).evaluate((button: HTMLButtonElement) => button.click()); await release!();
  await expect(page.getByRole('status').filter({hasText: 'Comparison or permission changed'})).toBeVisible();
  await expect(page.getByLabel('Canonical callback')).toHaveText('');
});

test('a mismatched callback owner cannot link a PR for another working copy', async ({page}) => {
  await page.goto('/review-fixture?wrong-owner'); await expect(page.getByRole('button', {name: 'Stage file'})).toBeDisabled();
  await page.getByRole('button', {name: 'Pull request', exact: true}).click(); await expect(page.getByRole('menuitem', {name: 'Link existing PR', exact: true})).toBeDisabled();
});

test('staged navigation invokes unstage and commit with the exact action payload', async ({page}) => {
  await page.goto('/review-fixture'); await choose(page, 'Comparison', 'Staged changes'); await page.getByRole('button', {name: 'Unstage file', exact: true}).click();
  await expect(page.getByLabel('Canonical callback')).toContainText('expectedHead');
  const unstage = JSON.parse(await page.getByLabel('Canonical callback').textContent() ?? 'null'); expect(unstage[2]).toEqual({operation: 'unstage'}); expect(unstage[0].comparison.scope).toBe('staged'); expect(unstage[1]).toEqual({paths: ['src/first.ts'], revision: 'e'.repeat(64), expectedHead: '1'.repeat(40)});
  await page.getByRole('textbox', {name: 'Commit message'}).fill('  Exact staged commit\n'); await page.getByRole('button', {name: 'Commit staged changes', exact: true}).click();
  await expect(page.getByLabel('Canonical callback')).toContainText('Exact staged commit');
  const commit = JSON.parse(await page.getByLabel('Canonical callback').textContent() ?? 'null'); expect(commit[2]).toEqual({operation: 'commit'}); expect(commit[1]).toEqual({message: '  Exact staged commit\n', revision: 'e'.repeat(64), expectedHead: '1'.repeat(40)});
});

for (const event of ['Comment', 'Approve', 'Request changes']) test(`submits supported whole-PR ${event} via the parent with exact text and identities`, async ({page}) => {
  await page.goto('/review-fixture'); await choose(page, 'Comparison', '#48 Exact remote PR'); await page.getByRole('textbox', {name: 'Review draft', exact: true}).fill('  Exact whole PR review\n');
  await choose(page, 'Review decision', event); await page.getByRole('button', {name: 'Submit review', exact: true}).click();
  await expect(page.getByLabel('Canonical callback')).toContainText('Exact whole PR review'); const result = JSON.parse(await page.getByLabel('Canonical callback').textContent() ?? 'null');
  expect(result[1]).toEqual({number: 48, event: {'Comment': 'COMMENT', 'Approve': 'APPROVE', 'Request changes': 'REQUEST_CHANGES'}[event], body: '  Exact whole PR review\n', head: '3'.repeat(40), revision: 'e'.repeat(64)});
  expect(result[0].comparison).toEqual(remote);
  expect(result[2]).toEqual({operation: 'review-pr'});
});

test('large file lists and very long source lines scroll inside their owners', async ({page}) => {
  const many = {...comparison(), filesTruncated: true, files: Array.from({length: 300}, (_, index) => ({...files[0], path: `src/${index}-` + 'long-segment/'.repeat(5) + 'source.ts'}))};
  await page.route('**/git/comparison?*', route => route.fulfill({json: {state: 'ready', value: many}}));
  await page.route('**/git/comparison/file?*', route => route.fulfill({json: {...patch(), file: many.files[0], text: '+' + 'source line '.repeat(500)}}));
  await page.setViewportSize({width: 800, height: 450}); await page.goto('/review-fixture');
  await expect(page.getByText('File list is incomplete.', {exact: false})).toBeVisible(); await expect(page.getByRole('navigation', {name: 'Changed files'}).getByRole('button').last()).toBeAttached();
  const pre = page.getByLabel('Unified diff', {exact: true}); await expect(pre).toBeVisible(); expect(await pre.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('rejects a patch with a different exact identity and treats patch text as inert content', async ({page}) => {
  await page.route('**/git/comparison/file?*', route => route.fulfill({json: {...patch(), text: '<script>window.repositoryCodeRan=true</script>'}})); await page.goto('/review-fixture');
  await expect(page.getByRole('region', {name: 'Selected file diff'})).toContainText('<script>window.repositoryCodeRan=true</script>');
  expect(await page.evaluate(() => Object.hasOwn(window, 'repositoryCodeRan'))).toBe(false);
  await page.route('**/git/comparison/file?*', route => route.fulfill({json: patch({...local, revision: 'wrong'})}));
  await page.reload(); await expect(page.getByRole('alert')).toContainText('Comparison changed or expired');
  await expect(page.getByRole('button', {name: 'Stage file'})).toHaveCount(0);
});

test('keyboard navigation preserves selected content until activation and shared popups clear caption chrome', async ({page}) => {
  await page.setViewportSize({width: 720, height: 500}); await page.goto('/review-fixture');
  const first = page.getByRole('button', {name: /src\/first.ts/}), second = page.getByRole('button', {name: /src\/second.ts/});
  await first.focus(); await page.keyboard.press('ArrowDown'); await expect(second).toBeFocused(); await expect(first).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Enter'); await expect(second).toHaveAttribute('aria-current', 'page');
  await page.setViewportSize({width: 520, height: 360}); const selector = page.getByRole('combobox', {name: 'Comparison', exact: true}); await selector.focus(); await page.keyboard.press('ArrowDown');
  const popup = page.getByRole('listbox', {name: 'Comparison', exact: true}); await expect(popup).toBeVisible();
  const rect = await popup.boundingBox(); expect(rect!.y).toBeGreaterThanOrEqual(42); expect(rect!.x).toBeGreaterThanOrEqual(8); expect(rect!.x + rect!.width).toBeLessThanOrEqual(512); expect(rect!.y + rect!.height).toBeLessThanOrEqual(352);
  await page.keyboard.press('Escape'); await expect(selector).toBeFocused();
});

test('the diff remains in the first narrow short viewport and files use the shared selector', async ({page}) => {
  await page.setViewportSize({width: 390, height: 300}); await page.goto('/review-fixture');
  const diff = page.getByLabel('Unified diff', {exact: true}); await expect(diff).toBeVisible(); const box = await diff.boundingBox(); expect(box!.y).toBeLessThan(280);
  await choose(page, 'Changed file', 'src/second.ts'); await expect(page.getByRole('region', {name: 'Selected file diff'})).toContainText('exact local src/second.ts');
});

for (const theme of ['dark', 'light']) test(`first-render ${theme} geometry, overflow and supplied slots remain readable`, async ({page}, info) => {
  await page.setViewportSize({width: 1200, height: 800}); await page.goto('/review-fixture?theme=' + theme);
  await expect(page.getByRole('region', {name: 'Selected file diff'})).toContainText('exact local');
  const geometry = await page.locator('.cr-toolbar').evaluate(element => ({height: element.getBoundingClientRect().height, top: element.getBoundingClientRect().top, padding: getComputedStyle(element).paddingInlineStart}));
  expect(geometry).toEqual({height: 36, top: 42, padding: '16px'});
  await page.screenshot({path: info.outputPath(`${theme}-desktop.png`)});
  await page.getByRole('button', {name: 'Agent chat', exact: true}).click(); await page.getByRole('textbox', {name: 'Agent message'}).fill('Keep provided chat node');
  await page.getByRole('button', {name: 'Agent chat', exact: true}).click(); await page.getByRole('button', {name: 'Agent chat', exact: true}).click(); await expect(page.getByRole('textbox', {name: 'Agent message'})).toHaveValue('Keep provided chat node');
  await page.getByRole('button', {name: 'Terminal', exact: true}).click(); await expect(page.getByRole('region', {name: 'Terminal', exact: true})).toContainText('Supplied terminal output');
  await page.setViewportSize({width: 390, height: 300});
  await expect(page.getByRole('textbox', {name: 'Review draft', exact: true})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: info.outputPath(`${theme}-narrow-short.png`)});
});


test('local uncertain recovery inspects the exact persisted operation after action revision changes',async({page})=>{
  await page.goto('/review-fixture?uncertain&inspect');await expect(page.getByRole('button',{name:'Stage file',exact:true})).toBeEnabled();
  await page.getByRole('textbox',{name:'Review draft',exact:true}).fill('Keep unrelated review draft');
  await page.getByRole('button',{name:'Change action revision',includeHidden:true}).evaluate((button:HTMLButtonElement)=>button.click());
  await page.getByRole('button',{name:'Stage file',exact:true}).click();await expect(page.getByText('Outcome uncertain. Inspect the canonical action before trying again.',{exact:true})).toBeVisible();
  const sent=JSON.parse(await page.getByLabel('Canonical callback').textContent()??'null');expect(sent[0].action.revision).toBe('f'.repeat(64));
  await page.reload();await page.getByRole('button',{name:'Inspect action outcome',exact:true}).click();
  const inspected=JSON.parse(await page.getByLabel('Canonical inspection').textContent()??'null');expect(inspected.action.revision).toBe('f'.repeat(64));expect(inspected.comparison).toEqual(sent[0].comparison);
  expect(inspected.operationId).toBeTruthy();expect(inspected.operationId).toBe(sent[0].operationId);expect(inspected.operation).toBe('stage');expect(inspected.payload.paths).toEqual(['src/first.ts']);
  await expect(page.getByRole('textbox',{name:'Review draft',exact:true})).toHaveValue('Keep unrelated review draft');
});

test('revoked action can be canonically inspected after reload before explicit rebind',async({page})=>{
  await page.goto('/review-fixture?revoked&inspect');const stage=page.getByRole('button',{name:'Stage file',exact:true});await expect(stage).toBeEnabled();
  await page.getByRole('textbox',{name:'Review draft',exact:true}).fill('Keep revoked draft');await stage.click();await expect(page.getByText('Action access revoked. Your draft is preserved.',{exact:true})).toBeVisible();
  await page.reload();await expect(stage).toBeDisabled();await expect(page.getByRole('button',{name:'Use current comparison',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Inspect action outcome',exact:true}).click();await expect(page.getByRole('button',{name:'Use current comparison',exact:true})).toBeVisible();await expect(stage).toBeDisabled();
  await page.getByRole('button',{name:'Use current comparison',exact:true}).click();await expect(stage).toBeEnabled();await expect(page.getByRole('textbox',{name:'Review draft',exact:true})).toHaveValue('Keep revoked draft');
});


test('an obsolete preflight cannot replace another persisted operation outcome',async({page})=>{
  await page.goto('/review-fixture');await expect(page.getByRole('button',{name:'Stage file',exact:true})).toBeEnabled();
  let release:(()=>Promise<void>)|undefined;await page.route('**/git/comparison?*',route=>{release=()=>route.fulfill({json:{state:'ready',value:comparison({...local,revision:'changed'})}});});
  await page.getByRole('button',{name:'Stage file',exact:true}).click();await expect.poll(()=>!!release).toBe(true);
  const operationId=await page.evaluate(async({local,modules})=>{
    const journal=await import(modules.journal),model=await import(modules.model);
    const selection={owner:{authority:{kind:'local' as const},projectId:'project-one',threadId:'copy-one'},target:{kind:'local' as const,scope:'worktree' as const}};
    const key='code-review:v1:'+model.selectionKey(selection),draft=await journal.journalRead(key),operationId=crypto.randomUUID(),action={head:local.headOid,revision:'e'.repeat(64),branch:'topic'};
    await journal.journalWrite(key,{...draft,outcome:'uncertain',operation:{operationId,operation:'stage',selection,comparison:local,action,payload:{paths:['src/second.ts'],revision:action.revision,expectedHead:action.head}}});return operationId;
  },{local,modules:{journal:'/@fs/'+resolve('apps/web/src/journal.ts').replaceAll('\\','/'),model:'/@fs/'+resolve('apps/web/src/code-review-workspace/model.ts').replaceAll('\\','/')}});
  await release!();await expect(page.getByRole('status').filter({hasText:/Comparison.*before acting/})).toBeVisible();
  await expect(page.getByText('Outcome uncertain. Inspect the canonical action before trying again.',{exact:true})).toBeVisible();
  const saved=await page.evaluate(async modules=>{const journal=await import(modules.journal),model=await import(modules.model);return journal.journalRead('code-review:v1:'+model.selectionKey({owner:{authority:{kind:'local'},projectId:'project-one',threadId:'copy-one'},target:{kind:'local',scope:'worktree'}}));},{journal:'/@fs/'+resolve('apps/web/src/journal.ts').replaceAll('\\','/'),model:'/@fs/'+resolve('apps/web/src/code-review-workspace/model.ts').replaceAll('\\','/')});
  expect(saved.operation.operationId).toBe(operationId);expect(saved.outcome).toBe('uncertain');await expect(page.getByLabel('Canonical callback')).toHaveText('');
});
