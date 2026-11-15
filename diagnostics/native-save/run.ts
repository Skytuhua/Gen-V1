import {spawn, execFileSync, type ChildProcess} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {readFile, writeFile, mkdir, mkdtemp, realpath, lstat} from 'node:fs/promises';
import {join, resolve, dirname, win32} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {build} from 'esbuild';
import electron from 'electron';
import {chromium, expect, type Browser} from '@playwright/test';
import {prepareInstalledNativeSave, readInstalledNativeSave, saveInstalledMemoryThroughNativeDialog, type InstalledNativeSaveObservation} from '../../scripts/installed-native-save.ts';
import {terminateProcessTree} from '../../packages/runtime-pi/process-tree.ts';

const mode = process.argv[2];
if (process.platform !== 'win32' || (mode !== 'direct' && mode !== 'policy')) throw Error('This diagnostic requires Windows and an explicit direct or policy lane.');
const repository = process.cwd(), sources = dirname(fileURLToPath(import.meta.url));
const pins: Record<string, string> = {
  'scripts/installed-native-save.ts': '463d776cdb75fd3aa9bfacefd267777bac4448086c9c247db8d2858bb88e1ab6',
  'apps/desktop/memory-export.ts': '6c61d0724d67e5afd165c923a64626add408a41e174b9e929c0775b34ed430e9',
  'packages/contracts/project-memory.ts': 'c091c003e0cefb56313bf684bebbf5aaf3100b432649a76c2579ac7706e155c9',
  'packages/core/memory-publication.ts': 'c7b875cea7c3b30bdacad9bd1ec7c29851a6c154bce2126bcd15927175db6711',
  'package.json': 'd9359bdc24c127410c0168424a07f80460b8099632303e987d9b219de5a88ba0',
  'pnpm-lock.yaml': '2269337714e848fd47cca88f898e6d9fd5f70e276a04061e435546ddc9eb9fb9',
  '.github/actions/setup/action.yml': 'fe4863de534c4b8c3a61fceab21a9b00f5bcf0a4387fe457d3c544e90fc2d5ab',
};
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const output = resolve('.harness-native-save-diagnostic', mode);
await mkdir(dirname(output), {recursive: true}); await mkdir(output);
const root = await realpath(await mkdtemp(join(tmpdir(), 'm05-native-save-' + mode + '-')));
const nonce = randomBytes(24).toString('hex');
const receipt: Record<string, unknown> = {version: 1, mode, createdAt: new Date().toISOString(), sourceBaseSha: '013c044d66f40136752df4f1903132d601d57851',
  scope: mode === 'direct' ? 'Direct native Save and reviewed helper; not production export admission.' : 'Exact production memory export policy and reviewed native Save helper with a synthetic loopback fixture; not installed retention proof.',
  nativeHelperChanged: true, nativeHelperBaselineSha256: 'f7a8f9b91c682eede154123f5d341aa2a6a41e9aae49d1707d937c3790bb289d', savePathBypass: false, providerOrAccountCodeLoaded: false, fixture: true, passed: false, sourceHashes: {}, cleanup: {}};
