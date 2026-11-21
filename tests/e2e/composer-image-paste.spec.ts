import {test,expect} from '@playwright/test';
import type {HostCommand} from '../../packages/contracts';
import {taskFixture,serveTaskFixture} from './task-interface-fixture';
const spec={root:'text',elements:{text:{type:'Text',props:{text:'Checkout review'}}}};
const paste = (node: HTMLElement, kind: 'image' | 'text' | 'text+image' | 'oversized') => {
  const data = new DataTransfer();
  if (kind === 'text' || kind === 'text+image') data.setData('text/plain', 'hello');
  if (kind !== 'text') data.items.add(new File([new Uint8Array(kind === 'oversized' ? 21 * 1024 * 1024 : 8)], 'image.png', {type: 'image/png'}));
  return node.dispatchEvent(new ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true}));
};
async function serve(page: Parameters<typeof serveTaskFixture>[0]) {
  const snapshot = taskFixture(spec);
  const host = await serveTaskFixture(page, snapshot);
  // Spec-local resource injection: mirror what the host does on resource.upload so the
  // next refresh() renders the attachment chip (fixture itself keeps no upload semantics).
  await page.route('**/api/commands', async route => {
    const command = route.request().postDataJSON() as HostCommand;
    if (command.type === 'resource.upload') snapshot.resources.push({ id: `attachment-${snapshot.resources.length}`, threadId: command.threadId ?? 'task-thread', kind: 'attachment', path: `attachments/${command.payload.name}`, label: String(command.payload.name), writable: false, createdAt: new Date().toISOString() });
    await route.fallback();
  });
  await page.goto('/');
  return host;
}
test('pasting an image uploads it through resource.upload and shows a chip without touching the draft', async ({page}) => {
  const host = await serve(page);
  const draft = page.getByRole('textbox', {name: 'Message', exact: true});
  const allowed = await draft.evaluate(paste, 'image');
  expect(allowed).toBe(false);
  await expect.poll(() => host.commands.filter(command => command.type === 'resource.upload')).toHaveLength(1);
  const upload = host.commands.find(command => command.type === 'resource.upload')!;
  expect(upload.payload).toMatchObject({ mimeType: 'image/png' });
  expect(String(upload.payload.name)).toMatch(/^pasted-image-\d{8}-\d{6}\.png$/);
  expect(String(upload.payload.base64)).not.toHaveLength(0);
  await expect(draft).toHaveValue('');
  await expect(page.locator('.resource-chip', {hasText: String(upload.payload.name)})).toBeVisible();
});
test('pasting plain text inserts natively and uploads nothing', async ({page}) => {
  const host = await serve(page);
  const draft = page.getByRole('textbox', {name: 'Message', exact: true});
  const allowed = await draft.evaluate(paste, 'text');
  expect(allowed).toBe(true);
  expect(host.commands.filter(command => command.type === 'resource.upload')).toHaveLength(0);
});
test('a clipboard carrying both text and an image pastes as text only', async ({page}) => {
  const host = await serve(page);
  const draft = page.getByRole('textbox', {name: 'Message', exact: true});
  const allowed = await draft.evaluate(paste, 'text+image');
  expect(allowed).toBe(true);
  expect(host.commands.filter(command => command.type === 'resource.upload')).toHaveLength(0);
});
test('an oversized pasted image shows the attachment limit error and uploads nothing', async ({page}) => {
  const host = await serve(page);
  const draft = page.getByRole('textbox', {name: 'Message', exact: true});
  const allowed = await draft.evaluate(paste, 'oversized');
  expect(allowed).toBe(false);
  await expect(page.locator('.composer-error', {hasText: 'larger than the 20 MB attachment limit'})).toBeVisible();
  expect(host.commands.filter(command => command.type === 'resource.upload')).toHaveLength(0);
});
