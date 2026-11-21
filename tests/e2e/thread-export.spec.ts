import { readFile } from 'node:fs/promises';
import { FIXTURE_LABEL, openHost, sendFixture, test, expect } from '../host-fixture.ts';

// Browser-path export: the host renders the stored thread and the anchor
// download carries it. No route interception or mocked desktop bridge.
test('sidebar Options exports the whole stored thread as a Markdown download', async ({ page, host }) => {
  await openHost(page); await sendFixture(page, 'document');
  const threadId = host.snapshot().threads[0]!.id;
  host.store.internal('fixture.export-records', threadId, () => {
    host.store.put('message', 'export-activity', threadId, { id: 'export-activity', threadId, role: 'activity', content: 'bash: fixture-check', createdAt: '2026-11-21T03:12:16Z', runId: null });
    host.store.put('message', 'export-last', threadId, { id: 'export-last', threadId, role: 'assistant', content: 'Export tail marker for ordering.', createdAt: '2026-11-21T03:13:00Z', runId: null });
    host.store.put('dataVersion', `plan:${threadId}@1`, threadId, { id: `plan:${threadId}`, revision: 1, provenance: 'harness:plan', createdAt: '2026-11-21T03:14:00Z', value: { version: 1, title: 'Export fixture plan', steps: [{ id: 's1', title: 'Verify export', status: 'completed', requirements: [] }], agents: [] } });
  });

  const title = host.snapshot().threads[0]!.title;
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: `Options for ${title}`, exact: true }).click();
  await page.getByRole('menu', { name: `Options for ${title}`, exact: true }).getByRole('menuitem', { name: 'Export as Markdown…', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^[a-z0-9-]{1,60}-\d{4}-\d{2}-\d{2}\.md$/);

  const content = await readFile(await download.path(), 'utf8');
  expect(content.startsWith('<!-- gen-v1-thread-export v1 -->\n# ')).toBe(true);
  expect(content).toContain('Verify the local host contract.');
  expect(content).toContain(FIXTURE_LABEL);
  expect(content).toContain('Export tail marker for ordering.');
  expect(content.indexOf('Verify the local host contract.')).toBeLessThan(content.indexOf('Export tail marker for ordering.'));
  expect(content).toContain('### Plan · revision 1 — Export fixture plan');
  expect(content).toContain('<details><summary>Tool activity (1)</summary>');
  expect(content).toContain('`bash: fixture-check`');
});