let fixture: ChildProcess | undefined, observer: ChildProcess | undefined, browser: Browser | undefined;
let origin = '', documentUrl = '', stage = 'source-custody';
let ready: {origin: string; documentUrl: string; pid: number; electron: string} | undefined;
let fixtureOutput = '', fixtureStderrBytes = 0, observerOutput = '', observerStderrBytes = 0;
let fixtureStderr = Buffer.alloc(0), fixtureLines = 0;
const fixtureStderrHash = createHash('sha256'), fixturePhases: {phase: string; elapsedMs: number}[] = [];
let native: InstalledNativeSaveObservation | undefined;
const completionStages: string[] = [];
const completionErrorCode = (cause: unknown) => {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? (cause as {code?: unknown}).code : undefined;
  return typeof code === 'string' && ['ENOENT', 'EACCES', 'EPERM', 'EBUSY', 'EIO', 'ENOTDIR', 'ELOOP'].includes(code) ? code : 'other';
};
const fixedTargetMetadata = async (path: string) => {
  try {
    const info = await lstat(path, {bigint: true});
    return {exists: true, ordinaryFile: info.isFile() && !info.isSymbolicLink(), symbolicLink: info.isSymbolicLink(),
      bytes: info.size <= 1048576n ? Number(info.size) : 'over-bound'};
  } catch (cause) {return {exists: null, errorCode: completionErrorCode(cause)};}
};
let observerError: string | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
const isAlive = (child: ChildProcess | undefined) => !!child?.pid && child.exitCode === null && child.signalCode === null;
const safeFailure = (cause: unknown) => {
  const message = cause instanceof Error ? cause.message : '';
  return /^(?:Native Save refused: [a-z-]+\.|The owned native Save worker exceeded its 75000 ms deadline\.|The owned installed process exited during native Save\.)$/.test(message)
    ? message : 'Diagnostic boundary failed; inspect the bounded stage metadata.';
};
const bounded = async <T>(operation: Promise<T>, timeoutMs: number, reason: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {return await Promise.race([operation, new Promise<never>((_resolve, reject) => {timer = setTimeout(() => reject(Error(reason)), timeoutMs);})]);}
  finally {clearTimeout(timer);}
};
const state = async () => {
  if (!origin || !isAlive(fixture)) return null;
  const response = await fetch(origin + '/state', {headers: {'x-fixture-owner': nonce}, signal: AbortSignal.timeout(3000)});
  if (!response.ok) throw Error('Fixture state unavailable.');
  const text = await response.text(); if (Buffer.byteLength(text) > 32768) throw Error('Fixture state exceeded its bound.');
  const result = JSON.parse(text) as {pid: number; electron: string; status: string; outcome: {status: string; filename: string; bytes: number; sha256: string} | null};
  if (result.pid !== fixture!.pid || result.electron !== '45.2.0') throw Error('Fixture state owner changed.');
  return result;
};
try {
  receipt.checkout = {sha: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repository, encoding: 'utf8'}).trim(), tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {cwd: repository, encoding: 'utf8'}).trim()};
  const observed: Record<string, {bytes: number; sha256: string}> = {};
  for (const [path, expected] of Object.entries(pins)) {
    const bytes = await readFile(join(repository, path)); const digest = hash(bytes);
    if (digest !== expected) throw Error('Pinned diagnostic source changed.');
    observed[path] = {bytes: bytes.length, sha256: digest};
  }
  receipt.sourceHashes = observed;
  const executable = await realpath(electron as unknown as string);
  receipt.electronExecutable = {sha256: hash(await readFile(executable)), expectedVersion: '45.2.0'};
  const portServer = createServer();
  await new Promise<void>((accept, reject) => {portServer.once('error', reject); portServer.listen(0, '127.0.0.1', accept);});
  const portAddress = portServer.address();
  if (!portAddress || typeof portAddress === 'string') throw Error('A fresh loopback CDP port is required.');
  const debugPort = portAddress.port;
  await new Promise<void>((accept, reject) => portServer.close(error => error ? reject(error) : accept()));
  const config = {mode, root, nonce, preload: join(root, 'preload.cjs'), debugPort};
  await writeFile(join(root, 'owner.json'), JSON.stringify({version: 1, nonce}), {flag: 'wx'});
  await writeFile(join(root, 'fixture.json'), JSON.stringify(config), {flag: 'wx'});
  await writeFile(config.preload, 'const {contextBridge,ipcRenderer}=require("electron");contextBridge.exposeInMainWorld("nativeSaveDiagnostic",{start:()=>ipcRenderer.invoke("diagnostic:native-save")});\n', {flag: 'wx'});
  await mkdir(join(root, 'profile'));
  stage = 'bundle-exact-policy';
  await build({entryPoints: [join(sources, 'electron.ts')], outfile: join(root, 'electron.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['electron'], sourcemap: false, logLevel: 'silent'});
  stage = 'owned-electron-start';
  const environment = {...process.env}; delete environment.ELECTRON_RUN_AS_NODE;
  fixture = spawn(executable, [join(root, 'electron.mjs'), '--fixture-config=' + join(root, 'fixture.json'), '--harness-native-save-fixture=' + nonce], {cwd: root, env: environment, windowsHide: false, stdio: ['ignore', 'pipe', 'pipe']});
  let fixtureFailure: string | undefined;
  fixture.once('error', () => {fixtureFailure = 'spawn-failed';});
  fixture.stdout!.on('data', (bytes: Buffer) => {
    fixtureOutput += bytes.toString('utf8');
    if (Buffer.byteLength(fixtureOutput) > 32768) {fixtureFailure = 'stdout-bound'; void terminateProcessTree(fixture!); return;}
    const lines = fixtureOutput.slice(0, fixtureOutput.lastIndexOf('\n') + 1).split(/\r?\n/).filter(Boolean);
    for (const line of lines.slice(fixtureLines)) {
      try {
        if (line.startsWith('M05_NATIVE_SAVE_PHASE=')) {
          const entry = JSON.parse(line.slice('M05_NATIVE_SAVE_PHASE='.length));
          if (fixturePhases.length >= 8 || !['module-entered','config-read','server-listening','ready-scheduled','app-ready','renderer-ready','startup-failed'].includes(entry.phase) || !Number.isSafeInteger(entry.elapsedMs) || entry.elapsedMs < 0 || entry.elapsedMs > 150000) throw Error('Invalid fixture phase.');
          fixturePhases.push({phase: entry.phase, elapsedMs: entry.elapsedMs});
        } else if (line.startsWith('M05_NATIVE_SAVE_READY=') && !ready) ready = JSON.parse(line.slice('M05_NATIVE_SAVE_READY='.length));
      } catch {fixtureFailure = 'invalid-ready';}
    }
    fixtureLines = lines.length;
  });
  fixture.stderr!.on('data', (bytes: Buffer) => {
    fixtureStderrBytes += bytes.length; fixtureStderrHash.update(bytes);
    if (fixtureStderr.length < 65536) fixtureStderr = Buffer.concat([fixtureStderr, bytes.subarray(0, 65536 - fixtureStderr.length)]);
    if (fixtureStderrBytes > 65536) {fixtureFailure = 'stderr-bound'; void terminateProcessTree(fixture!);}
  });
  deadline = setTimeout(() => {void terminateProcessTree(fixture!); if (observer) void terminateProcessTree(observer);}, 145000);
  const startup = Date.now();
  while (!ready && Date.now() - startup < 30000) {if (fixtureFailure || !isAlive(fixture)) throw Error('The owned fixture did not become ready.'); await delay(100);}
  if (!ready || ready.pid !== fixture.pid || ready.electron !== '45.2.0' || !/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(ready.origin) || ready.documentUrl !== ready.origin + '/?fixture=' + nonce) throw Error('The owned fixture readiness identity was invalid.');
  origin = ready.origin; documentUrl = ready.documentUrl;
  receipt.fixtureReady = {pid: ready.pid, electron: ready.electron, elapsedMs: Date.now() - startup};
  stage = 'owned-cdp-attachment';
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + debugPort, {timeout: 15000});
  const ownerControl = await browser.newBrowserCDPSession();
  try {
    const {arguments: args} = await ownerControl.send('Browser.getBrowserCommandLine');
    if (!isAlive(fixture) || !win32.isAbsolute(args[0] ?? '') || win32.normalize(args[0]!).toLowerCase() !== win32.normalize(executable).toLowerCase() || args.filter(value => value === '--harness-native-save-fixture=' + nonce).length !== 1) throw Error('CDP did not bind the exact executable and launch nonce.');
  } finally {await ownerControl.detach();}
  const pages = browser.contexts().flatMap(context => context.pages()).filter(page => page.url() === documentUrl);
  if (pages.length !== 1 || !isAlive(fixture)) throw Error('The owned diagnostic page was not unique.');
  const page = pages[0]!;
  const downloadControl = await browser.newBrowserCDPSession();
  try {await downloadControl.send('Browser.setDownloadBehavior', {behavior: 'default', eventsEnabled: false});}
  finally {await downloadControl.detach();}
  receipt.downloadBehavior = {mode: 'default', resetAcknowledged: true};
  stage = 'owned-read-only-window-observer';
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!systemRoot) throw Error('The Windows runtime was unavailable.');
  observer = spawn(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-MTA', '-File', join(sources, 'windows.ps1')], {cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
  observer.once('error', () => {observerError = 'spawn-failed';});
  observer.stdout!.on('data', (bytes: Buffer) => {observerOutput += bytes.toString('utf8'); if (Buffer.byteLength(observerOutput) > 131072) {observerError = 'stdout-bound'; void terminateProcessTree(observer!);}});
  observer.stderr!.on('data', (bytes: Buffer) => {observerStderrBytes += bytes.length; if (observerStderrBytes > 16384) {observerError = 'stderr-bound'; void terminateProcessTree(observer!);}});
  observer.stdin!.on('error', () => {observerError = 'input-failed';});
  observer.stdin!.end(JSON.stringify({pid: fixture.pid, executable}) + '\n');
  const observerStarted = Date.now();
  while (!observerOutput.includes('\n') && Date.now() - observerStarted < 10000) {if (observerError || !isAlive(observer)) throw Error('Owned window observer failed before trigger.'); await delay(100);}
  if (!observerOutput.includes('\n')) throw Error('Owned window observer did not produce its baseline.');
  const initial = JSON.parse(observerOutput.split(/\r?\n/)[0]!);
  if (initial.phase !== 'snapshot' || initial.pid !== fixture.pid || initial.windows.some((item: {titleKind: string}) => item.titleKind === 'expected-export')) throw Error('Owned window baseline was not clean.');
  stage = 'native-save-through-reviewed-helper';
  const target = await prepareInstalledNativeSave(root);
  receipt.fixtureBeforeTrigger = await state();
  try {
    const result = await saveInstalledMemoryThroughNativeDialog({pid: fixture.pid!, executable, isAlive: () => isAlive(fixture)}, target,
      () => page.getByRole('button', {name: 'Export redacted JSON', exact: true}).click(), async () => {
        completionStages.push('waiting-renderer-saved');
        await expect(page.locator('#status')).toHaveText('saved', {timeout: 30000});
        completionStages.push('target-lstat');
        receipt.fixedTarget = await fixedTargetMetadata(target.path);
        completionStages.push('reading-fixed-target');
        const bytes = await readInstalledNativeSave(target);
        completionStages.push('hashing-read-bytes');
        const digest = hash(bytes);
        completionStages.push('reading-native-state');
        const actual = await state();
        completionStages.push('matching-native-result');
        if (actual?.status !== 'saved' || actual.outcome?.status !== 'saved' || actual.outcome.bytes !== bytes.length || actual.outcome.sha256 !== digest || actual.outcome.filename !== 'project-memory-diagnostic_project.json') throw Error('Native completion did not match exact saved bytes.');
        completionStages.push('checking-redacted-json');
        const parsed = JSON.parse(bytes.toString('utf8'));
        if (parsed.redacted !== true || parsed.scope.projectId !== 'diagnostic:project') throw Error('Unexpected synthetic output.');
        return {bytes: bytes.length, sha256: digest, canonicalFilename: actual.outcome.filename};
      }, value => {native = value;});
    receipt.nativeSave = result.dialog; receipt.saved = result.value; receipt.passed = true;
  } catch (cause) {
    receipt.failure = {stage, error: safeFailure(cause), completionErrorCode: completionErrorCode(cause)};
    receipt.fixedTarget = await fixedTargetMetadata(target.path);
    receipt.nativeSave = native ?? null;
  }
  receipt.completionStages = completionStages;
  stage = 'terminal-observations';
  receipt.fixtureAfterProbe = await state();
  if (isAlive(observer)) await bounded(new Promise<void>(accept => observer!.once('close', () => accept())), 45000, 'The read-only window observer exceeded its bound.');
  const observations = observerOutput.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  if (observerError || observations.length > 7 || observer.exitCode !== 0 || observations.at(-1)?.phase !== 'completed' || observations.some(value => value.pid !== fixture!.pid || value.processStartTicks !== native?.processStartTicks)) throw Error('The window observer did not retain the same live native owner.');
  receipt.windowObservations = observations;
  receipt.windowObserver = {exitCode: observer.exitCode, stderrBytes: observerStderrBytes, bytes: Buffer.byteLength(observerOutput), sha256: hash(observerOutput)};
} catch (cause) {
  receipt.passed = false; receipt.failure ??= {stage, error: safeFailure(cause)};
  receipt.nativeSave ??= native ?? null;
  receipt.fixtureAfterFailure = await state().catch(() => null);
  receipt.windowObserver = {exitCode: observer?.exitCode ?? null, error: observerError ?? null, stderrBytes: observerStderrBytes, bytes: Buffer.byteLength(observerOutput), sha256: hash(observerOutput)};
  // Parse complete, bounded observer rows only. An interrupted final row is not presented as an observation.
  receipt.windowObservations = observerOutput.slice(0, observerOutput.lastIndexOf('\n') + 1).split(/\r?\n/).filter(Boolean).slice(0, 7).flatMap(line => {try {return [JSON.parse(line)];} catch {return [];}});
} finally {
  clearTimeout(deadline);
  const cleanup: Record<string, unknown> = {observerOwned: !!observer?.pid, fixtureOwned: !!fixture?.pid};
  if (isAlive(observer)) {try {await terminateProcessTree(observer!); cleanup.observerTerminated = true;} catch {cleanup.observerTerminationUnconfirmed = true; receipt.passed = false;}}
  if (isAlive(fixture)) {
    try {
      if (origin) await fetch(origin + '/shutdown', {method: 'POST', headers: {'x-fixture-owner': nonce}, signal: AbortSignal.timeout(3000)});
      if (isAlive(fixture)) await bounded(new Promise<void>(accept => fixture!.once('close', () => accept())), 10000, 'Owned fixture close deadline.');
    } catch { /* Confirm this exact child is stopped below. */ }
    if (isAlive(fixture)) {try {await terminateProcessTree(fixture!); cleanup.fixtureTerminated = true;} catch {cleanup.fixtureTerminationUnconfirmed = true; receipt.passed = false;}}
  }
  if (browser) await bounded(browser.close().catch(() => {}), 5000, 'CDP detach deadline.').catch(() => {});
  cleanup.fixtureExitCode = fixture?.exitCode ?? null; cleanup.fixtureSignal = fixture?.signalCode ?? null;
  cleanup.fixtureStderrBytes = fixtureStderrBytes; cleanup.ownedProcessesExited = !isAlive(fixture) && !isAlive(observer);
  if (!cleanup.ownedProcessesExited) receipt.passed = false;
  if (receipt.passed && (cleanup.fixtureExitCode !== 0 || cleanup.fixtureSignal !== null || cleanup.fixtureTerminated)) {receipt.passed = false; receipt.failure = {stage: 'owned-cleanup', error: 'The successful fixture did not close cleanly.'};}
  let normalizedStderr = fixtureStderr.toString('utf8');
  for (const [value, replacement] of [[root, '<owned-root>'], [repository, '<repository>'], [nonce, '<owned-nonce>']]) {
    const variants = new Set([value!, value!.replaceAll('\\', '/'), JSON.stringify(value).slice(1,-1), JSON.stringify(value!.replaceAll('\\', '/')).slice(1,-1)]);
    for (const variant of [...variants].sort((left,right) => right.length-left.length)) normalizedStderr = normalizedStderr.split(variant).join(replacement!);
  }
  normalizedStderr = normalizedStderr.replace(/ws:\/\/127\.0\.0\.1:[0-9]+\/devtools\/browser\/[a-zA-Z0-9-]+/g, '<owned-devtools-endpoint>');
  const normalizedBytes = Buffer.from(normalizedStderr);
  receipt.fixtureStartup = {phases: fixturePhases, stderr: {observedBytes: fixtureStderrBytes, observedSha256: fixtureStderrHash.digest('hex'), capturedBytes: fixtureStderr.length,
    normalized: true, truncated: normalizedBytes.length > 8192 || fixtureStderrBytes > fixtureStderr.length,
    head: normalizedBytes.subarray(0, 4096).toString('utf8'), tail: normalizedBytes.length > 4096 ? normalizedBytes.subarray(Math.max(4096, normalizedBytes.length - 4096)).toString('utf8') : ''}};
  receipt.cleanup = cleanup; receipt.completedAt = new Date().toISOString();
  const content = JSON.stringify(receipt, null, 2) + '\n';
  if (Buffer.byteLength(content) > 262144) throw Error('The bounded diagnostic receipt exceeded 256 KiB.');
  await writeFile(join(output, 'receipt.json'), content, {flag: 'wx'});
  const encoded = Buffer.from(content).toString('base64'), chunks: string[] = [];
  for (let index = 0; index < encoded.length; index += 16384) chunks.push(encoded.slice(index, index + 16384));
  const framed = ['M05_NATIVE_SAVE_RECEIPT_HEADER=' + JSON.stringify({schema: 1, mode, bytes: Buffer.byteLength(content), sha256: hash(content), chunks: chunks.length}),
    ...chunks.map((chunk, index) => 'M05_NATIVE_SAVE_RECEIPT_CHUNK=' + index + ':' + chunk), 'M05_NATIVE_SAVE_RECEIPT_END=' + hash(content)].join('\n');
  if (Buffer.byteLength(framed) >= 400 * 1024) throw Error('The framed diagnostic receipt exceeded its stdout bound.');
  console.log(framed);
  console.log('M05_NATIVE_SAVE_DIAGNOSTIC=' + JSON.stringify({mode, passed: receipt.passed, stage, bytes: Buffer.byteLength(content), sha256: hash(content), failure: receipt.failure ?? null, nativeSave: native ? {status: native.status, failure: native.failure ?? null, phases: native.events.map(value => value.phase)} : null}));
}
if (!receipt.passed) process.exitCode = 1;
