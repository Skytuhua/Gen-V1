// Scoped UI evidence capture for the agents grid correction: populated before/after
// screenshots at 768/1440, card-vs-slot metrics, keyboard focus and contrast ratio.
// Synthetic API fixtures only — no credentials or private data. Label selects the
// checkout under test ('before' = pre-correction base, 'after' = corrected head).
import {test, expect, type Page} from '@playwright/test';
import {resolve, join} from 'node:path';
import {mkdirSync, writeFileSync} from 'node:fs';
import type {AgentSummary} from '../../packages/contracts/agent-inventory';

const fixture = '/@fs/' + resolve('tests/e2e/agents-workspace-fixture.tsx').replaceAll('\\', '/');
const label = process.env.AGENTSUI_EVIDENCE_LABEL ?? 'after';
const outDir = process.env.AGENTSUI_EVIDENCE_DIR ?? 'test-results/agents-workspace-evidence';

const agent = (id: string, patch: Partial<AgentSummary> = {}): AgentSummary => ({agentId: id, parentId: null, rootId: id, jobId: null, threadId: id, projectId: 'a', projectName: 'Alpha', title: id, status: 'working', modelId: 'test/model', currentAction: 'Reading project sources', reportedPercent: 35, createdAt: '2026-11-06', updatedAt: '2026-11-06', orderKey: id, revision: 1, archived: false, readOnly: false, metadata: 'thread', ...patch});
const titles = ['Review workspace changes', 'Investigate terminal output', 'Refine project navigation', 'Trace the failing test', 'Document the API changes', 'Audit keyboard navigation', 'Update responsive layouts', 'Verify the release build'];
const agents = titles.map((title, i) => agent('parent-0' + i, {title, status: i === 2 ? 'completed' : i === 3 ? 'failed' : i === 4 ? 'awaiting_input' : i === 5 ? 'ready' : 'working', currentAction: ['Reading the latest workspace diff', 'Checking the terminal session', 'Navigation changes verified', 'Test setup needs attention', 'Waiting for a decision', 'Ready for your next instruction', 'Reviewing the small-screen layout', 'Running the final build checks'][i]!, reportedPercent: i === 0 ? 35 : i === 1 ? 65 : null, updatedAt: new Date(Date.now() - (i + 1) * 120000).toISOString()}));
agents.splice(1, 0, agent('child-00', {title: 'Check responsive states', parentId: 'parent-00', rootId: 'parent-00', jobId: 'job', status: 'completed', currentAction: 'Screenshots ready', reportedPercent: null, readOnly: true}));

async function mount(page: Page) {
 await page.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  if (url.pathname === '/api/plugins') return route.fulfill({json: {plugins: []}});
  if (url.pathname === '/api/shell/navigation') return route.fulfill({json: {items: [], total: 0, nextCursor: null, sequence: 10}});
  if (url.pathname === '/api/attention') return route.fulfill({json: {items: [], unreadCount: 0, sequence: 10}});
  if (url.pathname === '/api/agent-work') return route.fulfill({json: {enabled: false, roles: {}, budget: {reservedTokens: 0}, works: []}});
  if (url.pathname === '/api/agent-work/plan' || url.pathname === '/api/agent-work/messages') return route.fulfill({json: {extension: false, messages: []}});
  if (url.pathname === '/api/bootstrap') return route.fulfill({json: {csrfToken: 'synthetic'}});
  if (url.pathname === '/api/shell-settings') return route.fulfill({json: {theme: 'dark', preferences: {}}});
  if (url.pathname === '/api/workspace') return route.fulfill({json: {state: {version: 1, revision: 1, activeCanvasId: 'agents', canvases: [{id: 'agents', name: 'All Agents', preset: 'all-agents', version: 1, panels: [], filter: 'all', projectIds: [], viewport: {x: 0, y: 0, zoom: 1}}], profiles: [], disabledKinds: [], integrations: {}}, projects: []}});
  if (url.pathname === '/api/agents') {
   const start = Number(url.searchParams.get('cursor') || 0), slice = agents.slice(start, start + 15);
   return route.fulfill({json: {authority: 'personal', scopeKey: 'scope', sequence: 10, items: slice, ancestors: [], nextCursor: start + 15 < agents.length ? String(start + 15) : null}});
  }
  if (url.pathname === '/api/agents/history') {
   const id = url.searchParams.get('agentId')!;
   return route.fulfill({json: {authority: 'personal', agentId: id, threadId: id, sequence: 10, nextCursor: null, messages: Array.from({length: 8}, (_, i) => {
    const content = `${id}: transcript line ${i}. ` + 'Synthetic readable output. '.repeat(6);
    return {id: `m-${i}`, threadId: id, role: 'assistant', createdAt: '2026-11-06T00:00:0' + i + 'Z', runId: 'r', content, contentOffset: 0, contentLength: content.length, nextContentCursor: null};
   })}});
  }
  if (url.pathname === '/api/agents/updates') return route.fulfill({json: {authority: 'personal', scopeKey: 'scope', fromSequence: 10, sequence: 10, resync: false, upserts: [], removed: [], ancestors: [], transcripts: []}});
  if (url.pathname === '/api/agents/events') return route.fulfill({contentType: 'text/event-stream', body: ': synthetic connected\n\n'});
  return route.fulfill({status: 500, json: {error: {code: 'UNEXPECTED', message: url.pathname}}});
 });
 await page.route('**/agents-workspace-check*', route => route.fulfill({contentType: 'text/html', body: `<html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>`}));
 await page.goto('/agents-workspace-check?app=1');
 await expect(page.locator('.workspace-host')).toBeVisible({timeout: 15000});
 await expect(page.locator('.agents-grid-slot > .agents-agent').first()).toBeVisible({timeout: 15000});
}

