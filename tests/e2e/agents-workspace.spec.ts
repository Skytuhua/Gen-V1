import {test, expect, type Page} from '@playwright/test';
import {resolve} from 'node:path';
import type {AgentSummary} from '../../packages/contracts/agent-inventory';
const fixture = '/@fs/' + resolve('tests/e2e/agents-workspace-fixture.tsx').replaceAll('\\', '/');
const agent = (id: string, patch: Partial<AgentSummary> = {}): AgentSummary => ({agentId: id, parentId: null, rootId: id, jobId: null, threadId: id, projectId: 'a', projectName: 'Alpha', title: id, status: 'working', modelId: 'test/model', currentAction: 'Reading project sources', reportedPercent: 35, createdAt: '2026-11-06', updatedAt: '2026-11-06', orderKey: id, revision: 1, archived: false, readOnly: false, metadata: 'thread', ...patch});
async function setup(page: Page, candidate = false) {
 const requests: string[] = [], commands: {id: string; type: string; threadId: string; payload: {content?: string}}[] = [];
 const agents = [agent('parent-00'), agent('child-active', {parentId: 'parent-00', rootId: 'parent-00', jobId: 'job', readOnly: true}), agent('child-done', {parentId: 'parent-00', rootId: 'parent-00', status: 'completed', readOnly: true}), ...Array.from({length: 32}, (_, i) => agent('parent-' + String(i + 1).padStart(2, '0'))), agent('beta-parent', {projectId: 'b', projectName: 'Beta'})];
 let failSend = false, output = 'Current transcript output', sequence = 10, ticketStatus = 'processing';
 const target = {authority: 'personal', parentThreadId: 'parent-00', jobId: 'job', parentRun: {runId: 'parent-run', epoch: 1}, childRun: {threadId: 'child-active', runId: 'child-run', epoch: 1}};
 await page.route('**/api/**', async route => {
  const url = new URL(route.request().url()); requests.push(url.pathname + url.search);
  if (url.pathname === '/api/bootstrap') return route.fulfill({json: {csrfToken: 'synthetic'}});
  if (url.pathname === '/api/shell-settings') return route.fulfill({json: {theme: 'dark', preferences: {}}});
  if (url.pathname === '/api/workspace') return route.fulfill({json: {state: {version: 1, revision: 1, activeCanvasId: 'agents', canvases: [{id: 'agents', preset: 'all-agents'}]}, projects: []}});
  if (url.pathname === '/api/agents/follow-up-target') return route.fulfill({json: target});
  if (url.pathname.startsWith('/api/agents/inputs/')) return route.fulfill({json: {...target, id: url.pathname.split('/').at(-1), messageId: 'child-input', status: ticketStatus, createdAt: '2026-11-06', updatedAt: '2026-11-06'}});
  if (url.pathname === '/api/commands') {
   commands.push(route.request().postDataJSON());
   if (failSend) return route.fulfill({status: 503, json: {error: {code: 'TEMPORARY', message: 'Send interrupted. Retry.'}}});
   return route.fulfill({json: {id: commands.at(-1)!.id, status: 'accepted', result: commands.at(-1)!.type === 'agent.followUp' ? {ticketId: commands.at(-1)!.id, status: 'queued'} : null}});
  }
  if (url.pathname === '/api/agents') {
   const text = url.searchParams.get('text'), project = url.searchParams.get('projectId');
   const items = agents.filter(a => (!text || a.title.includes(text)) && (project === null || a.projectId === project));
   const start = Number(url.searchParams.get('cursor') || 0), slice = items.slice(start, start + 15);
   return route.fulfill({json: {authority: 'personal', scopeKey: 'scope', sequence, items: slice, ancestors: text?.includes('child') ? [{...agents[0], status: 'completed'}] : [], nextCursor: start + 15 < items.length ? String(start + 15) : null}});
  }
  if (url.pathname === '/api/agents/history') {
   const id = url.searchParams.get('agentId')!, earlier = url.searchParams.has('cursor');
   return route.fulfill({json: {authority: 'personal', agentId: id, threadId: id, sequence, nextCursor: earlier ? null : 'older', messages: Array.from({length: earlier ? 3 : 12}, (_, i) => ({id: (earlier ? 'old-' : 'm-') + i, threadId: id, role: 'assistant', createdAt: `2026-11-${earlier ? '05' : '06'}T00:00:${String(i).padStart(2, '0')}Z`, runId: 'r', content: `${id}: ${output} ${i}.\n` + 'Source details remain readable. '.repeat(8), contentOffset: 0, contentLength: (`${id}: ${output} ${i}.\n` + 'Source details remain readable. '.repeat(8)).length, nextContentCursor: null}))}});
  }
  if (url.pathname === '/api/agents/updates') return route.fulfill({json: {authority: 'personal', scopeKey: 'scope', fromSequence: Number(url.searchParams.get('after')), sequence, resync: false, upserts: [], removed: [], ancestors: [], transcripts: Number(url.searchParams.get('after')) < sequence ? [{agentId: 'parent-00', sequence}] : []}});
  if (url.pathname === '/api/agents/events') return route.fulfill({contentType: 'text/event-stream', body: ': synthetic connected\n\n'});
  return route.fulfill({status: 500, json: {error: {code: 'UNEXPECTED', message: url.pathname}}});
 });
 await page.route('**/agents-workspace-check*', route => route.fulfill({contentType: 'text/html', body: `<html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>`}));
 await page.goto('/agents-workspace-check' + (candidate ? '?candidate=1' : ''));
 return {requests, commands, fail: (value: boolean) => {failSend = value;}, output: (value: string) => {output = value; sequence++;}, ticket: (value: string) => {ticketStatus = value;}};
}

