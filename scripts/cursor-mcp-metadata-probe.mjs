import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire, registerHooks, syncBuiltinESMExports } from 'node:module';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = fileURLToPath(import.meta.url);
const marker = 'CURSOR_MCP_METADATA_RESULT ';
const sdkVersion = '1.0.38';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const route = 'mediated SDK fetch -> IPC metadata broker -> real parent HTTP -> actual gate -> HostMcp';
export const syntheticTools = [{ name: 'verification_echo', description: 'Synthetic metadata fixture. Execution is forbidden.', parameters: { type: 'object', properties: { text: { type: 'string', maxLength: 32 }, options: { type: 'object', properties: { format: { type: 'string', enum: ['plain', 'compact'] } }, additionalProperties: false } }, required: ['text'], additionalProperties: false } }];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const empty = value => object(value) && Object.keys(value).length === 0;
const version = value => value === '2025-11-25';
const boundaryError = () => Object.assign(new Error('Metadata boundary denied envelope.'), { code: 'CURSOR_METADATA_DENIED' });

/** Both sides validate the same small protocol; no arbitrary URL or tool-call proxy. */
export function validateMetadataEnvelope(envelope, endpoint) {
  const fail = () => { throw boundaryError(); };
  if (!keys(envelope, ['url', 'method', 'headers', 'body']) || envelope.url !== endpoint.url || envelope.method !== 'POST' || typeof envelope.body !== 'string' || Buffer.byteLength(envelope.body) > 16_384) fail();
  const headers = envelope.headers;
  if (!keys(headers, ['authorization', 'content-type', 'accept', 'user-agent', 'mcp-protocol-version']) || headers.authorization !== endpoint.authorization || headers['content-type'] !== 'application/json' || !['application/json, text/event-stream', 'application/json,text/event-stream'].includes(headers.accept) || (headers['user-agent'] !== undefined && headers['user-agent'] !== 'Cursor/1.0.0') || (headers['mcp-protocol-version'] !== undefined && !version(headers['mcp-protocol-version']))) fail();
  let message; try { message = JSON.parse(envelope.body); } catch { fail(); }
  if (!keys(message, ['jsonrpc', 'id', 'method', 'params']) || message.jsonrpc !== '2.0') fail();
  if (message.method === 'notifications/initialized') {
    if ('id' in message || ('params' in message && !empty(message.params))) fail();
  } else {
    if (!(Number.isSafeInteger(message.id) && message.id >= 0) && !(typeof message.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(message.id))) fail();
    if (message.method === 'initialize') {
      const params = message.params;
      if (!keys(params, ['protocolVersion', 'capabilities', 'clientInfo']) || !version(params.protocolVersion) || !keys(params.clientInfo, ['name', 'version']) || params.clientInfo.name !== 'Cursor' || params.clientInfo.version !== '1.0.0' || !keys(params.capabilities, ['elicitation']) || !keys(params.capabilities.elicitation, ['form']) || !empty(params.capabilities.elicitation.form)) fail();
    } else if (!['tools/list', 'ping'].includes(message.method) || ('params' in message && !empty(message.params))) fail();
  }
  return message;
}

