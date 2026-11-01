import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire, registerHooks, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = fileURLToPath(import.meta.url);
const marker = 'CURSOR_OFFLINE_RESULT ';
const sdkVersion = '1.0.38';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

/** Verification only. This is not a production transport or an OS sandbox. */
export async function runCursorOfflineProbe({ hostRoot, node = process.execPath, outputDirectory, mode = 'send' }) {
  if (!['send', 'guard'].includes(mode)) throw new Error('Unsupported offline probe mode.');
  const host = await realpath(resolve(hostRoot));
  const nodePath = await realpath(resolve(node));
  const require = createRequire(join(host, 'package.json'));
  const sdkRequire = createRequire(require.resolve('@cursor/sdk'));
  const sdkRoot = dirname(dirname(dirname(require.resolve('@cursor/sdk'))));
  const nativeRoot = dirname(sdkRequire.resolve('@cursor/sdk-win32-x64/package.json'));
  for (const [root, name] of [[sdkRoot, '@cursor/sdk'], [nativeRoot, '@cursor/sdk-win32-x64']]) {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    if (manifest.name !== name || manifest.version !== sdkVersion) throw new Error('Offline probe requires the pinned SDK/native distribution.');
  }
  const profile = await mkdtemp(join(tmpdir(), 'cursor-offline-'));
  const directories = ['home', 'tmp', 'task', 'history', 'AppData/Roaming', 'AppData/Local', 'config', 'cache', 'state'];
  await Promise.all(directories.map(part => mkdir(join(profile, part), { recursive: true })));
  const env = {};
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PATH', 'Path']) if (process.env[key] !== undefined) env[key] = process.env[key];
  Object.assign(env, { HOME: join(profile, 'home'), USERPROFILE: join(profile, 'home'), APPDATA: join(profile, 'AppData/Roaming'), LOCALAPPDATA: join(profile, 'AppData/Local'), TMP: join(profile, 'tmp'), TEMP: join(profile, 'tmp'), XDG_CONFIG_HOME: join(profile, 'config'), XDG_CACHE_HOME: join(profile, 'cache'), XDG_STATE_HOME: join(profile, 'state') });
  const bindings = await Promise.all(['vendor/tree-sitter/binding.node', 'vendor/tree-sitter-bash/binding.node'].map(async name => ({ path: await realpath(join(nativeRoot, name)), sha256: sha(await readFile(join(nativeRoot, name))) })));
  const sdkModules = await Promise.all(['index.js', '704.js', '748.js'].map(async name => ({ path: await realpath(join(sdkRoot, 'dist/esm', name)), sha256: sha(await readFile(join(sdkRoot, 'dist/esm', name))) })));
  const child = spawn(nodePath, [script, '--child'], { cwd: profile, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const input = { mode, profile, sdkRoot: await realpath(sdkRoot), nativeRoot: await realpath(nativeRoot), bindings };
  child.stdin.end(JSON.stringify(input));
  let stdout = '', stderr = '', bytes = 0;
  const result = await new Promise((accept, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Owned offline child exceeded its 20-second deadline.')); }, 20_000);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { bytes += chunk.length; if (bytes > 256 * 1024) { child.kill(); return; } if (stream === child.stdout) stdout += String(chunk); else stderr += String(chunk); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      const line = stdout.split(/\r?\n/).find(value => value.startsWith(marker));
      if (code !== 0 || !line) { reject(new Error(`Offline child exited ${code}; result missing. ${stderr.slice(-1200)}`)); return; }
      try { accept(JSON.parse(line.slice(marker.length))); } catch (error) { reject(error); }
    });
  });
  if (await realpath(result.node.path) !== nodePath) throw new Error('Offline probe used an unexpected Node binary.');
  const receipt = { createdAt: new Date().toISOString(), mode, hostRoot: host, profile, sdkVersion, sdkRoot: input.sdkRoot, sdkModules, node: result.node, scriptSha256: sha(await readFile(script)), bindingCustody: bindings, result, stderr: stderr.slice(-4000), limits: ['Synthetic metadata and credentials only; no account authentication, entitlement, billing or inference acceptance.', 'Node API guards deny network/process/worker escape before SDK import; this is not an OS sandbox or hostile-native-code containment.', 'Only the stock tree-sitter parser bindings are admitted; other native addons fail closed.', 'Reaching a denied transport proves initialization reach only; it does not prove successful Agent.send, tools, resume or active remote cancellation.'] };
  if (outputDirectory) { await mkdir(outputDirectory, { recursive: true }); await writeFile(join(outputDirectory, 'verification.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' }); }
  return receipt;
}

