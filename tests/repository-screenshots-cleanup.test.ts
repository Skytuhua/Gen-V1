import type { ChildProcess } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { terminateProcessTree } from '../packages/runtime-pi/process-tree.ts';

const fixture = vi.hoisted(() => ({ server: undefined as ChildProcess | undefined }));
const browserCloseError = new Error('Screenshot browser connection closed unexpectedly');

vi.mock('node:child_process', async importOriginal => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return {
    ...original,
    spawn: (...args: Parameters<typeof original.spawn>) => fixture.server = original.spawn(...args),
  };
});

vi.mock('@playwright/test', async importOriginal => {
  const original = await importOriginal<typeof import('@playwright/test')>();
  return {
    ...original,
    chromium: {
      launch: async () => ({
        newContext: async () => { throw new Error('Screenshot capture stopped'); },
        close: async () => { throw browserCloseError; },
      }),
    },
  };
});

afterEach(async () => {
  if (fixture.server) await terminateProcessTree(fixture.server);
});

it('stops the owned screenshot server even when browser close rejects', async () => {
  await expect(import('../scripts/capture-repository-screenshots.ts')).rejects.toBe(browserCloseError);
  const server = fixture.server!;
  expect(server.pid).toBeGreaterThan(0);
  expect(server.exitCode ?? server.signalCode).not.toBeNull();
});