/** Verification-only parent. Its only HTTP destination is its newly owned gate. */
export async function runCursorMcpMetadataProbe({ hostRoot, node = process.execPath, outputDirectory, mode = 'send' }) {
  if (!['send', 'guard'].includes(mode)) throw new Error('Unsupported metadata probe mode.');
  const originalProbeSha256 = sha(await readFile(join(dirname(script), 'cursor-offline-executor.mjs')));
  if (originalProbeSha256 !== '7e6b85c082260bba79bbe3fccc1504ab50f7ddeb06ac9a657dac54e38fea9013') throw new Error('Frozen original offline probe changed.');
  const host = await realpath(resolve(hostRoot)), nodePath = await realpath(resolve(node));
  const require = createRequire(join(host, 'package.json'));
  const sdkRoot = dirname(dirname(dirname(require.resolve('@cursor/sdk'))));
  const sdkRequire = createRequire(require.resolve('@cursor/sdk'));
  const nativeRoot = dirname(sdkRequire.resolve('@cursor/sdk-win32-x64/package.json'));
  for (const [root, name] of [[sdkRoot, '@cursor/sdk'], [nativeRoot, '@cursor/sdk-win32-x64']]) {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    if (manifest.name !== name || manifest.version !== sdkVersion) throw new Error('Metadata probe requires the pinned SDK/native distribution.');
  }
  const productionFiles = ['cursor-mcp.ts', 'mcp.ts', 'internal.ts'];
  const providerModules = await Promise.all(productionFiles.map(async name => ({ path: await realpath(join(host, 'packages/runtime-official', name)), sha256: sha(await readFile(join(host, 'packages/runtime-official', name))) })));
  const { createHostMcp } = await import(pathToFileURL(providerModules[1].path).href);
  const { createCursorMcpGate } = await import(pathToFileURL(providerModules[0].path).href);
  const profile = await mkdtemp(join(tmpdir(), 'cursor-mcp-metadata-'));
  await Promise.all(['home', 'tmp', 'task', 'history', 'AppData/Roaming', 'AppData/Local', 'config', 'cache', 'state'].map(part => mkdir(join(profile, part), { recursive: true })));
  const env = {};
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PATH', 'Path']) if (process.env[key] !== undefined) env[key] = process.env[key];
  Object.assign(env, { HOME: join(profile, 'home'), USERPROFILE: join(profile, 'home'), APPDATA: join(profile, 'AppData/Roaming'), LOCALAPPDATA: join(profile, 'AppData/Local'), TMP: join(profile, 'tmp'), TEMP: join(profile, 'tmp'), XDG_CONFIG_HOME: join(profile, 'config'), XDG_CACHE_HOME: join(profile, 'cache'), XDG_STATE_HOME: join(profile, 'state') });
  const bindings = await Promise.all(['vendor/tree-sitter/binding.node', 'vendor/tree-sitter-bash/binding.node'].map(async name => ({ path: await realpath(join(nativeRoot, name)), sha256: sha(await readFile(join(nativeRoot, name))) })));
  const sdkModules = await Promise.all(['index.js', '704.js', '748.js'].map(async name => ({ path: await realpath(join(sdkRoot, 'dist/esm', name)), sha256: sha(await readFile(join(sdkRoot, 'dist/esm', name))) })));
  let executionCallbacks = 0, beforeToolAttempts = 0, active = true, gate, child, closed = false;
  const endpoints = [];
  const broker = { requests: [], denied: [], rejectedSelfTests: 0 }, directNegatives = [];
  const upstream = await createHostMcp({ ctx: {}, current: () => active, tools: syntheticTools, onTool: async () => { executionCallbacks++; throw new Error('Verification never executes tools.'); } });
  let result, stderr = '';
  try {
    gate = await createCursorMcpGate(upstream, syntheticTools.map(tool => tool.name), async () => { beforeToolAttempts++; throw new Error('Verification never admits tools/call.'); });
    endpoints.push({ role: 'gate', url: gate.url }, { role: 'host', url: upstream.url });
    const endpoint = { url: gate.url, authorization: gate.headers.Authorization };
    for (const [name, url, method, authorization, body, expected] of [
      ['wrong-authorization', gate.url, 'POST', 'Bearer wrong', '{}', 401],
      ['wrong-method', gate.url, 'GET', endpoint.authorization, undefined, 403],
      ['wrong-path', gate.url + '/other', 'POST', endpoint.authorization, '{}', 403],
      ['tools-call-gate-denial', gate.url, 'POST', endpoint.authorization, JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name: 'verification_echo', arguments: { text: 'forbidden' } } }), 403],
    ]) {
      const response = await fetch(url, { method, headers: { Authorization: authorization, 'content-type': 'application/json' }, body, redirect: 'error', signal: AbortSignal.timeout(2000) });
      await response.arrayBuffer(); directNegatives.push({ name, status: response.status, expected, passed: response.status === expected });
      if (response.status !== expected) throw new Error('Direct production gate negative failed: ' + name);
    }
    child = spawn(nodePath, [script, '--child'], { cwd: profile, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    const pending = new Set();
    let messageCount = 0, stdout = '', outputBytes = 0;
    child.on('message', value => {
      const work = (async () => {
        const reply = data => { if (child.connected) child.send({ type: 'metadata-response', id: value?.id, ...data }, error => { if (error && broker.denied.length < 32) broker.denied.push({ code: 'IPC_REPLY_CLOSED', message: error.message }); }); };
        try {
          if (++messageCount > 32 || !keys(value, ['type', 'id', 'envelope', 'selfTest']) || value.type !== 'metadata' || !Number.isSafeInteger(value.id) || value.id < 1) throw boundaryError();
          const message = validateMetadataEnvelope(value.envelope, endpoint);
          if (value.selfTest || mode !== 'send' || broker.requests.length >= 12) throw boundaryError();
          const record = { method: message.method, request: message, requestBytes: Buffer.byteLength(value.envelope.body), authorization: 'exact owned token validated', status: null, response: null };
          broker.requests.push(record);
          const response = await fetch(endpoint.url, { method: 'POST', headers: value.envelope.headers, body: value.envelope.body, redirect: 'error', signal: AbortSignal.timeout(2000) });
          const reader = response.body?.getReader(); let bytes = 0; const chunks = [];
          if (reader) for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 65_536) { await reader.cancel(); throw new Error('Metadata response exceeded bound.'); } chunks.push(Buffer.from(part.value)); }
          const body = Buffer.concat(chunks).toString('utf8');
          record.status = response.status; record.responseBytes = bytes;
          if (body) { try { record.response = JSON.parse(body); } catch { throw new Error('Metadata host response was not JSON.'); } }
          reply({ response: { status: response.status, contentType: response.headers.get('content-type'), body } });
        } catch (error) {
          if (value?.selfTest && error.code === 'CURSOR_METADATA_DENIED') broker.rejectedSelfTests++;
          else if (broker.denied.length < 32) broker.denied.push({ code: error.code ?? 'BROKER_ERROR', message: error.message });
          reply({ error: { code: error.code ?? 'BROKER_ERROR', message: error.message } });
        }
      })();
      pending.add(work); void work.finally(() => pending.delete(work));
    });
    child.stdin.end(JSON.stringify({ mode, profile, sdkRoot: await realpath(sdkRoot), nativeRoot: await realpath(nativeRoot), bindings, endpoint }));
    result = await new Promise((accept, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('Owned metadata child exceeded its 20-second deadline.')); }, 20_000);
      for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { outputBytes += chunk.length; if (outputBytes > 256 * 1024) { child.kill(); return; } if (stream === child.stdout) stdout += String(chunk); else stderr += String(chunk); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); const line = stdout.split(/\r?\n/).find(value => value.startsWith(marker)); if (code !== 0 || !line) reject(new Error(`Metadata child exited ${code}; result missing. ${stderr.slice(-1200)}`)); else { try { accept(JSON.parse(line.slice(marker.length))); } catch (error) { reject(error); } } });
    });
    await Promise.all(pending);
    if (await realpath(result.node.path) !== nodePath) throw new Error('Metadata probe used an unexpected Node binary.');
  } finally {
    active = false;
    if (child && child.exitCode === null && child.signalCode === null) { child.kill(); await new Promise(yes => child.once('close', yes)); }
    await gate?.close(); await upstream.close(); closed = true;
  }
  // Exact owned URLs only; a new socket avoids fetch keepalive-pool ambiguity.
  for (const endpoint of endpoints) {
    const url = new URL(endpoint.url);
    await new Promise(yes => {
      const socket = createConnection({ host: '127.0.0.1', port: Number(url.port) });
      const finish = code => { endpoint.closed = code === 'ECONNREFUSED'; endpoint.closeProbeCode = code; socket.destroy(); yes(); };
      socket.setTimeout(1000); socket.once('error', error => finish(error.code)); socket.once('connect', () => finish('UNEXPECTED_CONNECTED')); socket.once('timeout', () => finish('TIMEOUT'));
    });
  }
  const listed = broker.requests.find(request => request.method === 'tools/list');
  const sdkListed = result.metadataResponses.find(response => response.method === 'tools/list');
  const checks = {
    guardSelfTests: result.guardSelfTest?.passed === true && broker.rejectedSelfTests === 6,
    directGateNegatives: directNegatives.length === 4 && directNegatives.every(test => test.passed),
    noExecution: executionCallbacks === 0 && beforeToolAttempts === 1,
    closed: closed && child.exitCode === 0 && endpoints.length === 2 && endpoints.every(endpoint => endpoint.closed),
    settled: !result.error && result.pendingMetadata === 0 && broker.denied.length === 0,
    expectedMode: mode === 'guard' ? result.phase === 'guard-self-test-passed' && result.loadedSdkModules.length === 0 && result.loadedBindings.length === 0 && broker.requests.length === 0 : result.phase === 'run-error' && result.nativeResult?.status === 'error',
  };
  if (mode === 'send') Object.assign(checks, {
    realLazySdkLoaded: ['index.js', '704.js', '748.js'].every(name => result.loadedSdkModules.includes(name)),
    nativeParsers: result.loadedBindings.length === 2 && result.parser?.rootType === 'program' && result.parser.hasError === false,
    metadataPhases: JSON.stringify(broker.requests.map(request => [request.method, request.status])) === JSON.stringify([['initialize', 200], ['notifications/initialized', 202], ['tools/list', 200]]),
    exactHostSchema: JSON.stringify(listed?.response?.result?.tools) === JSON.stringify(syntheticTools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters }))),
    fetchResponseDelivery: sdkListed?.status === 200 && JSON.stringify(sdkListed.response) === JSON.stringify(listed?.response),
    authDenied: result.deniedCalls.some(call => call.kind === 'fetch' && call.detail === 'https://api2.cursor.sh/auth/exchange_user_api_key'),
    bootstrapProcessesDenied: result.deniedCalls.filter(call => call.kind.startsWith('process.')).length === 3,
    noAssistantOrToolFrames: result.frames.every(frame => !['assistant', 'tool_call'].includes(frame.type)),
  });
  const receipt = { createdAt: new Date().toISOString(), mode, route, hostRoot: host, profile, sdkVersion, sdkRoot: await realpath(sdkRoot), providerModules, sdkModules, bindingCustody: bindings, scriptSha256: sha(await readFile(script)), originalProbeSha256, parentNode: { path: process.execPath, version: process.versions.node }, node: { ...result.node, sha256: sha(await readFile(nodePath)) }, broker, directNegatives, endpoints, executionCallbacks, beforeToolAttempts, sdkBeforeToolAttempts: beforeToolAttempts - 1, closed, childExited: child.exitCode === 0, checks, allChecksPassed: Object.values(checks).every(Boolean), sdkToolListAcceptance: 'not observed; host schema/names recorded at guarded fetch response delivery', result, stderr: stderr.slice(-4000), limits: ['Actual SDK pre-auth Agent.send metadata only; synthetic credentials/catalog/tools. Auth and inference transport denied.', 'SDK fetch is mediated over inherited IPC; actual parent HTTP traverses production gate and HostMcp. No child socket traffic is admitted.', 'Host schema/name observations are at the guarded fetch response boundary; SDK parser acceptance/tool readiness is not observed.', 'Node API guards and trusted hash-bound parsers are not an OS sandbox or hostile native-code containment.', 'No successful authenticated turn, model inference, host tool execution or active remote cancellation is proved.'] };
  if (outputDirectory) { await mkdir(outputDirectory, { recursive: true }); await writeFile(join(outputDirectory, 'verification.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' }); }
  return receipt;
}

