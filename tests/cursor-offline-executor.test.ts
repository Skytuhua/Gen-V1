import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const probe = async (mode: string) => {
  const { runCursorOfflineProbe } = await import(pathToFileURL(resolve('scripts/cursor-offline-executor.mjs')).href);
  return runCursorOfflineProbe({ hostRoot: '.', mode });
};

it('self-tests the offline boundary in a separate child before importing any SDK', async () => {
  const { result } = await probe('guard');
  expect(result.phase).toBe('guard-self-test-passed');
  expect(result.guardSelfTest.passed).toBe(true);
  expect(result.guardSelfTest.blockedPrimitives).toEqual(expect.arrayContaining(['socket.createConnection', 'socket.prototype.connect', 'server.listen', 'tls.connect', 'http.get', 'https.get', 'http2.connect', 'dns.lookup', 'dns.Resolver.resolve4', 'dns.promises.Resolver.resolve4', 'udp.send', 'process.spawn', 'worker.create', 'websocket.create', 'binding.tcp_wrap', 'native-addon', 'fetch']));
  expect(result.loadedSdkModules).toEqual([]);
  expect(result.loadedBindings).toEqual([]);
});

it('loads the actual lazy local executor and native parser, then fails closed before account/inference transport', async () => {
  const { result } = await probe('send');
  expect(result.guardSelfTest.passed).toBe(true);
  expect(result.phase).toBe('run-error');
  expect(result.parser).toEqual({ rootType: 'program', hasError: false });
  expect(result.loadedSdkModules).toEqual(expect.arrayContaining(['index.js', '704.js', '748.js']));
  expect(result.loadedBindings).toHaveLength(2);
  expect(result.metadataFixtures).toBeGreaterThan(0);
  expect(result.deniedCalls).toEqual(expect.arrayContaining([{ kind: 'fetch', detail: 'https://api2.cursor.sh/auth/exchange_user_api_key' }]));
  expect(result.nativeResult).toMatchObject({ status: 'error', error: { message: expect.stringContaining('Offline boundary denied fetch') } });
  expect(result.frames.some((frame: { type: string }) => ['assistant', 'tool_call'].includes(frame.type))).toBe(false);
  expect(result.inference).toBe(false);
}, 20_000);

it('rejects unknown probe modes before spawning an SDK worker', async () => {
  await expect(probe('live')).rejects.toThrow('Unsupported offline probe mode');
});
