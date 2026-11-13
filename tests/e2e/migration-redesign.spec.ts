import { test, expect } from '@playwright/test';
import { migrationSpec } from '../../scripts/review-fixtures';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';

const schema = {
  nodes: [{ id: 'workspaces', label: 'workspaces.id', detail: 'id · name', kind: 'endpoint', column: 2, lane: 1 },
    ...['users', 'projects', 'messages'].map((id, lane) => ({ id, label: `${id}.workspace_id`, detail: 'workspace_id', kind: 'endpoint', column: 0, lane }))],
  edges: ['users', 'projects', 'messages'].map(from => ({ from, to: 'workspaces', label: 'workspace_id → id' })),
  branchLabels: [{ label: 'workspace_id → id', lane: 1, column: 1 }, { label: 'New table · id, name', lane: 1, column: 2 }],
};
const inputs = {
  migrationSchema: schema,
  migrationSummary: '**3 workspaces added** · **6 records linked**',
  migrationSql: 'CREATE TABLE workspaces (id INTEGER, name TEXT);',
  migrationTabs: { detail: 'Inspect committed records', status: 'success', items: ['workspaces', 'users', 'projects', 'messages'].map(label => ({ label, status: 'success' })) },
  workspaces: [{ id: 1, name: 'Studio' }, { id: 2, name: 'Personal' }, { id: 3, name: 'Fieldwork' }], workspacesChanges: { revision: 1, rows: [{ id: '1', status: 'added' }, { id: '2', status: 'added' }, { id: '3', status: 'added' }] },
  users: [{ id: 1, name: 'Ada', workspace: 1 }, { id: 2, name: 'Lin', workspace: 2 }], usersChanges: { revision: 1, rows: [{ id: '1', cells: [{ key: 'workspace', status: 'updated', before: null }] }, { id: '2', cells: [{ key: 'workspace', status: 'updated', before: null }] }] },
  projects: [{ id: 1, name: 'Export', workspace: 1 }], projectsChanges: { rows: [] },
  messages: [{ id: 1, name: 'Review complete', workspace: 1 }], messagesChanges: { rows: [] },
};

test('migration leads with workspace relationships, visible value changes and inspectable SQL', async ({ page }) => {
  const snapshot = taskFixture(migrationSpec(), inputs, { table: 'users' }); snapshot.settings.theme = 'dark';
  await serveTaskFixture(page, snapshot); await page.goto('/');
  await expect(page.getByRole('figure', { name: 'Workspace links', exact: true })).toBeVisible();
  await expect(page.getByText('3 workspaces added', { exact: true })).toBeVisible();
  await expect(page.getByText('New table · id, name', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'projects.workspace_id', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'projects', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'users.workspace_id', exact: true }).click();
  const table = page.getByRole('tabpanel').filter({ visible: true }).locator('.task-table');
  await expect(table.locator('.task-table-summary')).toContainText('2 updated');
  const changed = table.locator('tr[data-row-id="1"] td[data-column-key="workspace"]');
  await expect(changed.locator('.task-table-before')).toHaveText('NULL');
  await expect(changed.locator('.task-table-value')).toHaveText('1');
  await expect(changed.locator('.task-table-change-arrow')).toBeVisible();
  await expect(page.getByText('CREATE TABLE workspaces (id INTEGER, name TEXT);', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'SQL and approval details', exact: true }).click();
  await expect(page.getByText('CREATE TABLE workspaces (id INTEGER, name TEXT);', { exact: true })).toBeVisible();
});

test('completed inspection retains table identity, keyboard navigation and chat-only scrolling', async ({ page }) => {
  const snapshot = taskFixture(migrationSpec(), inputs, { table: 'users' }); snapshot.settings.theme = 'dark';
  const fixture = await serveTaskFixture(page, snapshot); await page.goto('/');
  const usersTable = page.getByRole('tabpanel').filter({ visible: true }).locator('table'); await expect(usersTable).toBeVisible();
  const identity = await usersTable.elementHandle();
  await page.getByRole('tab', { name: 'projects', exact: true }).click();
  await page.getByRole('tab', { name: 'users', exact: true }).click();
  expect(await usersTable.evaluate((node, old) => node === old, identity)).toBe(true);
  await page.getByRole('tab', { name: 'users', exact: true }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'projects', exact: true })).toHaveAttribute('aria-selected', 'true');
  await fixture.publish();
  for (const scroll of await page.locator('.task-table-scroll').all()) expect(await scroll.evaluate(node => node.scrollHeight <= node.clientHeight)).toBe(true);
  await page.setViewportSize({ width: 700, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('generic tables keep unchanged values plain and reject untrusted change metadata', async ({ page }) => {
  const snapshot = taskFixture({ root: 'table', elements: { table: { type: 'Table', props: { rowsBinding: 'rows', changesBinding: 'changes', rowKey: 'id', columns: [{ key: 'name', label: 'Name' }] } } } }, { rows: [{ id: 'a', name: 'Unchanged' }], changes: { rows: [{ id: 'a', cells: [{ key: 'name', status: 'updated', before: 'Unchanged' }] }] } });
  const fixture = await serveTaskFixture(page, snapshot); await page.goto('/');
  await expect(page.locator('.task-table-value')).toHaveText('Unchanged');
  await expect(page.locator('.task-table-before')).toHaveCount(0);
  fixture.setInput('changes', { rows: [{ id: 'a', cells: [{ key: 'name', status: 'added' }] }] }); await fixture.publish();
  await expect(page.locator('.task-table-summary')).toContainText('1 updated');
  await expect(page.locator('.task-table-summary')).not.toContainText('1 added');
  fixture.setInput('changes', { rows: [{ id: 'a', status: 'success' }] }); await fixture.publish();
  await expect(page.getByRole('status').filter({ hasText: 'Change metadata is unavailable' })).toBeVisible();
  await expect(page.locator('td[data-change]')).toHaveCount(0);
});