async function childMain() {
  let raw = ''; for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 32_768) throw new Error('Metadata configuration exceeded bound.'); }
  const input = JSON.parse(raw), require = createRequire(import.meta.url);
  const events = [], modules = [], loadedBindings = [], metadataResponses = [];
  const record = (kind, detail = '') => { if (events.length < 100) events.push({ kind, detail }); };
  const denied = (kind, detail = '') => { record(kind, detail); throw Object.assign(new Error(`Metadata boundary denied ${kind}`), { code: 'CURSOR_METADATA_DENIED' }); };
  const replace = (module, key, kind) => { if (typeof module[key] === 'function') module[key] = function () { return denied(kind); }; };
  const net = require('node:net'), tls = require('node:tls'), http = require('node:http'), https = require('node:https'), http2 = require('node:http2'), dns = require('node:dns'), dgram = require('node:dgram'), processes = require('node:child_process'), workers = require('node:worker_threads');
  for (const name of ['connect', 'createConnection']) replace(net, name, 'socket.' + name);
  replace(net.Socket.prototype, 'connect', 'socket.prototype.connect'); replace(net.Server.prototype, 'listen', 'server.listen'); replace(tls, 'connect', 'tls.connect');
  for (const [module, prefix] of [[http, 'http'], [https, 'https']]) for (const name of ['request', 'get']) replace(module, name, prefix + '.' + name);
  replace(http2, 'connect', 'http2.connect');
  for (const key of Object.keys(dns)) if (/^(lookup|resolve|reverse)/.test(key)) replace(dns, key, 'dns.' + key);
  for (const key of Object.keys(dns.promises)) if (/^(lookup|resolve|reverse)/.test(key)) replace(dns.promises, key, 'dns.promises.' + key);
  for (const [prototype, prefix] of [[dns.Resolver.prototype, 'dns.Resolver'], [dns.promises.Resolver.prototype, 'dns.promises.Resolver']]) for (const key of Object.getOwnPropertyNames(prototype)) if (/^(resolve|reverse)/.test(key)) replace(prototype, key, prefix + '.' + key);
  for (const key of ['send', 'connect', 'bind']) replace(dgram.Socket.prototype, key, 'udp.' + key);
  for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) if (typeof processes[key] === 'function') processes[key] = function (command, ...args) {
    const options = args.find(value => value && typeof value === 'object' && !Array.isArray(value));
    return denied('process.' + key, JSON.stringify({ command: String(command), args: Array.isArray(args[0]) ? args[0].map(String) : [], cwd: options?.cwd }).slice(0, 2000));
  };
  workers.Worker = class { constructor() { denied('worker.create'); } };
  globalThis.WebSocket = class { constructor() { denied('websocket.create'); } };
  const originalBinding = process.binding.bind(process);
  process.binding = name => /^(tcp_wrap|pipe_wrap|udp_wrap|cares_wrap|http2|tls_wrap|spawn_sync|process_wrap)$/.test(name) ? denied('binding.' + name) : originalBinding(name);
  if (typeof process._linkedBinding === 'function') process._linkedBinding = () => denied('linkedBinding');
  const nativeBindings = new Map(input.bindings.map(item => [item.path.toLowerCase(), item.sha256]));
  const originalDlopen = process.dlopen.bind(process);
  process.dlopen = function (module, filename, flags) {
    const path = require('node:fs').realpathSync.native(filename), expected = nativeBindings.get(path.toLowerCase());
    if (!expected || sha(require('node:fs').readFileSync(path)) !== expected) return denied('native-addon');
    loadedBindings.push(path); return originalDlopen(...arguments);
  };
  let sequence = 0, metadataFixtures = 0, metadataListed;
  const metadataReady = new Promise(yes => { metadataListed = yes; });
  const pending = new Map();
  process.on('message', value => { const call = pending.get(value?.id); if (!call || value.type !== 'metadata-response') return; pending.delete(value.id); clearTimeout(call.timer); if (value.error) call.reject(Object.assign(new Error(value.error.message), { code: value.error.code })); else call.accept(value.response); });
  const broker = (envelope, selfTest = false) => new Promise((accept, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('Metadata IPC exceeded its three-second deadline.')); }, 3000);
    pending.set(id, { accept, reject, timer }); process.send({ type: 'metadata', id, envelope, selfTest });
  });
  globalThis.fetch = async (request, init = {}) => {
    const url = typeof request === 'string' || request instanceof URL ? String(request) : request.url;
    const method = init.method ?? (request instanceof Request ? request.method : 'GET');
    if (url === 'https://api.cursor.com/v1/models' && method === 'GET' && !init.body) { metadataFixtures++; return new Response(JSON.stringify({ items: [{ id: 'offline-model', displayName: 'Synthetic offline model' }] }), { status: 200, headers: { 'content-type': 'application/json' } }); }
    if (url !== input.endpoint.url) return denied('fetch', (() => { try { const parsed = new URL(url); return parsed.origin + parsed.pathname; } catch { return 'invalid'; } })());
    const envelope = { url, method, headers: Object.fromEntries(new Headers(init.headers ?? (request instanceof Request ? request.headers : undefined))), body: init.body };
    let message; try { message = validateMetadataEnvelope(envelope, input.endpoint); } catch { return denied('metadata-envelope', method); }
    const response = await broker(envelope);
    const decoded = response.body ? JSON.parse(response.body) : null;
    metadataResponses.push({ method: message.method, status: response.status, response: decoded, names: decoded?.result?.tools?.map(tool => tool.name) });
    if (message.method === 'tools/list') metadataListed();
    return new Response(response.body || null, { status: response.status, headers: response.contentType ? { 'content-type': response.contentType } : {} });
  };
  syncBuiltinESMExports();
  let hook, phase = 'guarded', error, agent, run, parser, nativeResult, guardSelfTest;
  const frames = [];
  const output = () => ({ node: { path: process.execPath, version: process.versions.node }, phase, guardSelfTest, metadataFixtures, loadedSdkModules: modules, loadedBindings, parser, frames, nativeResult, metadataResponses, pendingMetadata: pending.size, deniedCalls: events, error, childSocketTrafficAllowed: false, childProcessesAllowed: false, workersAllowed: false, syntheticCredentials: true, inference: false });
  const emit = () => process.stdout.write(marker + JSON.stringify(output()) + '\n');
  const deadline = setTimeout(() => { error = { code: 'PROBE_DEADLINE', message: 'Metadata SDK did not settle within ten seconds.' }; emit(); process.exit(0); }, 10_000);
  process.on('unhandledRejection', reason => { record('unhandled-rejection', reason?.code ?? reason?.name ?? 'unknown'); });
  try {
    const assertions = [() => net.createConnection(9, '127.0.0.1'), () => new net.Socket().connect(9, '127.0.0.1'), () => new net.Server().listen(0, '127.0.0.1'), () => tls.connect(9, '127.0.0.1'), () => http.get('http://127.0.0.1:9'), () => https.get('https://127.0.0.1:9'), () => http2.connect('https://127.0.0.1:9'), () => dns.lookup('localhost'), () => dns.Resolver.prototype.resolve4.call({}, 'localhost', () => {}), () => dns.promises.Resolver.prototype.resolve4.call({}, 'localhost'), () => dgram.Socket.prototype.send.call({}, 'metadata', 9, '127.0.0.1'), () => processes.spawn(process.execPath, ['-e', '0']), () => new workers.Worker('0', { eval: true }), () => new globalThis.WebSocket('ws://127.0.0.1:9'), () => process.binding('tcp_wrap'), () => process.dlopen({ exports: {} }, script)];
    for (const assertion of assertions) { let blocked = false; try { assertion(); } catch (error) { blocked = error.code === 'CURSOR_METADATA_DENIED'; } if (!blocked) throw new Error('Metadata guard self-test did not block a primitive.'); }
    try { await fetch('http://127.0.0.1:9'); throw new Error('Fetch guard failed.'); } catch (error) { if (error.code !== 'CURSOR_METADATA_DENIED') throw error; }
    const good = { url: input.endpoint.url, method: 'POST', headers: { authorization: input.endpoint.authorization, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) };
    const invalid = [{ ...good, url: good.url + '?other=1' }, { ...good, method: 'GET' }, { ...good, headers: { ...good.headers, authorization: 'Bearer wrong' } }, { ...good, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'verification_echo' } }) }, { ...good, body: ' '.repeat(16_385) }, { ...good, body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]) }];
    for (const envelope of invalid) { try { await broker(envelope, true); throw new Error('Parent broker self-test admitted an invalid envelope.'); } catch (error) { if (error.code !== 'CURSOR_METADATA_DENIED') throw error; } }
    try { await fetch(good.url, { method: 'POST', headers: good.headers, body: invalid[3].body }); throw new Error('Child admitted tools/call.'); } catch (error) { if (error.code !== 'CURSOR_METADATA_DENIED') throw error; }
    guardSelfTest = { passed: true, blockedPrimitives: events.map(event => event.kind), rejectedParentEnvelopes: invalid.length }; events.length = 0;
    if (input.mode === 'guard') phase = 'guard-self-test-passed';
    else {
      const Parser = require(join(input.nativeRoot, 'vendor/tree-sitter/index.js')), Bash = require(join(input.nativeRoot, 'vendor/tree-sitter-bash/index.js'));
      const instance = new Parser(); instance.setLanguage(Bash); const tree = instance.parse('echo offline'); parser = { rootType: tree.rootNode.type, hasError: tree.rootNode.hasError };
      hook = registerHooks({ load(url, context, next) { if (url.startsWith(pathToFileURL(join(input.sdkRoot, 'dist/esm/')).href) && modules.length < 100) modules.push(url.split('/').at(-1)); return next(url, context); } });
      const sdk = await import(pathToFileURL(join(input.sdkRoot, 'dist/esm/index.js')).href); phase = 'sdk-imported';
      const store = new sdk.JsonlLocalAgentStore(join(input.profile, 'history'));
      agent = await sdk.Agent.create({ apiKey: 'synthetic-offline-no-account', model: { id: 'offline-model' }, tools: ['mcp'], agents: {}, systemPrompt: 'Offline MCP metadata verification only.', local: { cwd: join(input.profile, 'task'), settingSources: [], store, enableAgentRetries: false }, mcpServers: { host: { type: 'http', url: input.endpoint.url, headers: { Authorization: input.endpoint.authorization } } } }); phase = 'agent-created';
      run = await agent.send('Synthetic pre-authentication MCP metadata probe. No model request or tool execution is allowed.', { idempotencyKey: randomUUID() }); phase = 'agent-send-returned';
      for await (const frame of run.stream()) if (frames.length < 40) frames.push({ type: frame.type, subtype: frame.subtype, tools: frame.type === 'system' ? frame.tools : undefined, tool: frame.type === 'tool_call' ? frame.name : undefined });
      const result = await run.wait(); phase = 'run-' + result.status;
      nativeResult = { status: result.status, error: result.error && { name: result.error.name, code: result.error.code, message: String(result.error.message ?? result.error).replaceAll('synthetic-offline-no-account', '[synthetic-key]').slice(0, 700) } };
      // Auth failure races the SDK's metadata lane. Preserve that real failure,
      // while allowing only its already-guarded metadata exchange to settle.
      let settleTimer;
      try { await Promise.race([metadataReady, new Promise((_, no) => { settleTimer = setTimeout(() => no(new Error('SDK tools/list response was not observed within two seconds.')), 2000); })]); }
      finally { clearTimeout(settleTimer); }
    }
  } catch (reason) { error = { name: reason?.name, code: reason?.code, message: String(reason?.message ?? reason).replaceAll('synthetic-offline-no-account', '[synthetic-key]').slice(0, 700), stack: String(reason?.stack ?? '').slice(0, 1800) }; }
  finally {
    try { await Promise.race([run?.cancel(), new Promise(yes => setTimeout(yes, 250))]); } catch {}
    try { await Promise.race([agent?.[Symbol.asyncDispose]?.() ?? agent?.close(), new Promise(yes => setTimeout(yes, 250))]); } catch {}
    hook?.deregister(); clearTimeout(deadline); emit(); process.exit(0);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === script) {
  if (process.argv[2] === '--child') await childMain();
  else {
    const [hostRoot = '.', node = process.execPath, outputDirectory = `docs/evidence/cursor-mcp-metadata-20261031/run-${Date.now()}`, mode = 'send'] = process.argv.slice(2);
    const receipt = await runCursorMcpMetadataProbe({ hostRoot, node, outputDirectory, mode });
    console.log(JSON.stringify({ outputDirectory, phase: receipt.result.phase, metadataMethods: receipt.broker.requests.map(request => request.method), executionCallbacks: receipt.executionCallbacks, closed: receipt.closed, allChecksPassed: receipt.allChecksPassed }));
    if (!receipt.allChecksPassed) process.exitCode = 1;
  }
}
