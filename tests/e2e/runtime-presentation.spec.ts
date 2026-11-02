import { test, expect, type Page } from '@playwright/test';
import type { Snapshot } from '../../packages/contracts';
import { EMPTY_USAGE } from '../../packages/contracts';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';

const models = [
  { id: 'openai/gpt-6.1-sol', provider: 'openai', name: 'ChatGPT fixture' },
  { id: 'claude-code/sonnet', provider: 'claude-code', name: 'Claude fixture' },
  { id: 'gemini-cli/pro', provider: 'gemini-cli', name: 'Gemini fixture' },
  { id: 'cursor-sdk/model', provider: 'cursor-sdk', name: 'Cursor fixture' },
];

function fixture(modelId: string, sessionPath: string): Snapshot {
  const value = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Review the supplied brief.' } } } });
  value.settings.modelId = 'openai/gpt-6.1-sol';
  value.threads[0] = { ...value.threads[0], modelId, sessionPath };
  value.usage['task-thread'] = { ...EMPTY_USAGE, contextTokens: 2000, contextWindow: 20000, inputTokens: 1200, outputTokens: 300 };
  return value;
}

async function serve(page: Page, snapshot: Snapshot) {
  const host = await serveTaskFixture(page, snapshot);
  await page.route('**/api/models*', route => route.fulfill({ json: { models } }));
  return host;
}

async function nativeBridge(page: Page) {
  await page.addInitScript(() => {
    const context = { windowId: 'main', surface: { kind: 'main' as const }, windows: [{ id: 'main', surface: { kind: 'main' as const }, ready: true, minimized: false }] };
    window.harnessDesktop = {
      getContext: async () => context,
      ready: async () => context,
      list: async () => context.windows,
      onState: () => () => {},
      onCloseRequested: () => () => {},
      detach: async () => { throw new Error('This fixture does not detach windows.'); },
      reattach: async () => {}, minimize: async () => {}, signIn: async () => {}, resetBounds: async () => {}, focus: async () => {}, browser: async () => {},
    };
  });
}

