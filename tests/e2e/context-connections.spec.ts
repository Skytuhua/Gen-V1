import { test, expect, type Page } from '@playwright/test';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';
import type { HostCommand } from '../../packages/contracts';
import {SUBSCRIPTION_CONNECTIONS} from '../../packages/contracts/connections';

async function openNotes(page:Page){await page.getByRole('button',{name:'Open panel',exact:true}).click();await page.getByRole('button',{name:'Add surface',exact:true}).click();await page.getByRole('menuitem',{name:'Notes',exact:true}).click();}

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
  await page.goto('/'); await openNotes(page);
  await page.getByRole('button', { name: 'Add memory note' }).click(); await page.getByRole('textbox', { name: 'Note key', exact: true }).fill('date-format'); await page.getByRole('textbox', { name: 'New thread note' }).fill('Use UTC for exported dates.');
  await page.reload(); await expect(page.getByRole('textbox', { name: 'New thread note' })).toHaveValue('Use UTC for exported dates.');
  await page.getByRole('button', { name: 'Add note', exact: true }).click(); await expect(page.getByRole('textbox', { name: 'Note date-format' })).toHaveValue('Use UTC for exported dates.');
  await page.reload(); await expect(page.getByRole('textbox', { name: 'Note date-format' })).toHaveValue('Use UTC for exported dates.'); await page.getByRole('button', { name: 'Forget date-format' }).click(); await expect(page.getByRole('textbox', { name: 'Note date-format' })).toHaveCount(0);
});
test('subscription inventory exposes OAuth, plan keys and official runtimes with explicit connection commands', async ({ page }) => {
  await serveTaskFixture(page, taskFixture(simple));
  await page.route('**/api/account-auth?*',route=>{const query=new URL(route.request().url()).searchParams;return route.fulfill({json:{providerId:query.get('providerId'),accountId:null,state:'unknown',identity:{availability:'unavailable',subject:null,email:null,organization:null,subscription:null},lastCheckedAt:null,localSignout:false,message:'Synthetic status; identity unavailable.'}});});
  await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('button', { name: 'Models & Accounts', exact: true }).click();
  const connections = page.getByRole('region', { name: 'AI subscription connections' });
  for(const provider of SUBSCRIPTION_CONNECTIONS){
    await connections.getByRole('button',{name:provider.label,exact:true}).click();const detail=connections.locator(`[data-provider="${provider.id}"]`);await expect(connections.locator('[data-provider]')).toHaveCount(1);
    if(provider.status==='available'){await detail.getByText('Connect from a terminal',{exact:true}).click();await expect(detail.locator('code')).toHaveText(`pnpm agent:login --provider ${provider.id}`);await expect(detail.locator('.connection-auth-summary strong')).toHaveText('Status unknown');}
    else await expect(detail).toContainText('Unavailable.');
    await detail.getByText('Runtime and setup details',{exact:true}).click();await expect(detail).toContainText(provider.description);
  }
  await expect(connections).not.toContainText('Ready to connect');
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
  await page.goto('/'); await openNotes(page);
  await page.getByRole('textbox', { name: 'Note constraint', exact: true }).fill('My pending draft');
  snapshot.memory![0] = { ...snapshot.memory![0], revision: 2, content: 'Newer agent constraint' }; await host.publish();
  await page.getByRole('button', { name: 'Save note', exact: true }).click(); await expect(page.getByRole('status').filter({hasText:'This note changed'})).toBeVisible(); expect(submitted).toEqual([1]); expect(snapshot.memory![0].content).toBe('Newer agent constraint');
  await page.reload(); await expect(page.getByRole('textbox', { name: 'Note constraint', exact: true })).toHaveValue('My pending draft'); await page.getByRole('button', { name: 'Save note', exact: true }).click(); await expect.poll(() => submitted.length).toBe(2); expect(submitted[1]).toBe(1);
  await page.getByText('A newer saved note is available', { exact: true }).click(); await page.getByRole('button', { name: 'Use saved note', exact: true }).click(); await expect(page.getByRole('textbox', { name: 'Note constraint', exact: true })).toHaveValue('Newer agent constraint');
});
test('a saved note named new never shares a journal or mount identity with a fresh note', async ({ page }) => {
  const snapshot = taskFixture(simple); snapshot.memory = [{ id: 'm', threadId: 'task-thread', key: 'new', content: 'Existing saved note', revision: 1, author: 'user', updatedAt: '' }];
  await serveTaskFixture(page, snapshot); await page.goto('/'); await openNotes(page);
  await page.getByRole('button', { name: 'Add memory note' }).click(); await page.getByRole('textbox', { name: 'Note key', exact: true }).fill('followup'); await page.getByRole('textbox', { name: 'New thread note', exact: true }).fill('A separate draft');
  await page.reload(); await expect(page.getByRole('textbox', { name: 'Note new', exact: true })).toHaveValue('Existing saved note'); await expect(page.getByRole('textbox', { name: 'New thread note', exact: true })).toHaveValue('A separate draft'); await expect(page.getByRole('textbox', { name: 'Note new', exact: true })).toHaveValue('Existing saved note');
});

test.describe('absolute local clock format (T07/R10)', () => {
  test.use({ locale: 'en-US', timezoneId: 'UTC' });
  test('recorded output time follows the system/24h/12h preference at the 13:05 fixture', async ({ page }) => {
    const snapshot=taskFixture(simple);snapshot.data.push({id:'clock-output',threadId:'task-thread',revision:1,value:{stdout:'Clock format fixture',exitCode:0},provenance:'Synthetic recorded output',createdAt:'2026-11-16T13:05:00.000Z'});
    await serveTaskFixture(page,snapshot);await page.goto('/');
    await page.getByRole('button',{name:'Open panel',exact:true}).click();
    const panel=page.getByRole('complementary',{name:'Workspace panel',exact:true});await panel.getByRole('button',{name:'Add surface',exact:true}).click();await page.getByRole('menuitem',{name:'Output',exact:true}).click();
    const checked=panel.locator('.executor-record>header>small');await expect(checked).toHaveText('1:05 PM');
    const setFormat=async(label:string)=>{
      await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'General',exact:true}).click();
      await page.getByRole('combobox',{name:'Time format',exact:true}).click();await page.getByRole('option',{name:label,exact:true}).click();
      await page.getByRole('button',{name:'Close dialog',exact:true}).click();
    };
    await setFormat('24 hour');await expect(checked).toHaveText('13:05');
    await setFormat('12 hour');await expect(checked).toHaveText('1:05 PM');
    await setFormat('System');await expect(checked).toHaveText('1:05 PM');
  });});
