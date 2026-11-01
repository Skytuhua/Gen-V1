import { test, expect } from '@playwright/test';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';
import type { HostCommand } from '../../packages/contracts';

const simple = { root: 'text', elements: { text: { type: 'Text', props: { text: 'Review the supplied brief.' } } } };
test('thread note drafts survive reload and accepted notes can be forgotten', async ({ page }) => {
  const snapshot = taskFixture(simple); snapshot.memory = [];
  const host = await serveTaskFixture(page, snapshot);
  await page.route('**/api/commands', async route => {
    const command = route.request().postDataJSON() as HostCommand;
    if (!command.type.startsWith('memory.')) return route.fallback();
    const p = command.payload, previous = snapshot.memory?.find(note => note.key === p.key);
    if (p.baseRevision !== (previous?.revision ?? 0)) return route.fulfill({ status: 409, json: { error: { code: 'STALE_MEMORY', message: 'This note changed. Your draft is retained.' } } });
    snapshot.memory = snapshot.memory!.filter(note => note.key !== p.key);
    if (command.type === 'memory.save') snapshot.memory.push({ id: `task-thread:${p.key}`, threadId: 'task-thread', key: String(p.key), content: String(p.content), revision: (previous?.revision ?? 0) + 1, author: 'user', updatedAt: new Date().toISOString() });
    await route.fulfill({ json: { commandId: command.id, eventSeq: ++snapshot.seq, result: snapshot.memory.at(-1) } }); await host.publish();
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Open workspace panel', exact: true }).click(); await page.getByRole('tab', { name: 'Usage', exact: true }).click();
  await page.getByRole('button', { name: 'Add memory note' }).click(); await page.getByRole('textbox', { name: 'Note key', exact: true }).fill('date-format'); await page.getByRole('textbox', { name: 'New thread note' }).fill('Use UTC for exported dates.');
  await page.reload(); await page.getByRole('button', { name: 'Add memory note' }).click(); await expect(page.getByRole('textbox', { name: 'New thread note' })).toHaveValue('Use UTC for exported dates.');
  await page.getByRole('button', { name: 'Add note', exact: true }).click(); await expect(page.getByRole('textbox', { name: 'Note date-format' })).toHaveValue('Use UTC for exported dates.');
  await page.reload(); await expect(page.getByRole('textbox', { name: 'Note date-format' })).toHaveValue('Use UTC for exported dates.'); await page.getByRole('button', { name: 'Forget date-format' }).click(); await expect(page.getByRole('textbox', { name: 'Note date-format' })).toHaveCount(0);
});
test('subscription inventory exposes OAuth, plan keys and official runtimes with explicit connection commands', async ({ page }) => {
  await serveTaskFixture(page, taskFixture(simple)); await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('button', { name: 'Providers', exact: true }).click();
  const connections = page.getByRole('region', { name: 'AI subscription connections' });
  await expect(connections.locator('[data-provider="github-copilot"]')).toContainText('pnpm agent:login --provider github-copilot'); await expect(connections.locator('[data-provider="xai"]')).toContainText('Ready to connect');
  await expect(connections.locator('[data-provider="claude-code"]')).toContainText('official Claude Code');await expect(connections.locator('[data-provider="claude-code"]')).toContainText('pnpm agent:login --provider claude-code');
  await expect(connections.locator('[data-provider="gemini-cli"]')).toContainText('official Gemini CLI');await expect(connections.locator('[data-provider="gemini-cli"]')).toContainText('pnpm agent:login --provider gemini-cli');await expect(connections.locator('[data-provider="opencode-go"]')).toContainText('workspace key');
  await expect(connections.locator('[data-provider="cursor-sdk"]')).toContainText('Ready to connect');await expect(connections.locator('[data-provider="cursor-sdk"]')).toContainText('pnpm agent:login --provider cursor-sdk');await expect(connections.locator('[data-provider="cursor-sdk"]')).toContainText('Preview connection');
  await page.getByRole('searchbox', { name: 'Search all settings' }).fill('Kimi'); await expect(connections.locator('[data-provider="kimi-coding"]')).toBeVisible(); await expect(connections.locator('[data-provider="openai"]')).toHaveCount(0); await expect(page.getByRole('heading', { name: 'Search results (1)', exact: true })).toBeVisible(); await expect(page.locator('.settings-empty')).toHaveCount(0);
});
test('ordinary chat does not download unused task component families', async ({ page }) => {
  const fetched: string[] = []; page.on('request', request => fetched.push(request.url()));
  const snapshot = taskFixture(simple); const host = await serveTaskFixture(page, snapshot); await page.goto('/'); await expect(page.getByText('Review the supplied brief.', { exact: true })).toBeVisible();
  for (const family of ['SoftwareDevelopment.tsx', 'ExplorationTools.tsx', 'EverydayData.tsx', 'InteractionTools.tsx']) expect(fetched.some(url => url.includes(family))).toBe(false);
  snapshot.artifacts[0].spec = { root: 'view', elements: { view: { type: 'LogExplorer', props: { dataBinding: 'logs', stateKey: 'logs' } } } }; snapshot.artifacts[0].revision++;
  snapshot.artifacts[0].bindings = { logs: { mode: 'live', id: 'logs' } }; snapshot.data.push({ id: 'logs', threadId: 'task-thread', revision: 1, provenance: 'explicit protocol fixture', createdAt: '', value: { events: [{ id: 'e1', level: 'info', message: 'Source loaded' }] } });
  await host.publish(); await expect(page.getByRole('searchbox', { name: 'Search logs' })).toBeVisible(); expect(fetched.some(url => url.includes('ExplorationTools.tsx'))).toBe(true);
});
test('an older note draft cannot silently overwrite a newer agent note, including after reload', async ({ page }) => {
  const snapshot = taskFixture(simple); snapshot.memory = [{ id: 'm', threadId: 'task-thread', key: 'constraint', content: 'Original note', revision: 1, author: 'agent', updatedAt: '' }];
  const host = await serveTaskFixture(page, snapshot); const submitted: number[] = [];
  await page.route('**/api/commands', async route => {
    const command = route.request().postDataJSON() as HostCommand; if (command.type !== 'memory.save') return route.fallback();
    submitted.push(Number(command.payload.baseRevision)); const current = snapshot.memory![0];
    if (command.payload.baseRevision !== current.revision) return route.fulfill({ status: 409, json: { error: { code: 'STALE_MEMORY', message: 'This note changed. Inspect it before saving again.' } } });
    snapshot.memory![0] = { ...current, content: String(command.payload.content), revision: current.revision + 1 };
    await route.fulfill({ json: { commandId: command.id, eventSeq: ++snapshot.seq, result: snapshot.memory![0] } }); await host.publish();
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Open workspace panel', exact: true }).click(); await page.getByRole('tab', { name: 'Usage', exact: true }).click();
  await page.getByRole('textbox', { name: 'Note constraint', exact: true }).fill('My pending draft');
  snapshot.memory![0] = { ...snapshot.memory![0], revision: 2, content: 'Newer agent constraint' }; await host.publish();
  await page.getByRole('button', { name: 'Save note', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('This note changed'); expect(submitted).toEqual([1]); expect(snapshot.memory![0].content).toBe('Newer agent constraint');
  await page.reload(); await expect(page.getByRole('textbox', { name: 'Note constraint', exact: true })).toHaveValue('My pending draft'); await page.getByRole('button', { name: 'Save note', exact: true }).click(); await expect.poll(() => submitted.length).toBe(2); expect(submitted[1]).toBe(1);
  await page.getByText('A newer saved note is available', { exact: true }).click(); await page.getByRole('button', { name: 'Use saved note', exact: true }).click(); await expect(page.getByRole('textbox', { name: 'Note constraint', exact: true })).toHaveValue('Newer agent constraint');
});
test('a saved note named new never shares a journal or mount identity with a fresh note', async ({ page }) => {
  const snapshot = taskFixture(simple); snapshot.memory = [{ id: 'm', threadId: 'task-thread', key: 'new', content: 'Existing saved note', revision: 1, author: 'user', updatedAt: '' }];
  await serveTaskFixture(page, snapshot); await page.goto('/'); await page.getByRole('button', { name: 'Open workspace panel', exact: true }).click(); await page.getByRole('tab', { name: 'Usage', exact: true }).click();
  await page.getByRole('button', { name: 'Add memory note' }).click(); await page.getByRole('textbox', { name: 'Note key', exact: true }).fill('followup'); await page.getByRole('textbox', { name: 'New thread note', exact: true }).fill('A separate draft');
  await page.reload(); await expect(page.getByRole('textbox', { name: 'Note new', exact: true })).toHaveValue('Existing saved note'); await page.getByRole('button', { name: 'Add memory note' }).click(); await expect(page.getByRole('textbox', { name: 'New thread note', exact: true })).toHaveValue('A separate draft'); await expect(page.getByRole('textbox', { name: 'Note new', exact: true })).toHaveValue('Existing saved note');
});
