import {afterAll, beforeAll, describe, it} from 'vitest';
import {build} from 'esbuild';
import {chromium, expect, type Browser, type Page} from '@playwright/test';

// Decision-level coverage for AgentWorkPanel (issue #1360): which rows and
// actions render per work state, and which command each action posts.
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {AgentWorkPanel} from './apps/web/src/agents-workspace/AgentWorkPanel';

const work = (over) => ({
  workId: 'w1', role: 'CODE_WORKTREE', state: 'RUNNING', failureReason: null, blockedReason: null,
  steerSupported: true, owner: {threadId: 'owner-thread-0001', runId: null, epoch: 0},
  worktree: '/tmp/work-w1', grants: [], budget: {tokens: 5000, ms: null}, outputRef: null,
  repairAttempts: 0, evidence: {refs: 2, stale: 1, outputRevision: null}, updatedAt: '2026-01-01T00:00:00Z', revision: 1,
  ...over,
});
window.__works = [];if (typeof crypto.randomUUID !== 'function') crypto.randomUUID = () => 'uuid-' + Math.random().toString(36).slice(2);
window.__sent = [];
window.__failList = false;
window.fetch = async (url, init) => {
  const path = String(url);
  const json = (body) => new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
  if (path.startsWith('/api/bootstrap')) return json({csrfToken: 't', seq: 1, threads: [], messages: [], artifacts: [], userStates: [], data: [], requests: [], operations: [], resources: [], usage: {}, settings: {}, activeThreadId: null});
  if (path.startsWith('/api/agent-work/plan')) return json({extension: false, planId: 'p1'});
  if (path.startsWith('/api/agent-work/messages')) return json({messages: []});
  if (path.startsWith('/api/agent-work/inputs')) return json({inputs: []});
  if (path.startsWith('/api/agent-work/output')) return json({workId: 'w1', output: {result: 'done'}, lateArtifacts: 0});
  if (path.startsWith('/api/agent-work')) {
    if (window.__failList) return new Response(JSON.stringify({error: {code: 'UNAVAILABLE'}}), {status: 503, headers: {'Content-Type': 'application/json'}});
    return json({enabled: true, works: window.__works, budget: {reservedTokens: 5000, spentTokens: 0, admitted: 1, completed: 0, failed: 0, cancelled: 0, interrupted: 0}, roles: {CODE_WORKTREE: {available: true}}});
  }
  if (path.startsWith('/api/commands')) { window.__sent.push(JSON.parse(init.body)); return json({commandId: 'c1', result: {}, seq: 1}); }
  return new Response('not found', {status: 404});
};
createRoot(document.getElementById('root')).render(<AgentWorkPanel threadId="thread-1" />);
`;

describe('AgentWorkPanel', () => {
  let browser: Browser, script: string;
  beforeAll(async () => {
    script = (await build({stdin: {contents: fixture, resolveDir: process.cwd(), loader: 'tsx'}, loader: {'.css': 'empty'}, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: {'process.env.NODE_ENV': '"production"'}})).outputFiles[0]!.text;
    browser = await chromium.launch({headless: true, ...(process.platform === 'win32' ? {channel: 'msedge'} : {})});
  });
  afterAll(async () => { await browser?.close(); }, 45000);
  async function open(): Promise<Page> {
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({content: script});
    return page;
  }

  it('renders nothing when the list is empty or fails, and lists works once expanded', async () => {
    const page = await open();
    await expect(page.locator('.agents-work')).toHaveCount(0, {timeout: 8000});
    await expect(page.locator('.agents-disclosure')).toHaveCount(0);
    await page.evaluate(() => { window.__works = [{workId: 'w9', role: 'QA', state: 'RUNNING', failureReason: null, blockedReason: null, steerSupported: false, owner: {threadId: 'owner-2', runId: null, epoch: 0}, worktree: null, grants: [], budget: {tokens: null, ms: null}, outputRef: null, repairAttempts: 0, evidence: {refs: 0, stale: 0, outputRevision: null}, updatedAt: 'x', revision: 1}]; });
    await expect(page.locator('.agents-disclosure')).toHaveText('Agent work · 1', {timeout: 8000});
    await page.locator('.agents-disclosure').click();
    await expect(page.locator('.agents-work-row')).toHaveCount(1);
    await expect(page.locator('.agents-work-state')).toHaveText('RUNNING');
  });

  it('enables Steer only for a running steerable work and posts agentWork.input', async () => {
    const page = await open();
    await page.evaluate(() => { window.__works = [{workId: 'w1', role: 'CODE_WORKTREE', state: 'RUNNING', failureReason: null, blockedReason: null, steerSupported: true, owner: {threadId: 'owner-thread-0001', runId: null, epoch: 0}, worktree: '/tmp/work-w1', grants: [], budget: {tokens: 5000, ms: null}, outputRef: null, repairAttempts: 0, evidence: {refs: 2, stale: 1, outputRevision: null}, updatedAt: 'x', revision: 1}]; });
    await expect(page.locator('.agents-disclosure')).toHaveText('Agent work · 1', {timeout: 8000});
    await page.locator('.agents-disclosure').click();
    const input = page.getByLabel('Message work w1');
    const steer = page.getByRole('button', {name: 'Steer now'});
    await expect(steer).toBeEnabled();
    await expect(page.getByRole('button', {name: 'Stop w1'})).toBeVisible();
    await input.fill('rotate the tires');
    await steer.click();
    await expect.poll(async () => page.evaluate(() => window.__sent.map((entry: {type?:string;payload?:Record<string,unknown>}) => `${entry.type}:${entry.payload?.kind}:${entry.payload?.workId}:${entry.payload?.text}`))).toContain('agentWork.input:STEER:w1:rotate the tires');
    await expect(input).toHaveValue('');
    await page.getByLabel('Message work w1').fill('later');
    await page.getByRole('button', {name: 'Queue next'}).click();
    await expect.poll(async () => page.evaluate(() => window.__sent.map((entry: {type?:string;payload?:Record<string,unknown>}) => `${entry.type}:${entry.payload?.kind}`))).toContain('agentWork.input:FOLLOW_UP');
  });

  it('offers Resume for INTERRUPTED work and disables the send row for finished work', async () => {
    const page = await open();
    await page.evaluate(() => { window.__works = [
      {workId: 'w1', role: 'CODE_WORKTREE', state: 'INTERRUPTED', failureReason: null, blockedReason: null, steerSupported: true, owner: {threadId: 'owner-1', runId: null, epoch: 0}, worktree: null, grants: [], budget: {tokens: null, ms: null}, outputRef: null, repairAttempts: 0, evidence: {refs: 0, stale: 0, outputRevision: null}, updatedAt: 'x', revision: 1},
      {workId: 'w2', role: 'QA', state: 'COMPLETED_REPORTED', failureReason: null, blockedReason: null, steerSupported: true, owner: {threadId: 'owner-2', runId: null, epoch: 0}, worktree: null, grants: [], budget: {tokens: null, ms: null}, outputRef: null, repairAttempts: 0, evidence: {refs: 0, stale: 0, outputRevision: null}, updatedAt: 'x', revision: 1},
    ]; });
    await expect(page.locator('.agents-disclosure')).toHaveText('Agent work · 2', {timeout: 8000});
    await page.locator('.agents-disclosure').click();
    await page.getByRole('button', {name: 'Resume w1'}).click();
    await expect.poll(async () => page.evaluate(() => window.__sent.map((entry: {type?:string;payload?:Record<string,unknown>}) => `${entry.type}:${entry.payload?.workId}`))).toContain('agentWork.resume:w1');
    const w2 = page.locator('.agents-work-row').nth(1);
    await expect(w2.getByLabel('Message work w2')).toBeDisabled();
    await expect(w2.getByRole('button', {name: 'Steer now'})).toBeDisabled();
    await expect(w2.getByRole('button', {name: 'Queue next'})).toBeDisabled();
  });
});
