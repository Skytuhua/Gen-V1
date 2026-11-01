import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { openReviewHost } from './review-host.ts';
import { openCaptureBrowser, closeCapture } from './review-capture.ts';
const output = resolve('docs/evidence/t3-centered-workspace-20261031'); await mkdir(output, { recursive: true });
const host = await openReviewHost(join(output, 'comparison-fixture-' + randomUUID().slice(0, 8)), 4397), browser = await openCaptureBrowser();
try {
  const thread = host.threads.get('catalog')!; await host.service.command({ id: randomUUID(), type: 'settings.update', payload: { theme: 'dark', modelId: 'review/local-fixture' } }); await host.service.command({ id: randomUUID(), type: 'message.send', threadId: thread.id, payload: { content: 'Show the interactive component catalog.', modelId: 'review/local-fixture' } }); await expect.poll(() => host.store.get<{runId:string|null}>('thread', thread.id)?.runId).toBeNull();
  await browser.page.goto('http://127.0.0.1:4397'); await browser.page.evaluate(id => localStorage.setItem('harness:selected-thread', id), thread.id); await browser.page.reload(); await browser.page.getByRole('tab', { name: 'Explore', exact: true }).click(); await browser.page.getByRole('tab', { name: 'Image feedback', exact: true }).click(); await browser.page.getByRole('button', { name: 'Add pin', exact: true }).click(); await browser.page.getByRole('textbox', { name: 'Pin feedback', exact: true }).fill('Give the preview and settings more separation.'); await expect.poll(() => host.store.snapshot().userStates.some(state => JSON.stringify(state.values).includes('Give the preview'))).toBe(true); await browser.page.screenshot({ path: join(output, 'centered-image-feedback.png') });
} finally { await closeCapture(browser); await host.close(); }