test('project rows expose working parent and nested child transcripts before any details click', async ({page}) => {
 const h = await setup(page); const parent = page.getByRole('group', {name: 'Agent parent-00', exact: true});
 await expect(parent.getByRole('log', {name: 'parent-00 messages', exact: true})).toContainText('Current transcript output');
 await expect(parent.getByRole('group', {name: 'Agent child-active', exact: true})).toBeVisible();
 await expect(parent.getByRole('group', {name: 'Agent child-done', exact: true}).getByRole('textbox')).toHaveCount(0);
 await expect(page.getByRole('heading', {name: 'All Agents', exact: true})).toHaveCount(0);
 expect(h.requests.some(path => path.includes('/api/snapshot') || path.startsWith('/api/events'))).toBe(false);
 await expect(page.getByRole('region', {name: 'Project Beta', exact: true})).toHaveCount(1);
 expect(h.requests.filter(path => path.startsWith('/api/agents?')).length).toBe(3);
});
test('all horizontal parents are reachable, subscriptions follow visibility, and drafts survive virtualization', async ({page}) => {
 const h = await setup(page), input = page.getByRole('textbox', {name: 'Message to parent-00', exact: true});
 await input.fill('Keep my draft');
 await page.getByRole('button', {name: 'Search agents', exact: true}).focus();
 const row = page.getByRole('region', {name: 'Alpha agents', exact: true});
 await row.evaluate(node => {node.scrollLeft = node.scrollWidth;});
 await expect(page.getByRole('log', {name: 'parent-32 messages', exact: true})).toContainText('Current transcript output');
 await expect(input).toHaveCount(0);
 expect(h.requests.some(path => path.includes('agentId=parent-32'))).toBe(true);
 for (const path of h.requests.filter(path => path.includes('visible='))) expect(new URL(path, 'http://fixture').searchParams.get('visible')!.split(',').length).toBeLessThanOrEqual(24);
 await row.evaluate(node => {node.scrollLeft = 0;}); await expect(input).toHaveValue('Keep my draft');
 await page.getByRole('button', {name: 'Open conversation parent-00', exact: true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-opened-thread', 'parent-00');
});
test('IME does not send, working parents send, uncertain retries keep identity and later drafts', async ({page}) => {
 const h = await setup(page), input = page.getByRole('textbox', {name: 'Message to parent-00', exact: true});
 await input.fill('First'); await input.dispatchEvent('keydown', {key: 'Enter', isComposing: true}); expect(h.commands).toHaveLength(0);
 h.fail(true); await input.press('Enter'); await expect(page.getByRole('button', {name: 'Retry send to parent-00', exact: true})).toBeVisible();
 await input.fill('Later'); h.fail(false); await page.getByRole('button', {name: 'Retry send to parent-00', exact: true}).click();
 await expect(input).toHaveValue('Later'); expect(h.commands).toHaveLength(2); expect(h.commands[0].id).toBe(h.commands[1].id); expect(h.commands[1].payload.content).toBe('First');
 expect(h.commands.every(command => command.threadId === 'parent-00')).toBe(true);
});
test('filtered children retain their completed owning parent and local reading state', async ({page}) => {
 const h = await setup(page); const log = page.getByRole('log', {name: 'parent-00 messages', exact: true});
 await expect(log).toContainText('Current transcript output');
 await log.evaluate(node => {node.scrollTop = 100;});
 await page.getByRole('button', {name: 'Search agents', exact: true}).click();
 await page.getByRole('searchbox', {name: 'Filter agents', exact: true}).fill('child-active');
 await expect.poll(() => h.requests.some(path => path.includes('text=child-active'))).toBe(true);
 await expect(page.getByRole('group', {name: 'Agent parent-00', exact: true})).toBeVisible();
 await expect(page.getByRole('group', {name: 'Agent parent-00', exact: true}).locator('.agents-agent-state').first()).toHaveText('completed');
 await page.getByRole('searchbox', {name: 'Filter agents', exact: true}).fill('');
 await expect(log).toBeVisible(); expect(await log.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
});
test('the actual App candidate opens and restores compact routing without mounting snapshot bootstrap', async ({page}) => {
 const h = await setup(page, true);
 await expect.poll(() => h.requests.some(path => path.startsWith('/api/agents?'))).toBe(true);
 expect(h.requests.some(path => path.startsWith('/api/snapshot') || path.startsWith('/api/events'))).toBe(false);
 await expect(page.getByRole('log', {name: 'parent-00 messages', exact: true})).toContainText('Current transcript output');
 await page.reload(); await expect(page.getByRole('log', {name: 'parent-00 messages', exact: true})).toContainText('Current transcript output');
 expect(h.requests.some(path => path.startsWith('/api/snapshot') || path.startsWith('/api/events'))).toBe(false);
});
test('child follow-up uses the published parent/run target and current ticket through handled', async ({page}) => {
 const h = await setup(page), child = page.getByRole('group', {name: 'Agent child-active', exact: true});
 await child.scrollIntoViewIfNeeded(); const input = child.getByRole('textbox', {name: 'Message to child-active', exact: true});
 await input.fill('Read the next source'); await expect(child.getByRole('button', {name: 'Send to child-active', exact: true})).toBeEnabled(); await input.press('Enter');
 await expect(child.getByRole('status')).toHaveText('processing'); expect(h.commands).toHaveLength(1);
 expect(h.commands[0]).toMatchObject({type: 'agent.followUp', threadId: 'parent-00', payload: {jobId: 'job', parentRun: {runId: 'parent-run', epoch: 1}, childRun: {threadId: 'child-active', runId: 'child-run', epoch: 1}, content: 'Read the next source'}});
 expect(Object.keys(h.commands[0].payload).sort()).toEqual(['childRun', 'content', 'jobId', 'parentRun']);
 h.ticket('handled'); await expect(child.getByRole('status')).toHaveText('handled'); expect(h.commands).toHaveLength(1);
});
test('output while reading earlier retains position and exposes an explicit new-output action', async ({page}) => {
 const h = await setup(page), parent = page.getByRole('group', {name: 'Agent parent-00', exact: true}), log = parent.getByRole('log', {name: 'parent-00 messages', exact: true});
 await expect(log).toContainText('Current transcript output'); await log.evaluate(node => {node.scrollTop = 100;});
 const before = await log.evaluate(node => node.scrollTop); h.output('Updated current transcript output');
 await expect(parent.getByRole('button', {name: 'New output', exact: true})).toBeVisible(); expect(Math.abs(await log.evaluate(node => node.scrollTop) - before)).toBeLessThan(3);
 await parent.getByRole('button', {name: 'New output', exact: true}).click(); expect(await log.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(24);
 await log.evaluate(node => {node.scrollTop = 0;}); await log.getByRole('button', {name: 'Load earlier messages', exact: true}).click();
 await expect(log.locator('.agents-message').first()).toContainText('Updated current transcript output');
 expect(await log.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
});
for (const [theme, width, height, zoom] of [['dark', 1440, 900, 1], ['light', 1024, 768, 1.25], ['dark', 640, 520, 1.5], ['light', 390, 700, 1]] as const) {
 test(`readable geometry ${theme} ${width}x${height} at ${zoom}`, async ({page}, info) => {
  await page.setViewportSize({width, height}); await page.emulateMedia({reducedMotion: 'reduce'}); await setup(page);
  await page.evaluate(({theme, zoom}) => {document.documentElement.dataset.theme = theme; document.documentElement.style.zoom = String(zoom);}, {theme, zoom});
  const input = page.getByRole('textbox', {name: 'Message to parent-00', exact: true}); await expect(input).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await page.locator('.agents-toolbar').evaluate(node => node.getBoundingClientRect().height / Number(document.documentElement.style.zoom || 1))).toBe(36);
  const targets = await page.locator('.agents-workspace button:visible').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height / Number(document.documentElement.style.zoom || 1)));
  expect(targets.every(size => size >= 32)).toBe(true);
  await page.screenshot({path: info.outputPath(`agents-${theme}-${width}-${zoom}.png`)});
 });
}
