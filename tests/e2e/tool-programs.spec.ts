import { expect, test, type Page, type Route } from '@playwright/test';
import { DEFAULT_PROGRAM_LIMITS, type NestedCallV1, type PythonKernelV1, type ToolProgramV1 } from '../../packages/contracts/tool-program.ts';

const hash = 'a'.repeat(64);
const sourceRef = 'result_' + '1'.repeat(32), failedRef = 'result_' + '2'.repeat(32);
const notice = 'Reset clears variables. It does not undo files or prior remote effects. Previous cells are never replayed.';
const owner = (threadId = 'thread-a') => ({ threadId, runId: 'run-a', epoch: 3, projectId: 'project-a', workspaceId: 'workspace-a', accountBinding: 'account-a' });
function model(threadId = 'thread-a') {
  const program: ToolProgramV1 = {
    version: 1, programId: threadId === 'thread-a' ? 'program-a' : 'program-b', owner: owner(threadId),
    language: 'JAVASCRIPT', sourceDigest: hash, runtimeFingerprint: hash, toolRegistryDigest: hash,
    allowedTools: ['repository_read', 'repository_log'], inputRefs: [], limits: { ...DEFAULT_PROGRAM_LIMITS },
    state: 'FAILED', resultRef: null, createdAt: 1, startedAt: 2, deadlineAt: 30002, elapsedMs: 1234, nestedCallCount: 2,
    error: { code: 'REPLAY_DIVERGED', message: 'Replay stopped: call:2 changed its arguments.', originalResultRef: failedRef },
  };
  const calls: NestedCallV1[] = [0, 1].map(index => ({
    version: 1, parentProgramId: program.programId, stableCallKey: `call:${index}`, invocationId: `nested-${index}`, owner: owner(threadId),
    toolName: index ? 'repository_log' : 'repository_read', definitionDigest: hash, argumentsCommitment: hash,
    resultRef: index ? failedRef : sourceRef, effectClass: 'READ_RETRYABLE', state: index ? 'FAILED' : 'SUCCEEDED',
    error: index ? { code: 'SOURCE_FAILED', message: 'PRIVATE_NESTED_ERROR_SENTINEL', originalResultRef: failedRef } : null,
  }));
  const kernel: PythonKernelV1 = {
    version: 1, kernelId: 'kernel-a', key: hash,
    identity: { owner: owner(threadId), interpreterDigest: hash, configurationDigest: hash, cwdIdentity: 'cwd-a', toolRegistryDigest: hash, executionProfileDigest: hash },
    generation: 3, state: 'RUNNING', activeProgramId: 'python-program', retainedState: true, updatedAt: 1, error: null,
  };
  return { programs: [{ program, calls, sourceRefs: [sourceRef, failedRef] }], kernels: threadId === 'thread-a' ? [kernel] : [], available: { javascript: false, python: false, replay: false }, resetNotice: notice };
}
type Model = ReturnType<typeof model>;
interface ApiState {
  models: Record<string, Model>;
  commands: { type: string; payload: Record<string, unknown>; threadId: string }[];
  resultRequests: URL[];
  listFailure?: boolean;
  resultFailure?: boolean;
  holdList?: (threadId: string) => Promise<void>;
  holdResult?: () => Promise<void>;
}
async function install(page: Page, initial: Partial<ApiState> = {}) {
  const state: ApiState = { models: { 'thread-a': model(), 'thread-b': model('thread-b') }, commands: [], resultRequests: [], ...initial };
  const send = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/bootstrap') return send(route, { csrfToken: 'fixture-csrf' });
    if (url.pathname === '/api/commands') {
      const command = route.request().postDataJSON(); state.commands.push(command);
      const current = state.models[command.threadId];
      if (command.type === 'pythonKernel.stop') Object.assign(current.kernels[0], { state: 'STOPPED', retainedState: false, activeProgramId: null });
      if (command.type === 'pythonKernel.reset') Object.assign(current.kernels[0], { state: 'READY', retainedState: false, generation: current.kernels[0].generation + 1, activeProgramId: null });
      if (command.type === 'toolProgram.cancel') Object.assign(current.programs[0].program, { state: 'CANCELLED' });
      return send(route, { commandId: command.id, eventSeq: state.commands.length, result: {} });
    }
    const result = /^\/api\/threads\/([^/]+)\/tool-programs\/([^/]+)\/results\/([^/]+)$/.exec(url.pathname);
    if (result) {
      state.resultRequests.push(url); await state.holdResult?.();
      if (state.resultFailure) return send(route, { error: { code: 'RESULT_ACCESS_DENIED', message: 'This source grant is no longer available.' } }, 403);
      const text = '<img src=x onerror="window.programInspectionInjected=true">' + 'x'.repeat(16400) + 'TAIL_OF_RETAINED_RESULT';
      const bytes = Buffer.from(text), offset = Number(url.searchParams.get('offset')), limit = Number(url.searchParams.get('limit')), end = Math.min(offset + limit, bytes.length);
      return send(route, { resultRef: decodeURIComponent(result[3]), revision: 1, sha256: hash, bytes: bytes.length, status: result[3] === failedRef ? 'FAILED' : 'SUCCEEDED', contentType: 'text/plain', offset, end, nextOffset: end < bytes.length ? end : null, totalBytes: bytes.length, text: bytes.subarray(offset, end).toString('utf8'), units: 'UTF-8 bytes' });
    }
    const list = /^\/api\/threads\/([^/]+)\/tool-programs$/.exec(url.pathname);
    if (list) {
      const threadId = decodeURIComponent(list[1]), captured = structuredClone(state.models[threadId]);
      await state.holdList?.(threadId);
      if (state.listFailure) return send(route, { error: { code: 'HOST_UNAVAILABLE', message: 'Program status could not be read.' } }, 503);
      return send(route, captured);
    }
    return send(route, { error: { code: 'FIXTURE_UNKNOWN', message: 'Unexpected fixture API request.' } }, 404);
  });
  return state;
}

