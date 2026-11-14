import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn }));

afterEach(() => {
  vi.restoreAllMocks();
  spawn.mockReset();
});

it('reports a failed launch and a sibling exit failure without an uncaught exception', async () => {
  vi.resetModules();
  const children = Array.from({ length: 3 }, () => new EventEmitter());
  children.forEach(child => spawn.mockReturnValueOnce(child));
  const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  const script = '../scripts/build.mjs';
  const built = import(script);
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(3));
  const notFound = Object.assign(new Error('spawn pnpm ENOENT'), { code: 'ENOENT' });
  let uncaught: unknown;
  try { children[2].emit('error', notFound); } catch (error) { uncaught = error; }
  children[2].emit('close', -2, null);
  children[0].emit('close', 7, null);
  children[1].emit('close', 0, null);
  await built;
  expect(uncaught).toBeUndefined();
  expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/build step failed.*build-widgets\.mjs/));
  expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/build step failed.*ENOENT.*pnpm/));
  expect(exit).toHaveBeenCalledWith(1);
});
