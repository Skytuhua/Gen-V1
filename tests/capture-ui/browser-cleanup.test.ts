import { chromium, type Browser, type BrowserContext, type BrowserServer } from '@playwright/test';
import { afterEach, expect, it, vi } from 'vitest';
import { closeCapture, openCaptureBrowser } from '../../scripts/review-capture.ts';

afterEach(() => vi.restoreAllMocks());

it('closes the browser and server when closing the capture context fails', async () => {
  const error = new Error('capture context failed to close');
  const calls: string[] = [];
  const context = { async close() { calls.push('context'); throw error; } } as unknown as BrowserContext;
  const browser = { async close() { calls.push('browser'); } } as unknown as Browser;
  const server = { async close() { calls.push('server'); } } as unknown as BrowserServer;
  await expect(closeCapture({ context, browser, server })).rejects.toBe(error);
  expect(calls).toEqual(['context', 'browser', 'server']);
});

it('closes the launched server when the browser cannot connect', async () => {
  const error = new Error('capture browser failed to connect');
  const close = vi.fn(async () => {});
  const server = { wsEndpoint: () => 'ws://capture-fixture', close } as unknown as BrowserServer;
  vi.spyOn(chromium, 'launchServer').mockResolvedValue(server);
  vi.spyOn(chromium, 'connect').mockRejectedValue(error);
  await expect(openCaptureBrowser()).rejects.toBe(error);
  expect(close).toHaveBeenCalledTimes(1);
});

it('closes all acquired resources when creating the capture page fails', async () => {
  const error = new Error('capture page failed to open');
  const calls: string[] = [];
  const context = {
    async newPage() { throw error; },
    async close() { calls.push('context'); },
  } as unknown as BrowserContext;
  const browser = { async newContext() { return context; }, async close() { calls.push('browser'); } } as unknown as Browser;
  const server = { wsEndpoint: () => 'ws://capture-fixture', async close() { calls.push('server'); } } as unknown as BrowserServer;
  vi.spyOn(chromium, 'launchServer').mockResolvedValue(server);
  vi.spyOn(chromium, 'connect').mockResolvedValue(browser);
  await expect(openCaptureBrowser()).rejects.toBe(error);
  expect(calls).toEqual(['context', 'browser', 'server']);
});

it('reports the startup and teardown errors when a failed connection also fails to close', async () => {
  const startupError = new Error('capture connection failed');
  const closeError = new Error('capture server failed to close');
  const server = { wsEndpoint: () => 'ws://capture-fixture', async close() { throw closeError; } } as unknown as BrowserServer;
  vi.spyOn(chromium, 'launchServer').mockResolvedValue(server);
  vi.spyOn(chromium, 'connect').mockRejectedValue(startupError);
  await expect(openCaptureBrowser()).rejects.toMatchObject({ name: 'AggregateError', errors: [startupError, closeError] });
});