test('shows program metadata and fixed call details before explicit bounded source inspection', async ({ page }) => {
  const api = await install(page);
  await page.goto('/tool-programs');
  const card = page.getByRole('article', { name: 'JavaScript program program-a' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('repository_read');
  await expect(card).toContainText('1.2 s');
  await expect(card).toContainText('2 / 64');
  await expect(card).toContainText('256 KiB');
  await expect(card).toContainText('Failed');
  expect(api.resultRequests).toHaveLength(0);
  await card.getByRole('button', { name: 'Show calls and sources' }).click();
  await expect(card.getByRole('list', { name: 'Nested calls' })).toContainText('call:0');
  await expect(page.getByText('PRIVATE_NESTED_ERROR_SENTINEL')).toHaveCount(0);
  expect(api.resultRequests).toHaveLength(0);
  await card.getByRole('button', { name: 'Inspect original result', exact: true }).click();
  const inspection = card.getByRole('region', { name: 'Result inspection' });
  await expect(inspection).toContainText('Source failed');
  await expect(inspection.getByLabel('Result page')).toContainText('<img src=x');
  expect(await inspection.locator('img').count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { programInspectionInjected?: boolean }).programInspectionInjected)).toBeUndefined();
  expect(api.resultRequests[0].searchParams.get('limit')).toBe('16384');
  await inspection.getByRole('button', { name: 'Next page' }).click();
  await expect(inspection.getByLabel('Result page')).toContainText('TAIL_OF_RETAINED_RESULT');
  expect(api.resultRequests[1].searchParams.get('offset')).toBe('16384');
  await expect(inspection.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await inspection.getByRole('button', { name: 'Previous page' }).click();
  await expect(inspection.getByLabel('Result page')).toContainText('<img src=x');
  await expect(page.getByRole('button', { name: /Enable|Resume|Run again/i })).toHaveCount(0);
});

test('separates exact-owner Stop and confirmed Reset and never replays a previous cell', async ({ page }) => {
  const api = await install(page);
  await page.goto('/tool-programs');
  const kernel = page.getByRole('article', { name: 'Python kernel kernel-a' });
  await expect(kernel).toContainText('Generation 3');
  await expect(kernel).toContainText('Variables retained');
  await kernel.getByRole('button', { name: 'Stop kernel', exact: true }).click();
  await expect(kernel).toContainText('Stopped');
  expect(api.commands).toHaveLength(1);
  expect(api.commands[0]).toMatchObject({ type: 'pythonKernel.stop', threadId: 'thread-a', payload: { kernelId: 'kernel-a', owner: owner(), generation: 3 } });
  await kernel.getByRole('button', { name: 'Reset kernel', exact: true }).click();
  const confirm = kernel.getByRole('region', { name: 'Confirm kernel reset' });
  await expect(confirm).toContainText(notice);
  expect(api.commands).toHaveLength(1);
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(api.commands).toHaveLength(1);
  await kernel.getByRole('button', { name: 'Reset kernel', exact: true }).click();
  await kernel.getByRole('button', { name: 'Confirm reset', exact: true }).click();
  await expect(kernel).toContainText('Generation 4');
  await expect(kernel).toContainText('No retained variables');
  expect(api.commands.map(command => command.type)).toEqual(['pythonKernel.stop', 'pythonKernel.reset']);
  expect(api.commands[1].payload).toEqual({ kernelId: 'kernel-a', owner: owner(), generation: 3 });
});

test('preserves the exact replay failure, surfaces revoked inspection and cancels only the selected program', async ({ page }) => {
  const api = await install(page, { resultFailure: true });
  await page.goto('/tool-programs');
  const card = page.getByRole('article', { name: 'JavaScript program program-a' });
  await expect(card).toContainText('Replay stopped: call:2 changed its arguments.');
  await card.getByRole('button', { name: 'Inspect original result', exact: true }).click();
  await expect(card.getByRole('alert')).toHaveText('This source grant is no longer available.');
  expect(api.commands).toEqual([]);
  api.models['thread-a'].programs[0].program.state = 'RUNNING';
  api.models['thread-a'].programs[0].program.error = null;
  await page.getByRole('button', { name: 'Refresh program status' }).click();
  await card.getByRole('button', { name: 'Stop program', exact: true }).click();
  await expect(card).toContainText('Cancelled');
  expect(api.commands).toHaveLength(1);
  expect(api.commands[0]).toMatchObject({ type: 'toolProgram.cancel', threadId: 'thread-a', payload: { programId: 'program-a', owner: owner() } });
});

test('ignores a late list response after switching threads', async ({ page }) => {
  let release!: () => void, requested = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  await install(page, { holdList: threadId => { if (threadId === 'thread-a') { requested = true; return held; } return Promise.resolve(); } });
  await page.goto('/tool-programs');
  await expect.poll(() => requested).toBe(true);
  await page.getByRole('button', { name: 'Thread B', exact: true }).click();
  await expect(page.getByRole('article', { name: 'JavaScript program program-b' })).toBeVisible();
  release();
  await page.getByRole('button', { name: 'Refresh program status' }).click();
  await expect(page.getByRole('article', { name: 'JavaScript program program-a' })).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Python kernel kernel-a' })).toHaveCount(0);
});

test('clears pending private inspection and reset confirmation on a same-thread owner change', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const api = await install(page, { holdResult: () => held });
  await page.goto('/tool-programs');
  await page.getByRole('button', { name: 'Inspect original result', exact: true }).click();
  await expect.poll(() => api.resultRequests.length).toBe(1);
  await page.getByRole('button', { name: 'Reset kernel', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Confirm kernel reset' })).toBeVisible();
  await page.getByRole('button', { name: 'Rebind owner', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Result inspection' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Confirm kernel reset' })).toHaveCount(0);
  release();
  await page.getByRole('button', { name: 'Refresh program status' }).click();
  await expect(page.getByLabel('Result page')).toHaveCount(0);
  expect(api.commands).toEqual([]);
});

test('keeps controls and long references inside a narrow viewport and exposes list errors', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const api = await install(page);
  await page.goto('/tool-programs');
  await page.getByRole('button', { name: 'Show calls and sources' }).click();
  const panel = page.getByRole('region', { name: 'Tool programs' });
  await expect(panel).toBeVisible();
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await expect(page.getByRole('button', { name: 'Reset kernel', exact: true })).toBeVisible();
  api.listFailure = true;
  await page.getByRole('button', { name: 'Refresh program status' }).click();
  await expect(page.getByRole('alert')).toHaveText('Program status could not be read.');
});

