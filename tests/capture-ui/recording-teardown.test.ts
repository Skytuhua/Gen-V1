import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { BrowserServer, Page } from '@playwright/test';
import { beforeEach, expect, it, vi } from 'vitest';
import { recordWindow } from '../../scripts/review-capture.ts';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it.each(['Page.stopScreencast', 'detach'])('finishes the encoder when compositor %s rejects', async failedStep => {
  const error = new Error('compositor disconnected');
  const calls: string[] = [];
  const encoder = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stderr: new PassThrough() });
  encoder.stdin.resume();
  encoder.stdin.once('finish', () => { calls.push('encoder finished'); encoder.emit('close', 0); });
  vi.mocked(spawn).mockReturnValue(encoder as unknown as ChildProcess);
  const session = {
    on() {},
    async send(method: string) {
      calls.push(method);
      if (method === failedStep) throw error;
    },
    async detach() {
      calls.push('detach');
      if (failedStep === 'detach') throw error;
    },
  };
  const page = {
    async bringToFront() {},
    context() { return { async newCDPSession() { return session; } }; },
    async screenshot() { return Buffer.from('fixture'); },
    async addInitScript() {},
    async evaluate() {},
  } as unknown as Page;

  const stop = await recordWindow({} as BrowserServer, page, 'fixture.mp4');
  await expect(stop()).rejects.toBe(error);
  expect(calls).toEqual(['Page.startScreencast', 'Page.stopScreencast', 'detach', 'encoder finished']);
});
