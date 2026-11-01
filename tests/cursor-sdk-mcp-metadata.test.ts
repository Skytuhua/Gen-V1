import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const load = () => import(pathToFileURL(resolve('scripts/cursor-mcp-metadata-probe.mjs')).href);
const endpoint = { url: 'http://127.0.0.1:12345/mcp', authorization: 'Bearer synthetic-metadata-token' };
const envelope = (message: unknown) => ({ url: endpoint.url, method: 'POST', headers: { authorization: endpoint.authorization, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(message) });
const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

it('admits only exact authenticated bounded metadata envelopes before any HTTP request', async () => {
  const { validateMetadataEnvelope } = await load();
  expect(validateMetadataEnvelope(envelope(list), endpoint)).toEqual(list);
  const initialize = { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25', clientInfo: { name: 'Cursor', version: '1.0.0' }, capabilities: { elicitation: { form: {} } } } };
  expect(validateMetadataEnvelope(envelope(initialize), endpoint)).toEqual(initialize);
  expect(validateMetadataEnvelope(envelope({ jsonrpc: '2.0', method: 'notifications/initialized' }), endpoint).method).toBe('notifications/initialized');
  const attempts = [
    { ...envelope(list), url: endpoint.url + '?other=1' },
    { ...envelope(list), url: endpoint.url.replace('127.0.0.1', 'localhost') },
    { ...envelope(list), method: 'GET' },
    { ...envelope(list), headers: { ...envelope(list).headers, authorization: 'Bearer wrong' } },
    { ...envelope(list), headers: { ...envelope(list).headers, origin: 'http://foreign.invalid' } },
    { ...envelope(list), body: ' '.repeat(16385) },
    envelope([list]), envelope({ ...list, method: 'tools/call', params: { name: 'verification_echo', arguments: {} } }),
    envelope({ ...list, params: { cursor: 'next-page' } }), envelope({ ...list, extra: true }),
    envelope({ ...initialize, params: { ...initialize.params, capabilities: { sampling: {} } } }),
  ];
  for (const attempt of attempts) expect(() => validateMetadataEnvelope(attempt, endpoint)).toThrow('Metadata boundary denied');
});

it('self-tests child transport denial and parent broker rejection without importing the SDK', async () => {
  const { runCursorMcpMetadataProbe } = await load();
  const receipt = await runCursorMcpMetadataProbe({ hostRoot: '.', mode: 'guard' });
  expect(receipt.result.phase).toBe('guard-self-test-passed');
  expect(receipt.allChecksPassed).toBe(true);
  expect(receipt.result.guardSelfTest.passed).toBe(true);
  expect(receipt.result.guardSelfTest.blockedPrimitives).toEqual(expect.arrayContaining(['socket.createConnection', 'socket.prototype.connect', 'server.listen', 'tls.connect', 'http.get', 'https.get', 'http2.connect', 'dns.lookup', 'dns.Resolver.resolve4', 'dns.promises.Resolver.resolve4', 'udp.send', 'process.spawn', 'worker.create', 'websocket.create', 'binding.tcp_wrap', 'native-addon', 'fetch', 'metadata-envelope']));
  expect(receipt.broker.rejectedSelfTests).toBeGreaterThanOrEqual(6);
  expect(receipt.broker.requests).toEqual([]);
  expect(receipt.executionCallbacks).toBe(0);
  expect(receipt.endpoints.every((endpoint: { closed: boolean }) => endpoint.closed)).toBe(true);
  expect(receipt.childExited).toBe(true);
  expect(receipt.result.loadedSdkModules).toEqual([]);
  expect(receipt.result.loadedBindings).toEqual([]);
});

it('observes actual SDK send metadata through production gate and HostMcp with no tool execution or auth transport', async () => {
  const { runCursorMcpMetadataProbe, syntheticTools } = await load();
  const receipt = await runCursorMcpMetadataProbe({ hostRoot: '.', mode: 'send' });
  expect(receipt.result.phase).toBe('run-error');
  expect(receipt.allChecksPassed).toBe(true);
  expect(receipt.sdkToolListAcceptance).toBe('not observed; host schema/names recorded at guarded fetch response delivery');
  expect(receipt.originalProbeSha256).toBe('7e6b85c082260bba79bbe3fccc1504ab50f7ddeb06ac9a657dac54e38fea9013');
  expect(receipt.result.error).toBeUndefined();
  expect(receipt.result.guardSelfTest.passed).toBe(true);
  expect(receipt.result.parser).toEqual({ rootType: 'program', hasError: false });
  expect(receipt.result.loadedBindings).toHaveLength(2);
  expect(receipt.result.loadedSdkModules).toEqual(expect.arrayContaining(['index.js', '704.js', '748.js']));
  expect(receipt.broker.requests.map((request: { method: string }) => request.method)).toEqual(expect.arrayContaining(['initialize', 'tools/list']));
  const listing = receipt.broker.requests.find((request: { method: string }) => request.method === 'tools/list');
  expect(listing.status).toBe(200);
  expect(listing.response.result.tools).toEqual(syntheticTools.map((tool: { name: string; description: string; parameters: unknown }) => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters })));
  expect(receipt.result.metadataResponses).toEqual(expect.arrayContaining([expect.objectContaining({ method: 'tools/list', status: 200, names: syntheticTools.map((tool: { name: string }) => tool.name) })]));
  expect(receipt.result.deniedCalls).toEqual(expect.arrayContaining([{ kind: 'fetch', detail: 'https://api2.cursor.sh/auth/exchange_user_api_key' }]));
  expect(receipt.result.deniedCalls.filter((call: { kind: string }) => call.kind.startsWith('process.'))).toHaveLength(3);
  expect(receipt.result.nativeResult.status).toBe('error');
  expect(receipt.result.frames.some((frame: { type: string }) => ['assistant', 'tool_call'].includes(frame.type))).toBe(false);
  expect(receipt.executionCallbacks).toBe(0);
  expect(receipt.beforeToolAttempts).toBe(1);
  expect(receipt.sdkBeforeToolAttempts).toBe(0);
  expect(receipt.directNegatives).toHaveLength(4);
  expect(receipt.directNegatives.every((attempt: { passed: boolean }) => attempt.passed)).toBe(true);
  expect(receipt.route).toBe('mediated SDK fetch -> IPC metadata broker -> real parent HTTP -> actual gate -> HostMcp');
  expect(receipt.closed).toBe(true);
  expect(receipt.childExited).toBe(true);
  expect(receipt.endpoints.every((endpoint: { closed: boolean }) => endpoint.closed)).toBe(true);
  expect(receipt.result.pendingMetadata).toBe(0);
  expect(receipt.broker.denied).toEqual([]);
}, 25_000);

it('rejects unsupported modes before creating endpoints or spawning a child', async () => {
  const { runCursorMcpMetadataProbe } = await load();
  await expect(runCursorMcpMetadataProbe({ hostRoot: '.', mode: 'live' })).rejects.toThrow('Unsupported metadata probe mode');
});