test('advances active elapsed time while waiting and freezes the host value after settlement', async ({ page }) => {
  const initial = Date.parse('2026-11-15T12:00:00.000Z');
  await page.clock.install({ time: new Date(initial - 1000) });
  await page.clock.pauseAt(new Date(initial));
  const api = await install(page);
  const program = api.models['thread-a'].programs[0].program;
  Object.assign(program, { state: 'PREPARED', createdAt: initial, startedAt: null, deadlineAt: null, elapsedMs: 0, error: null });
  await page.goto('/tool-programs');
  const card = page.getByRole('article', { name: 'JavaScript program program-a' });
  const value = card.locator('.tool-program-metrics > div').filter({ has: page.getByText('Elapsed', { exact: true }) }).locator('dd');
  await expect(value).toHaveText('0.0 s');
  await page.clock.fastForward(2000);
  await expect(value).toHaveText('0.0 s');

  Object.assign(program, { state: 'RUNNING', startedAt: initial + 2000, deadlineAt: initial + 32000 });
  await page.getByRole('button', { name: 'Refresh program status' }).click();
  await expect(card).toContainText('Running');
  await page.clock.fastForward(2500);
  await expect(value).toHaveText('2.5 s');
  expect(program.elapsedMs).toBe(0);

  program.state = 'WAITING_TOOL';
  await page.getByRole('button', { name: 'Refresh program status' }).click();
  await expect(card).toContainText('Waiting for tool');
  await page.clock.fastForward(1000);
  await expect(value).toHaveText('3.5 s');

  Object.assign(program, { state: 'SUCCEEDED', elapsedMs: 3600 });
  await page.getByRole('button', { name: 'Refresh program status' }).click();
  await expect(value).toHaveText('3.6 s');
  await page.clock.fastForward(2000);
  await expect(value).toHaveText('3.6 s');
  expect(api.commands).toEqual([]);
  expect(api.resultRequests).toEqual([]);
});
