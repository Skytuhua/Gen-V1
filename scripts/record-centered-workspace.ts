import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { openReviewHost } from './review-host.ts';
import { openCaptureBrowser, recordWindow, closeCapture } from './review-capture.ts';

const outputArgument=process.argv.indexOf('--output');
const output = resolve(outputArgument>=0?process.argv[outputArgument+1]:'docs/evidence/t3-centered-workspace-20261031'); await mkdir(output, { recursive: true });
const port = 4397, host = await openReviewHost(join(output, 'fixture-' + randomUUID().slice(0, 8)), port);
const browser = await openCaptureBrowser(), page = browser.page;
const thread = host.threads.get('catalog')!;
const manifest = { provenance: 'Actual local application using explicit synthetic sources and a scripted runtime. No model inference, provider authentication, external service execution or physical monitor test.', catalogAdditions: ['WorkflowBoard', 'ArchitectureCanvas', 'TraceWaterfall'], videos: [] as unknown[] };
const hold = (ms = 900) => page.waitForTimeout(ms);
const click = async (name: string) => { const button = page.getByRole('button', { name, exact: true }); await button.scrollIntoViewIfNeeded(); await button.hover(); await hold(250); await button.click(); await hold(); };
const tab = async (name: string) => { const button = page.getByRole('tab', { name, exact: true }); await button.scrollIntoViewIfNeeded(); await button.hover(); await hold(250); await button.click(); await hold(); };
async function capture(file: string, action: (chapter: (title: string) => Promise<void>) => Promise<void>) {
  const stop = await recordWindow(browser.server, page, join(output, file)), start = performance.now(), chapters: { title: string; startSeconds: number }[] = [];
  const chapter = async (title: string) => { chapters.push({ title, startSeconds: (performance.now() - start) / 1000 }); await page.screenshot({ path: join(output, file.replace('.mp4', `-chapter-${chapters.length}.png`)) }); };
  try { await hold(1400); await action(chapter); await hold(1600); const probe = await stop(); manifest.videos.push({ file, chapters, probe }); }
  catch (cause) { const probe = await stop(); manifest.videos.push({ file, chapters, probe, failed: true, error: String(cause) }); throw cause; }
  finally { await writeFile(join(output, 'recordings.json'), JSON.stringify(manifest, null, 2)); }
}
try {
  await host.service.command({ id: randomUUID(), type: 'settings.update', payload: { theme: 'dark', modelId: 'review/local-fixture' } });
  await host.service.command({ id: randomUUID(), type: 'message.send', threadId: thread.id, payload: { content: 'Review the supplied release work.', modelId: 'review/local-fixture' } });
  await expect.poll(() => host.store.get<{ runId: string | null }>('thread', thread.id)?.runId).toBeNull();
  await page.goto(`http://127.0.0.1:${port}`); await page.evaluate(id => { localStorage.setItem('harness:selected-thread', id); localStorage.removeItem('harness:shell-layout:v1'); localStorage.removeItem('harness:plan-floating-open'); }, thread.id); await page.reload();
  await expect(page.getByRole('tab', { name: 'Work objects', exact: true })).toBeVisible(); await tab('Work objects');
  await capture('working-objects.mp4', async chapter => {
    await chapter('Centered workspace · source-bound workflow board');
    await click('Keep retries ordered'); await page.getByRole('combobox', { name: 'Move selected card', exact: true }).selectOption('review'); await hold(1400); await chapter('Local moves remain proposals');
    await click('Send move proposal'); await expect.poll(() => host.store.get<{ runId: string | null }>('thread', thread.id)?.runId).toBeNull(); await hold(900);
    await tab('Architecture'); await click('Bounded parser'); await chapter('Layered architecture · connected evidence'); await click('Focus neighbors'); await hold(1400); await click('Ask about node'); await expect.poll(() => host.store.get<{ runId: string | null }>('thread', thread.id)?.runId).toBeNull();
    await tab('Trace'); await page.getByRole('treeitem', { name: 'Parse document', exact: true }).click(); await hold(1200); await chapter('Nested trace · supplied timing'); await page.getByRole('combobox', { name: 'Timeline zoom', exact: true }).selectOption('2'); await hold(1000);
    await page.getByRole('searchbox', { name: 'Filter spans', exact: true }).pressSequentially('Legacy', { delay: 100 }); await hold(900); await page.getByRole('treeitem', { name: 'Legacy adapter', exact: true }).click(); await chapter('Unknown timing stays unknown'); await hold(1000); await page.getByRole('searchbox', { name: 'Filter spans', exact: true }).fill(''); await tab('Workflow'); await chapter('Original local placement preserved');
  });
  await capture('shell-connections-memory.mp4', async chapter => {
    await chapter('Full-width T3-style shell · no reserved right rail'); await click('Toggle sidebar'); await hold(900); await click('Toggle sidebar');
    await click('Open workspace panel'); await tab('Usage'); await chapter('Thread memory · visible and editable'); await click('Add memory note'); await page.getByRole('textbox', { name: 'Note key', exact: true }).fill('date-format'); await page.getByRole('textbox', { name: 'New thread note', exact: true }).pressSequentially('Use UTC for exported dates.', { delay: 45 }); await click('Add note'); await hold(800); await click('Close workspace panel');
    await click('Settings'); await click('Providers'); await chapter('Subscription connections · honest availability'); await page.locator('[data-provider="github-copilot"]').scrollIntoViewIfNeeded(); await hold(1500); await page.locator('[data-provider="anthropic"]').scrollIntoViewIfNeeded(); await hold(1400); await page.locator('[data-provider="opencode-go"]').scrollIntoViewIfNeeded(); await hold(1400); await page.getByRole('searchbox', { name: 'Search all settings', exact: true }).fill('Kimi'); await hold(1000); await chapter('Pending integrations stay visibly unavailable'); await click('Dismiss settings'); await chapter('Centered workspace restored');
  });
} finally { await closeCapture(browser); await host.close(); }