async function childMain() {
  let raw = ''; for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 32_768) throw new Error('Offline configuration exceeded bound.'); }
  const input = JSON.parse(raw);
  const require = createRequire(import.meta.url);
  const events = [], modules = [], loadedBindings = [];
  const record = (kind, detail = '') => { if (events.length < 100) events.push({ kind, detail }); };
  const denied = (kind, detail = '') => { record(kind, detail); const error = new Error(`Offline boundary denied ${kind}`); error.code = 'CURSOR_OFFLINE_DENIED'; throw error; };
  const replace = (module, key, kind = key) => { if (typeof module[key] === 'function') module[key] = function () { return denied(kind); }; };
  const net = require('node:net'), tls = require('node:tls'), http = require('node:http'), https = require('node:https'), http2 = require('node:http2'), dns = require('node:dns'), dgram = require('node:dgram'), processes = require('node:child_process'), workers = require('node:worker_threads');
  for (const name of ['connect', 'createConnection']) replace(net, name, 'socket.' + name);
  replace(net.Socket.prototype, 'connect', 'socket.prototype.connect'); replace(net.Server.prototype, 'listen', 'server.listen');
  replace(tls, 'connect', 'tls.connect');
  for (const [module, prefix] of [[http, 'http'], [https, 'https']]) for (const name of ['request', 'get']) replace(module, name, prefix + '.' + name);
  replace(http2, 'connect', 'http2.connect');
  for (const key of Object.keys(dns)) if (/^(lookup|resolve|reverse)/.test(key)) replace(dns, key, 'dns.' + key);
  for (const key of Object.keys(dns.promises)) if (/^(lookup|resolve|reverse)/.test(key)) replace(dns.promises, key, 'dns.promises.' + key);
  for (const [prototype, prefix] of [[dns.Resolver.prototype, 'dns.Resolver'], [dns.promises.Resolver.prototype, 'dns.promises.Resolver']]) for (const key of Object.getOwnPropertyNames(prototype)) if (/^(resolve|reverse)/.test(key)) replace(prototype, key, prefix + '.' + key);
  for (const key of ['send', 'connect', 'bind']) replace(dgram.Socket.prototype, key, 'udp.' + key);
  for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) if (typeof processes[key] === 'function') processes[key] = function (command, ...args) {
    const options = args.find(value => value && typeof value === 'object' && !Array.isArray(value));
    const nativeEnv = options?.env ?? {};
    const gitConfig = Array.from({ length: Math.min(20, Number(nativeEnv.GIT_CONFIG_COUNT) || 0) }, (_, i) => [nativeEnv['GIT_CONFIG_KEY_' + i], nativeEnv['GIT_CONFIG_VALUE_' + i]]);
    const detail = { command: String(command).replaceAll('synthetic-offline-no-account', '[synthetic-key]'), args: Array.isArray(args[0]) ? args[0].map(value => String(value).replaceAll('synthetic-offline-no-account', '[synthetic-key]')) : [], cwd: options?.cwd, gitConfig, gitConfigNoSystem: nativeEnv.GIT_CONFIG_NOSYSTEM ?? null, gitConfigGlobal: nativeEnv.GIT_CONFIG_GLOBAL ?? null, gitCeilingDirectories: nativeEnv.GIT_CEILING_DIRECTORIES ?? null, caller: new Error().stack?.split('\n').filter(line => !line.includes('cursor-offline-executor.mjs')).slice(1, 8) };
    return denied('process.' + key, JSON.stringify(detail).slice(0, 4000));
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
  const metadata = 'https://api.cursor.com/v1/models'; let metadataFixtures = 0;
  globalThis.fetch = async input => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    if (url === metadata) { metadataFixtures++; return new Response(JSON.stringify({ items: [{ id: 'offline-model', displayName: 'Synthetic offline model' }] }), { status: 200, headers: { 'content-type': 'application/json' } }); }
    return denied('fetch', (() => { try { const parsed = new URL(url); return parsed.origin + parsed.pathname; } catch { return 'invalid'; } })());
  };
  syncBuiltinESMExports();
  let hook;
  let phase = 'guarded', error, agent, run, parser, nativeResult, guardSelfTest;
  const frames = [];
  const output = () => ({ node: { path: process.execPath, version: process.versions.node }, phase, guardSelfTest, metadataFixtures, loadedSdkModules: modules, loadedBindings, parser, frames, nativeResult, deniedCalls: events, error, networkAllowed: false, childProcessesAllowed: false, workersAllowed: false, syntheticCredentials: true, inference: false });
  const emit = () => process.stdout.write(marker + JSON.stringify(output()) + '\n');
  const deadline = setTimeout(() => { error = { code: 'PROBE_DEADLINE', message: 'Offline SDK did not settle within ten seconds.' }; emit(); process.exit(0); }, 10_000);
  process.on('unhandledRejection', reason => { record('unhandled-rejection', reason?.code ?? reason?.name ?? 'unknown'); });
  try {
    {
      const assertions = [() => net.createConnection(9, '127.0.0.1'), () => new net.Socket().connect(9, '127.0.0.1'), () => new net.Server().listen(0, '127.0.0.1'), () => tls.connect(9, '127.0.0.1'), () => http.get('http://127.0.0.1:9'), () => https.get('https://127.0.0.1:9'), () => http2.connect('https://127.0.0.1:9'), () => dns.lookup('localhost'), () => dns.Resolver.prototype.resolve4.call({}, 'localhost', () => {}), () => dns.promises.Resolver.prototype.resolve4.call({}, 'localhost'), () => dgram.Socket.prototype.send.call({}, 'offline', 9, '127.0.0.1'), () => processes.spawn(process.execPath, ['-e', '0']), () => new workers.Worker('0', { eval: true }), () => new globalThis.WebSocket('ws://127.0.0.1:9'), () => process.binding('tcp_wrap'), () => process.dlopen({ exports: {} }, script)];
      for (const assertion of assertions) { let blocked = false; try { assertion(); } catch (error) { blocked = error.code === 'CURSOR_OFFLINE_DENIED'; } if (!blocked) throw new Error('Offline guard self-test did not block a primitive.'); }
      try { await fetch('http://127.0.0.1:9'); throw new Error('Fetch guard failed.'); } catch (error) { if (error.code !== 'CURSOR_OFFLINE_DENIED') throw error; }
      guardSelfTest = { passed: true, blockedPrimitives: events.map(event => event.kind) }; events.length = 0;
    }
    if (input.mode === 'guard') phase = 'guard-self-test-passed';
    else {
      const Parser = require(join(input.nativeRoot, 'vendor/tree-sitter/index.js'));
      const Bash = require(join(input.nativeRoot, 'vendor/tree-sitter-bash/index.js'));
      const instance = new Parser(); instance.setLanguage(Bash); const tree = instance.parse('echo offline'); parser = { rootType: tree.rootNode.type, hasError: tree.rootNode.hasError }; phase = 'native-parser-loaded';
      hook = registerHooks({ load(url, context, next) { if (url.startsWith(pathToFileURL(join(input.sdkRoot, 'dist/esm/')).href) && modules.length < 100) modules.push(url.split('/').at(-1)); return next(url, context); } });
      const sdk = await import(pathToFileURL(join(input.sdkRoot, 'dist/esm/index.js')).href); phase = 'sdk-imported';
      const store = new sdk.JsonlLocalAgentStore(join(input.profile, 'history'));
      agent = await sdk.Agent.create({ apiKey: 'synthetic-offline-no-account', model: { id: 'offline-model' }, tools: ['mcp'], agents: {}, systemPrompt: 'Offline SDK initialization probe only.', local: { cwd: join(input.profile, 'task'), settingSources: [], store, enableAgentRetries: false }, mcpServers: { host: { type: 'http', url: 'http://127.0.0.1:9/mcp', headers: { Authorization: 'Bearer synthetic-offline-host-token' } } } }); phase = 'agent-created';
      run = await agent.send('Synthetic offline initialization probe. No model request is allowed.', { idempotencyKey: randomUUID() }); phase = 'agent-send-returned';
      for await (const frame of run.stream()) { if (frames.length < 40) frames.push({ type: frame.type, subtype: frame.subtype, tools: frame.type === 'system' ? frame.tools : undefined, tool: frame.type === 'tool_call' ? frame.name : undefined }); }
      const result = await run.wait(); phase = 'run-' + result.status;
      nativeResult = { status: result.status, error: result.error && { name: result.error.name, code: result.error.code, message: String(result.error.message ?? result.error).replaceAll('synthetic-offline-no-account', '[synthetic-key]').slice(0, 700) } };
    }
  } catch (reason) { error = { name: reason?.name, code: reason?.code, message: String(reason?.message ?? reason).replaceAll('synthetic-offline-no-account', '[synthetic-key]').slice(0, 700), stack: String(reason?.stack ?? '').replaceAll('synthetic-offline-no-account', '[synthetic-key]').slice(0, 1800) }; }
  finally {
    try { await Promise.race([run?.cancel(), new Promise(yes => setTimeout(yes, 250))]); } catch {}
    try { await Promise.race([agent?.[Symbol.asyncDispose]?.() ?? agent?.close(), new Promise(yes => setTimeout(yes, 250))]); } catch {}
    hook?.deregister(); clearTimeout(deadline); emit(); process.exit(0);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === script) {
  if (process.argv[2] === '--child') await childMain();
  else {
    const [hostRoot = '.', node = process.execPath, outputDirectory = `docs/evidence/cursor-offline-executor-20261031/run-${Date.now()}`] = process.argv.slice(2);
    const result = await runCursorOfflineProbe({ hostRoot, node, outputDirectory }); console.log(JSON.stringify({ outputDirectory, result: result.result }));
  }
}