const rgb = (value: string) => {const parts = value.match(/[\d.]+/g)!.map(Number); return {r: parts[0]! / 255, g: parts[1]! / 255, b: parts[2]! / 255, a: parts[3] ?? 1};};
const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const luminance = ({r, g, b}: {r: number; g: number; b: number}) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrastRatio = (fg: string, bg: string) => {const a = luminance(rgb(fg)), b = luminance(rgb(bg)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);};

for (const width of [1440, 768]) test(`populated grid evidence at ${width} (${label})`, async ({page}) => {
 await page.setViewportSize({width, height: 1000});
 await mount(page);
 mkdirSync(outDir, {recursive: true});
 const metrics = await page.locator('.agents-grid-slot').evaluateAll(slots => slots.map(slot => {
  const card = slot.querySelector('.agents-agent');
  const s = slot.getBoundingClientRect(), c = card ? card.getBoundingClientRect() : null;
  return {slotW: Math.round(s.width * 10) / 10, cardW: c ? Math.round(c.width * 10) / 10 : null};
 }));
 const mounted = metrics.filter(m => m.cardW !== null), fills = mounted.every(m => Math.abs(m.slotW - m.cardW!) <= 1);
 const colors = await page.locator('.agents-grid-slot > .agents-agent').first().evaluate(card => {
  const cs = getComputedStyle(card);
  const title = card.querySelector('.agents-agent-title h3'), activity = card.querySelector('.agents-activity');
  return {cardBg: cs.backgroundColor, titleColor: title ? getComputedStyle(title).color : null, mutedColor: activity ? getComputedStyle(activity).color : null};
 });
 const ratios = {
  titleVsCard: colors.titleColor ? Math.round(contrastRatio(colors.titleColor, colors.cardBg) * 100) / 100 : null,
  mutedVsCard: colors.mutedColor ? Math.round(contrastRatio(colors.mutedColor, colors.cardBg) * 100) / 100 : null,
 };
 await page.locator('.agents-agent-grid').focus();
 await page.keyboard.press('ArrowRight');
 const focused = await page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null;
  return {label: el?.getAttribute('aria-label') ?? null, outline: el ? getComputedStyle(el).outlineStyle : null};
 });
 writeFileSync(join(outDir, `metrics-${label}-${width}.json`), JSON.stringify({head: process.env.GITHUB_SHA ?? 'local', label, viewport: width, slots: metrics, allSlotsFilled: fills, colors, contrastRatios: ratios, keyboard: focused}, null, 2));
 await page.screenshot({path: join(outDir, `grid-${label}-${width}.png`)});
 const proto = process.env.AGENTSUI_PROTO_DIR;
 if (proto && width === 1440) {
  mkdirSync(proto, {recursive: true});
  await page.setViewportSize({width: 1440, height: 900});
  await page.emulateMedia({reducedMotion: 'reduce'});
  await expect(page.locator('.agents-preview').first()).toContainText('Synthetic readable output.');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {(document.activeElement as HTMLElement)?.blur();});
  await page.screenshot({path: join(proto, 'after3-agents-dark.png')});
  await page.evaluate(() => {document.documentElement.dataset.theme = 'light';});
  await page.screenshot({path: join(proto, 'after3-agents-light.png')});
  await page.evaluate(() => {document.documentElement.dataset.theme = 'dark';});
  const parent = page.locator('.agents-grid-slot > .agents-agent').first();
  await parent.getByRole('button', {name: 'Show transcript', exact: true}).click();
  await parent.getByRole('button', {name: '1 subagent', exact: true}).click();
  await parent.getByRole('button', {name: 'Inspect subagent Check responsive states', exact: true}).click();
  await expect(parent.locator('.agents-child .agents-preview')).toContainText('Synthetic readable output.');
  await page.screenshot({path: join(proto, 'after3-agents-expanded.png')});
  await parent.getByRole('button', {name: 'Hide transcript', exact: true}).click();
  await parent.getByRole('button', {name: '1 subagent', exact: true}).click();
  await page.setViewportSize({width: 390, height: 844});
  await page.screenshot({path: join(proto, 'after3-agents-mobile.png')});
 }
 expect(metrics.length).toBeGreaterThan(0); expect(mounted.length).toBeGreaterThan(0); expect(fills).toBe(true);
 expect(focused.label).toBeTruthy();
 expect(ratios.titleVsCard).toBeGreaterThanOrEqual(4.5);
});