test('native settings contain no idle browser caption or Pi-only runtime claims', async ({ page }) => {
  await nativeBridge(page);
  await serve(page, fixture('gemini-cli/pro', 'C:\\fixture\\official\\gemini-cli\\tasks\\task-thread\\session.json'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog.locator(':scope > header [role="status"]')).toBeEmpty();
  await page.getByRole('button', { name: 'Providers', exact: true }).click();
  await expect(dialog.locator('[data-setting-id="harness-local-models"]')).toContainText('4 models');
  await expect(dialog.locator('[data-setting-id="harness-local-models"]')).not.toContainText('Pi runtime');
  await page.getByRole('button', { name: 'Environments', exact: true }).click();
  await expect(dialog.locator('[data-setting-id="harness-runtime"]')).toContainText('Windows app');
  await expect(dialog.locator('[data-setting-id="harness-runtime"]')).not.toContainText('Pi runtime');
  await page.getByRole('button', { name: 'About', exact: true }).click();
  await expect(dialog.locator('[data-setting-id="app-version"]')).toContainText('Windows desktop');
  await expect(dialog.locator('[data-setting-id="app-version"]')).not.toContainText('Local Pi runtime');
});

for (const [provider, name] of [['gemini-cli', 'Gemini'], ['cursor-sdk', 'Cursor']] as const) {
  test(`${name} context explains unavailable compaction without sending a command`, async ({ page }) => {
    const model = provider === 'gemini-cli' ? 'gemini-cli/pro' : 'cursor-sdk/model';
    const snapshot = fixture(model, `C:\\fixture\\official\\${provider}\\tasks\\task-thread\\session.json`);
    const host = await serve(page, snapshot);
    await page.goto('/'); await page.getByRole('button', { name: 'Inspect context usage', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Context inspector', exact: true });
    const compact = dialog.getByRole('button', { name: 'Compact now', exact: true });
    await expect(compact).toBeDisabled();
    await expect(compact).toHaveAttribute('title', new RegExp(`${name}.*compaction.*new thread`, 'i'));
    await expect(dialog.getByRole('status')).toContainText(`${name} compaction unavailable`);
    await compact.evaluate(button => (button as HTMLButtonElement).click());
    expect(host.commands.filter(command => command.type === 'run.compact')).toEqual([]);
    snapshot.usage['task-thread'].activity = 'running'; await host.publish();
    await expect(dialog.getByRole('status')).toHaveText('Agent working');
    await expect(compact).toBeDisabled();
    snapshot.usage['task-thread'].activity = 'retrying'; await host.publish();
    await expect(dialog.getByRole('status')).toHaveText('Retrying');
  });
}

for (const [name, modelId, sessionPath, defaultModel] of [
  ['Pi', 'openai/gpt-6.1-sol', '/fixture/pi/tasks/thread/sessions/task-thread.jsonl', 'gemini-cli/pro'],
  ['Claude', 'claude-code/sonnet', '/fixture/official/claude-code/tasks/task-thread/session.json', 'cursor-sdk/model'],
] as const) {
  test(`${name} compaction still uses the owning thread when the default model differs`, async ({ page }) => {
    const snapshot = fixture(modelId, sessionPath); snapshot.settings.modelId = defaultModel;
    const host = await serve(page, snapshot);
    await page.goto('/'); await page.getByRole('button', { name: 'Inspect context usage', exact: true }).click();
    const compact = page.getByRole('dialog', { name: 'Context inspector', exact: true }).getByRole('button', { name: 'Compact now', exact: true });
    await expect(compact).toBeEnabled(); await compact.click();
    await expect.poll(() => host.commands.filter(command => command.type === 'run.compact').map(command => command.threadId)).toEqual(['task-thread']);
  });
}

test('an established session namespace takes precedence over mismatched model metadata', async ({ page }) => {
  const snapshot = fixture('openai/gpt-6.1-sol', '/fixture/official/cursor-sdk/tasks/task-thread/session.json');
  const host = await serve(page, snapshot);
  await page.goto('/'); await page.getByRole('button', { name: 'Inspect context usage', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Context inspector', exact: true });
  await expect(dialog.getByRole('button', { name: 'Compact now', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('status')).toContainText('Cursor compaction unavailable');
  snapshot.threads[0].sessionPath = '/fixture/official/claude-code/tasks/task-thread/session.json';
  snapshot.threads[0].modelId = 'cursor-sdk/model';
  await host.publish();
  await expect(dialog.getByRole('button', { name: 'Compact now', exact: true })).toBeEnabled();
});

test('a Pi session is not confused with an official-looking directory in its data root', async ({ page }) => {
  await serve(page, fixture('cursor-sdk/model', '/fixture/official/cursor-sdk/tasks/outer/pi/tasks/thread/sessions/task-thread.jsonl'));
  await page.goto('/'); await page.getByRole('button', { name: 'Inspect context usage', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Context inspector', exact: true }).getByRole('button', { name: 'Compact now', exact: true })).toBeEnabled();
});

test('mobile settings remain interactive above the navigation focus region', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await serve(page, fixture('openai/gpt-6.1-sol', '/fixture/pi/tasks/thread/sessions/thread.jsonl'));
  await page.goto('/'); await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this mobile draft.');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.locator('dialog.settings-dialog');
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => (element as HTMLElement).inert)).toBe(false);
  await page.getByRole('button', { name: 'Providers', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Providers', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEditable();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep this mobile draft.');
});

test('native settings own Escape without collapsing an expanded artifact or losing edits', async ({ page }) => {
  const snapshot = taskFixture({ root: 'edit', elements: { edit: { type: 'Input', props: { stateKey: 'note', label: 'Working note' } } } }, {}, { note: 'Original' });
  const host = await serve(page, snapshot);
  await page.route('**/api/commands', async route => {
    const command = route.request().postDataJSON();
    if (command.type !== 'artifact.expand') return route.fallback();
    snapshot.artifacts[0].placement = command.payload.expanded ? 'expanded' : 'inline';
    await route.fulfill({ json: { commandId: command.id, eventSeq: ++snapshot.seq, result: {} } });
    await host.publish();
  });
  await page.goto('/');
  const note = page.getByRole('textbox', { name: 'Working note', exact: true });
  await note.fill('Keep the expanded edit.'); await note.evaluate(element => { element.dataset.retained = 'yes'; });
  await page.getByRole('button', { name: 'Expand artifact', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Collapse artifact', exact: true })).toBeVisible();
  await page.keyboard.press('Control+,');
  const dialog = page.locator('dialog.settings-dialog'); await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => (element as HTMLElement).inert)).toBe(false);
  await page.getByRole('button', { name: 'Providers', exact: true }).click();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Collapse artifact', exact: true })).toBeVisible();
  await expect(note).toHaveValue('Keep the expanded edit.'); await expect(note).toHaveAttribute('data-retained', 'yes');
});
