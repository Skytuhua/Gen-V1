import {execFileSync, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync} from 'node:fs';
import {request} from 'node:https';
import {isAbsolute, join, resolve} from 'node:path';
import {rootCertificates, type TLSSocket} from 'node:tls';
import {expect, it} from 'vitest';
import {OwnerDiscussionStreamClient} from '../../packages/company-client/owner-discussion-stream.ts';
import {canonicalBytes, decodeBoundedJson} from '../../packages/company-contracts/communications/json.ts';
import {normalizeOwnerDiscussionStreamRequest, projectOwnerDiscussionChanges, validateOwnerDiscussionChanges,
  validateOwnerDiscussionSnapshot} from '../../packages/company-contracts/communications/owner-discussion-stream.ts';
import type {OwnerDiscussionReadBack} from '../../packages/company-contracts/communications/owner-discussion.ts';
import type {ReadContext} from '../../packages/company-contracts/communications/reads.ts';

const fixtureRoot = process.env.GEN_COMPANY_OWNER_DISCUSSION_STREAM_FIXTURE_ROOT;
const reviewedRoot = 'C:/Users/user/Documents/Maritime/hermes-swarm-control';
const checkpoint = '10bc0d8d20ba55f95130bdb0724800850cbb0c06';
const publicToken = 'PUBLIC-disposable-owner-discussion-thread-HTTPS-fixture-only';
const otherToken = 'PUBLIC-disposable-other-owner-discussion-thread-fixture-only';
const gitExecutable = 'C:\\Program Files\\Git\\cmd\\git.exe';
const snapshotRoute = '/company/v1/projects/alpha/owner-discussion/snapshot';
const changesRoute = '/company/v1/projects/alpha/owner-discussion/changes';
const maximumResponseBytes = 262144;
const maximumMetadataBytes = 32768;
type Case = 'regular' | 'byte' | 'empty';
type Control = 'append' | 'append-many' | 'replay' | 'restart' | 'restore' | 'expire' | 'access-change' | 'revoke-principal' | 'revoke' | 'stop';
type SnapshotResult = Awaited<ReturnType<OwnerDiscussionStreamClient['start']>>;
type ChangesResult = Awaited<ReturnType<OwnerDiscussionStreamClient['changes']>>;
type SnapshotPage = SnapshotResult['page'];
type ChangesPage = ChangesResult['page'];
type SnapshotState = Extract<Parameters<OwnerDiscussionStreamClient['continueSnapshot']>[1], {mode: 'snapshot'}>;
type ChangesState = Extract<Parameters<OwnerDiscussionStreamClient['changes']>[1], {mode: 'changes'}>;
type EventItem = ChangesPage['items'][number];
type Save = (name: string, raw: Uint8Array | string) => void;
const expectedControls: Record<Case, Control[]> = {
  regular: ['append', 'append-many', 'replay', 'restart', 'restore', 'expire', 'access-change', 'revoke-principal', 'revoke', 'stop'],
  byte: ['append', 'append-many', 'replay', 'stop'], empty: ['append', 'replay', 'stop'],
};
const productPaths = [
  'packages/company-client/owner-discussion-stream.ts',
  'packages/company-contracts/communications/owner-discussion-stream.ts',
  'tests/company/owner-discussion-stream-service-integration.test.ts',
  'packages/company-contracts/communications/owner-discussion-stream-candidate.1/manifest.json',
  'packages/company-contracts/communications/owner-discussion-stream-candidate.1/stream.schema.json',
  'packages/company-contracts/communications/owner-discussion-stream-candidate.1/examples.json',
] as const;
const hash = (raw: Uint8Array) => createHash('sha256').update(raw).digest('hex');

// Reviewed candidate, fixture dependencies, frozen imports and sealed checkpoint.
// Each literal is checked against both the exact commit blob and working bytes.
const sourcePins = {
  "src/company/comms/events.py": "6b6bbf9319df380e37f57d06f538e827859bcf90182d31f7dc9a1036853ed1bc",
  "src/company/comms/streams.py": "a19a489d3797ef46801a81bf337d75de34d9c1619418f4c37b78eed2b8aa1097",
  "src/company/comms/owner_discussion_stream_ingress.py": "7e71036f1240bb7c70fdd8629a7111f2b6476f51328f85ec30372e1e19779633",
  "src/company/migrations/010_owner_stream.sql": "888b6b8747c78f5446f8a51b8a20d772588ea7500739a4ec72ba86bd5da67a59",
  "tools/owner_discussion_stream_fixture.py": "b0cbb59063a39d5b2767450c30e1e99e634e0317f10b586acc8eb53875980967",
  "tests/communications/test_stream_events.py": "fc1c367eef61fdac2398db2847e4ac2656f68624a928d3b7438a481dab60aa01",
  "tests/communications/test_streams.py": "3061971d7148faee9e6364b91aa6c53f902e890e7686abf267636120481ab6f1",
  "tests/communications/test_owner_discussion_stream_ingress.py": "22da05fb7d7248972faa98849f16d98a363875f9ed911cbfe12a58c2d6f5cd6b",
  "tests/communications/test_owner_discussion_stream_contract.py": "7174055cc4c01e15113975c6353dac2507f7f72dea39219cd1ff369762f7630c",
  "tests/communications/test_owner_discussion_stream_fixture.py": "b5374139a2cba9c451ef59c77cb763fb2a884c504a46719d71d5b6d531a7d9c3",
  "contracts/communications/owner-discussion-stream-candidate.1/manifest.json": "173f068fc1a01ad5e01c8f4a2d035a324ccc66508ee20af5cb612dbf55b6de30",
  "contracts/communications/owner-discussion-stream-candidate.1/stream.schema.json": "677d95b1d5d9ab95d2c479a3476cf9d8e0ad1f83d5bce91fb123d27738efc4ec",
  "contracts/communications/owner-discussion-stream-candidate.1/examples.json": "84d5053ebe73d71b6e8374b798c1f972293b4d24c933f2b425fb722fc95c8707",
  "docs/integrations/owner-discussion-stream.md": "a6f84620c75cdd829a620bc1b06fa357f44e68a5bdf2e80414264be07684c6dc",
  "docs/integrations/owner-discussion-stream-fixture.md": "6327ce7254e63f4d11475c454be471514ba43c953d514e206940c82b70de479a",
  ".gitattributes": "652afba842adda36e7b714ad9fd8b9bd4900a97a625401fc9aafea1082f0930b",
  "tests/communications/test_owner_discussion_history_fixture.py": "4a4ed4931c42389c49c1bfeab1afc77dfeead44ff92ae210488541ad25edd15e",
  "tools/owner_discussion_thread_fixture.py": "2a83d513c0c1d80d23f1116cf62b631507c122e23552e3fc0107e832149c9229",
  "tools/owner_discussion_fixture.py": "ac0371325660e7b6412611649df153c8f51d4426d122a6b5370ec96c2abf89b6",
  "src/company/comms/history.py": "53f84683703cc89357d865716072286ab3e01574e69935d8f0930bded1793d59",
  "src/company/comms/owner_discussion_ingress.py": "fedc09bc3c1257a8e9f4a8e7a409322c0623af5ef812c62a27cd64b0de825c90",
  "src/company/comms/owner_history_ingress.py": "1dad8036cb86cd7fa05e6a889cab1e617030f43fbb2d01165f83c2f4690ca4a3",
  "src/company/comms/owner_discussions.py": "81a9bf1cb085842e89a210afdd0cff25aaa5757f2801c2fc6da71c9f64a2546b",
  "src/company/comms/owner_notes.py": "db8ef098bea69ac3f3772facab030d736085d8c85c680ab4d0319eb8eadb58cf",
  "src/company/comms/contracts.py": "0194771eba78d435e3ddd1962dda40cdf0f62f1a22cb0dd185eba9e220b54891",
  "src/company/service.py": "dd7f07d16a607956f82337c29ebb1243dbde7b026f854c1f9b5a0973a5adaee9",
  "src/company/migrations/009_owner_discussions.sql": "6361aefdb8096c5953fe46133bad7aef93a0a34aa40f3428ae53505632cf8208",
  "tests/communications/fixtures/owner-history-test.cert.pem": "e90aac4fc38cfc57051c4c3ebdcdde8b12b1fa23bc0af13669c15b552252ce99",
  "tests/communications/fixtures/owner-history-test.key.pem": "9cfb337da6d23f82182485ce8b19acdac769b2883e949a0f6c70fc8fe0d499d4",
  "contracts/communications/reads-candidate.1/records.schema.json": "98fd331df7aa5262eefbf7bf73a3396d7ffd3b40e13f186e4d9aaa3a735958af",
  "contracts/communications/owner-discussion-candidate.1/discussion.schema.json": "4a6b6fdd8cda6d2f3e8c13a5bd5cb17b9996f83b91dd40925741e990f2bc7a8a",
  "contracts/communications/owner-discussion-history-candidate.1/manifest.json": "59cecb824713b945f54f20d0cee595ff5300fc6542754c9c99228e8cf512c323",
  "contracts/communications/owner-discussion-history-candidate.1/history.schema.json": "ee7a862e0a4acb4c4f4a752762b8ddebf054da4d6d19d720ee82f39b19fcb93a",
  "contracts/communications/owner-discussion-history-candidate.1/examples.json": "b1c5d64082aac470f20cd75482d86a9ba85f0fbf04c46a779b427b7f9c3daa12",
  "docs/evidence/owner-discussion-stream-2026-11-03/checkpoint.json": "61666bfde09ef8989c120dbcf399f9d39475c21318c17a235cf099ed1a6ff122",
  "src/company/store.py": "e2e02c8f1afe9d211e043de10ec7dce9be0779fd24b330bbda6fc6229ab10975"
};
const consumerFrozenPins = {
  "packages/company-contracts/communications/json.ts": "b7747da19b17c2ac5412e5caed242904268b552ac63a7d810e573e6eaae2021d",
  "packages/company-contracts/communications/reads.ts": "1418c47247c83c7a346d48ad863f2fb791cad36da81660ea2e95e73ddfd7de24",
  "packages/company-contracts/communications/owner-discussion.ts": "868d34e980de1bed9cfbc4b561914042dc8b0b19b023de88029c7dcf081c7db9",
  "packages/company-contracts/communications/reads-candidate.1/records.schema.json": "98fd331df7aa5262eefbf7bf73a3396d7ffd3b40e13f186e4d9aaa3a735958af",
  "packages/company-contracts/communications/owner-discussion-candidate.1/discussion.schema.json": "4a6b6fdd8cda6d2f3e8c13a5bd5cb17b9996f83b91dd40925741e990f2bc7a8a",
  "packages/company-contracts/communications/owner-discussion-history-candidate.1/history.schema.json": "ee7a862e0a4acb4c4f4a752762b8ddebf054da4d6d19d720ee82f39b19fcb93a",
  "packages/company-contracts/communications/owner-discussion-thread-candidate.1/thread.schema.json": "442ed5428659ce3336639efd89d651bea54bb4db03bec1b0ca285700c8a173b4",
  "packages/company-client/owner-history.ts": "1377f52b11f4553042b0b79dee8d257ce7961feb0ec2439840444f979ce53a10",
  "packages/company-client/owner-discussion.ts": "837f7ff2ea88a20b37738dc9ee657feff3d3e33bfe530965a9546e6d2fbe518c",
  "packages/company-client/owner-discussion-thread.ts": "9696beb1c95f5908ca774dbb6dd84da92234a9f9535d0bc12946f45078a47449",
  "packages/company-client/owner-discussion-history.ts": "09d22fcea40dcbcfb36cd7d9fd8898c8d6486ef0a0bc7dd6c21ac1b5c3903354",
  "packages/company-contracts/communications/owner-discussion-history.ts": "4969a2f8164c93cf256bf42842c663df42787428cb11c35d86b78fed765212d9",
  "packages/company-contracts/communications/owner-discussion-thread.ts": "94c4f7d31680456907524bd7a39e0a281f715a6df67f4f877d041436f40ec7a5",
  "tests/company/owner-history-service-integration.test.ts": "e0497965e50d916c16dc8d5e3507fc6ecb54ac40e356fb1f8b6ede54c71ceb82",
  "tests/company/owner-discussion-service-integration.test.ts": "81691b8c55b6cad28e1bd1aa6e708dc628aae5b9d758d16ee6f3e5e7f6e694a5",
  "tests/company/owner-discussion-thread-service-integration.test.ts": "655b3d9247a65bca1a78d6f79e89423754adcfd7e2c7f7fac9d46e78d4f15af9",
  "tests/company/owner-discussion-history-service-integration.test.ts": "835b6642a1ec2c7e9115d0c341aa943e1ba08f62d5b8b0038c46853a185e31c5"
};

async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_accept, reject) => {
      timer = setTimeout(() => reject(new Error('Owned stream fixture deadline exceeded.')), Math.max(1, milliseconds));
    })]);
  } finally {clearTimeout(timer);}
}

function environment(): NodeJS.ProcessEnv {
  if (process.platform !== 'win32') throw new Error('Opt-in fixture requires the reviewed Windows interpreter and git.exe.');
  const directory = (value: string | undefined) => {
    if (!value || !isAbsolute(value) || value.includes('\0')) throw new Error('Fixture environment directory unavailable.');
    const path = realpathSync.native(value);
    if (!statSync(path).isDirectory()) throw new Error('Fixture environment path is not a directory.');
    return path;
  };
  const systemRoot = directory(process.env.SystemRoot ?? process.env.WINDIR);
  const temporary = directory(process.env.TEMP ?? process.env.TMP);
  return {SystemRoot: systemRoot, WINDIR: systemRoot, TEMP: temporary, TMP: temporary};
}

function verifyPins(root: string, env: NodeJS.ProcessEnv, save: Save, name: string) {
  if (!existsSync(gitExecutable)) throw new Error('Reviewed absolute git.exe unavailable.');
  const git = (args: string[]) => execFileSync(gitExecutable, ['--no-pager', '-C', root, ...args], {
    env: {...env, GIT_NO_REPLACE_OBJECTS: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL'},
    windowsHide: true, timeout: 5000, maxBuffer: 1048576, stdio: ['ignore', 'pipe', 'pipe'],
  });
  expect(git(['rev-parse', '--verify', `${checkpoint}^{commit}`]).toString('ascii').trim()).toBe(checkpoint);
  const observedHead = git(['rev-parse', '--verify', 'HEAD']).toString('ascii').trim();
  expect(observedHead).toMatch(/^[a-f0-9]{40}$/); // Diagnostic only; unrelated commits may advance HEAD.
  const committed: Record<string, string> = {}, working: Record<string, string> = {}, consumerFrozen: Record<string, string> = {};
  for (const path of Object.keys(sourcePins)) {
    committed[path] = hash(git(['cat-file', 'blob', `${checkpoint}:${path}`]));
    working[path] = hash(readFileSync(join(root, path)));
  }
  for (const path of Object.keys(consumerFrozenPins)) consumerFrozen[path] = hash(readFileSync(resolve(import.meta.dirname, '../..', path)));
  save(name, JSON.stringify({checkpoint, observedHead, candidateSources: 16, enumeratedSources: Object.keys(sourcePins).length,
    committed, working, consumerFrozen, scope: 'enumerated source custody only; not complete dependency/configuration custody'}, null, 2) + '\n');
  for (const [path, expected] of Object.entries(sourcePins)) {
    expect(committed[path], `committed source ${path}`).toBe(expected);
    expect(working[path], `working source ${path}`).toBe(expected);
  }
  for (const [path, expected] of Object.entries(consumerFrozenPins)) expect(consumerFrozen[path], `consumer frozen source ${path}`).toBe(expected);
}

function startFixture(root: string, env: NodeJS.ProcessEnv, selected: Case, save: Save) {
  const python = join(root, '.venv/Scripts/python.exe'), script = join(root, 'tools/owner_discussion_stream_fixture.py');
  if (!existsSync(python) || !existsSync(script)) throw new Error('Requires existing locked interpreter and pinned fixture.');
  const args = ['-I', '-B', script, '--case', selected, '--seconds', '45'];
  const startedAt = new Date().toISOString(), deadline = performance.now() + 40000;
  const child = spawn(python, args, {cwd: root, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
  child.stdin.on('error', () => {});
  const stdout: Buffer[] = [], stderr: Buffer[] = [], lines: Buffer[] = [];
  let totalBytes = 0, stdoutBytes = 0, stderrBytes = 0, exceeded = false, forced = false;
  let fragment = Buffer.alloc(0), failure: Error | undefined;
  let waiting: {resolve: (line: Buffer) => void; reject: (error: Error) => void} | undefined;
  const fail = (error: Error) => {failure ??= error; waiting?.reject(error);};
  child.once('error', () => fail(new Error('Owned stream fixture failed to start.')));
  const collect = (chunk: Buffer, output: Buffer[]) => {
    const remaining = Math.max(0, maximumMetadataBytes - totalBytes);
    if (remaining) output.push(Buffer.from(chunk.subarray(0, remaining)));
    totalBytes += chunk.length;
    if (totalBytes > maximumMetadataBytes) {exceeded = true; fail(new Error('Fixture output exceeded 32768 bytes.')); return false;}
    return true;
  };
  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBytes += chunk.length;
    if (!collect(chunk, stdout)) return;
    fragment = Buffer.concat([fragment, chunk]);
    while (true) {
      const end = fragment.indexOf(10);
      if (end < 0) break;
      const line = Buffer.from(fragment.subarray(0, end + 1)); fragment = fragment.subarray(end + 1);
      if (line.byteLength > maximumMetadataBytes) {fail(new Error('Fixture event exceeded 32768 bytes.')); return;}
      if (waiting) {const current = waiting; waiting = undefined; current.resolve(line);} else lines.push(line);
    }
    if (fragment.byteLength > maximumMetadataBytes) fail(new Error('Fixture event exceeded 32768 bytes.'));
  });
  child.stderr.on('data', (chunk: Buffer) => {stderrBytes += chunk.length; collect(chunk, stderr);});
  const closed = new Promise<{code: number | null; signal: NodeJS.Signals | null}>(accept => {
    child.once('close', (code, signal) => {waiting?.reject(new Error('Fixture closed before its event.')); accept({code, signal});});
  });
  async function readLine(milliseconds = 3000) {
    if (failure) throw failure;
    const queued = lines.shift(); if (queued) return queued;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Fixture event unavailable after close.');
    try {return await bounded(new Promise<Buffer>((accept, reject) => {waiting = {resolve: accept, reject};}), Math.min(milliseconds, deadline - performance.now()));}
    finally {waiting = undefined;}
  }
  async function control(operation: Exclude<Control, 'stop'>) {
    if (performance.now() >= deadline) throw new Error('Fixture total deadline exceeded before control.');
    child.stdin.write(`${operation}\n`);
    const raw = await readLine(); save(`${operation}.json`, raw);
    const event = decodeBoundedJson(raw, 32768) as unknown as {base_url?: string};
    expect(event).toEqual({event: 'control', operation, done: true, ...(operation === 'restart' || operation === 'restore' ? {base_url: event.base_url} : {})});
    if (operation === 'restart' || operation === 'restore') {expect(event.base_url).toMatch(/^https:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);}
    return event.base_url;
  }
  const stop = async () => {
    let result: Awaited<typeof closed> | undefined, pidRemains: boolean | null = null;
    try {
      if (child.exitCode === null && child.signalCode === null) child.stdin.end('stop\n');
      try {result = await bounded(closed, 5000);} catch {
        forced = true; child.kill('SIGKILL'); await bounded(closed, 2000);
        throw new Error('Owned stream fixture required forced termination.');
      }
      if (child.pid !== undefined) {
        try {process.kill(child.pid, 0); pidRemains = true;} catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
          pidRemains = false;
        }
      }
      const raw = await readLine(100); save('stopped.json', raw);
      const count = {regular: 3, empty: 1, byte: 13}[selected];
      expect(decodeBoundedJson(raw, 32768)).toEqual({event: 'stopped', fixture_only: true,
        alpha_messages: count, alpha_receipts: count, alpha_acceptances: count,
        alpha_public_events: {regular: 0, empty: 1, byte: 12}[selected],
        expected_committed_counts: true, public_events_unique_and_contiguous: true, beta_rows_unchanged: true,
        historical_revisions_unchanged: true, read_only_observations: true, expected_controls: true,
        temporary_store_removed: true, control_thread_stopped: true,
        normal_stop: true, server_instances: selected === 'regular' ? 3 : 1, offline_restores: selected === 'regular' ? 1 : 0,
        controls: expectedControls[selected], exact_command_replays: 1, model_or_work_reexecutions: 0,
      });
      expect(forced).toBe(false); expect(result).toEqual({code: 0, signal: null}); expect(pidRemains).toBe(false); expect(stderrBytes).toBe(0);
      expect(child.stdout.readableEnded).toBe(true); expect(child.stderr.readableEnded).toBe(true);
      expect(child.stdout.destroyed).toBe(true); expect(child.stderr.destroyed).toBe(true);
      if (failure || exceeded) throw failure ?? new Error('Fixture output bound exceeded.');
      expect(lines).toHaveLength(0); expect(fragment.byteLength).toBe(0);
    } finally {
      save('fixture.stdout.raw', Buffer.concat(stdout)); save('fixture.stderr.raw', Buffer.concat(stderr));
      save('process.json', JSON.stringify({checkpoint, case: selected, python, script, args, pid: child.pid ?? null,
        startedAt, closedAt: new Date().toISOString(), environmentKeys: Object.keys(env),
        code: result?.code ?? child.exitCode, signal: result?.signal ?? child.signalCode,
        stdoutBytes, stderrBytes, rawOutputCap: maximumMetadataBytes, outputExceeded: exceeded,
        forcedTermination: forced, pidRemains, processReaped: result !== undefined,
        stdoutReaderStopped: child.stdout.readableEnded && child.stdout.destroyed,
        stderrReaderStopped: child.stderr.readableEnded && child.stderr.destroyed,
      }, null, 2) + '\n');
    }
  };
  return {readLine, control, stop, deadline};
}

interface Ready {base_url: string; ca_certificate: string}
interface RawOptions {method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: Buffer}

// Capture independent HTTPS bytes before strict decoding. No DB access or record IDs.
async function capture(origin: string, ca: Buffer, path: string, token: string, name: string, save: Save,
  signal: AbortSignal, options: RawOptions = {}) {
  return new Promise<{status: number; raw: Buffer}>((accept, reject) => {
    const url = new URL(origin), chunks: Buffer[] = [];
    let bytes = 0, finished = false;
    const method = options.method ?? 'GET';
    const headers: Record<string, string> = {Host: url.host, Authorization: `Bearer ${token}`, Connection: 'close', ...options.headers};
    if (options.body) headers['Content-Length'] = String(options.body.byteLength);
    const finish = (error?: Error, value?: {status: number; raw: Buffer}) => {
      if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      pending.destroy();
      if (error) reject(error); else accept(value!);
    };
    const abort = () => finish(new Error('Stream HTTPS total deadline exceeded.'));
    const pending = request({hostname: '127.0.0.1', port: url.port, path, method,
      ca, rejectUnauthorized: true, minVersion: 'TLSv1.2', agent: false, maxHeaderSize: 16384, headers}, response => {
      const socket = response.socket as TLSSocket, protocol = socket.getProtocol(), authorized = socket.authorized;
      response.on('data', (chunk: Buffer) => {
        if (finished) return;
        chunks.push(Buffer.from(chunk.subarray(0, Math.max(0, maximumResponseBytes - bytes)))); bytes += chunk.length;
        if (bytes > maximumResponseBytes) {save(`${name}.response.bin`, Buffer.concat(chunks)); finish(new Error('Response exceeded 262144 bytes.'));}
      });
      response.once('error', () => finish(new Error('Stream response stream failed.')));
      response.once('aborted', () => finish(new Error('Stream response stream aborted.')));
      response.once('end', () => {
        if (finished) return;
        const raw = Buffer.concat(chunks), status = response.statusCode ?? 0;
        save(`${name}.response.bin`, raw);
        save(`${name}.exchange.json`, JSON.stringify({method, path, origin, requestBodySHA256: options.body ? hash(options.body) : null,
          requestExtraHeaders: options.headers ?? {}, status, rawBytes: raw.byteLength, sha256: hash(raw),
          headers: response.rawHeaders, tlsProtocol: protocol, tlsAuthorized: authorized,
        }, null, 2) + '\n');
        if (!response.complete || response.headers['content-type'] !== 'application/json; charset=utf-8' ||
          response.headers['content-encoding'] !== undefined || response.headers['content-length'] !== String(raw.length) ||
          response.headers['cache-control'] !== 'no-store' || !authorized || !['TLSv1.2', 'TLSv1.3'].includes(protocol ?? '')) {
          finish(new Error('Stream response headers/TLS do not match the fixed ingress.')); return;
        }
        finish(undefined, {status, raw});
      });
    });
    const timer = setTimeout(abort, 3000);
    pending.once('error', () => finish(new Error('Stream HTTPS transport failed.')));
    signal.addEventListener('abort', abort, {once: true});
    if (signal.aborted) {abort(); return;}
    pending.end(options.body);
  });
}

function assertDigest(value: {readonly digest: string}) {
  expect(value.digest).toBe(hash(canonicalBytes(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'digest')))));
}
function assertItem(item: OwnerDiscussionReadBack, sequence: number, selected: Case) {
  const {conversation, message, receipt} = item;
  expect(item).toMatchObject({projection_type: 'owner_discussion_record', company_id: 'leo-company', scope: {kind: 'project', id: 'alpha'},
    observation: {source: 'stored_record', evidence_scope: 'stored_record', live_verified: false}});
  expect(conversation.revision).toBe(sequence); expect(message.conversation_sequence).toBe(sequence);
  expect(message.summary).toBe(selected === 'byte' ? '\u00e9'.repeat(512) : `Alpha discussion ${sequence}`);
  expect(message.body).toBe(selected === 'byte' ? '\u0001'.repeat(4000) : `Alpha note ${sequence}: \u00e9 and \u{1f30a}`);
  for (const [record, reference] of [[conversation, receipt.conversation_ref], [message, receipt.message_ref]] as const) {
    assertDigest(record);
    expect(reference).toEqual({kind: record.record_type, id: record.id, company_id: 'leo-company', scope: {kind: 'project', id: 'alpha'},
      availability: 'available', revision: record.revision, digest: record.digest, unavailable_reason: null});
  }
  expect(message.conversation_ref).toEqual(receipt.conversation_ref);
  expect(message.recorded_author.principal_id).toBe(receipt.principal_id);
  expect(receipt.command_id).toBe(`20000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`);
  // Response-derived reconstruction checks internal consistency only. It is never
  // sent to the service or represented as independently retained append evidence.
  const reconstructed = {schema_version: 1, action: receipt.action, command_id: receipt.command_id, summary: message.summary, body: message.body};
  expect(canonicalBytes(reconstructed).byteLength).toBeLessThan(32768);
  expect(receipt.request_digest).toBe(hash(canonicalBytes({contract: 'maritime-owner-discussion', version: 1,
    company_id: 'leo-company', scope: {kind: 'project', id: 'alpha'}, command: reconstructed})));
  assertDigest(item);
}

function productHashes() {
  return Object.fromEntries(productPaths.map(path => {
    const bytes = readFileSync(resolve(import.meta.dirname, '../..', path));
    return [path, {bytes: bytes.byteLength, sha256: hash(bytes)}];
  }));
}


function reference(value: {record_type: string; id: string; revision: number; digest: string; company_id: string; scope: unknown}) {
  return {kind: value.record_type, id: value.id, company_id: value.company_id, scope: value.scope,
    availability: 'available', revision: value.revision, digest: value.digest, unavailable_reason: null};
}
function assertSnapshot(page: SnapshotPage, raw: Uint8Array, limit: number, head: number, selected: Case, previous?: SnapshotPage) {
  expect(raw.byteLength).toBeLessThanOrEqual(maximumResponseBytes);
  expect(Buffer.from(canonicalBytes(page))).toEqual(Buffer.from(raw));
  assertDigest(page); assertDigest(page.room_head);
  expect(page).toMatchObject({schema_version: 1, projection_type: 'owner_discussion_snapshot',
    company_id: 'leo-company', scope: {kind: 'project', id: 'alpha'}, requested_limit: limit,
    order: 'conversation_sequence_descending',
    limits: {max_items: 50, max_event_utf8_bytes: 65536, max_response_utf8_bytes: maximumResponseBytes, max_cursor_chars: 4096},
    observation: {source: 'stored_record', evidence_scope: 'stored_record', live_verified: false}});
  const floor = {regular: 3, byte: 1, empty: 0}[selected], cut = page.snapshot;
  expect(cut).toMatchObject({kind: 'owner_discussion_public_cut', visibility_revision: 1,
    coverage_floor: {sequence: floor}, watermark: {position: head - floor}});
  for (const id of [cut.id, cut.incarnation, cut.stream_epoch]) expect(id).toMatch(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  expect(cut.access_digest).toMatch(/^[a-f0-9]{64}$/);
  expect(cut.expires_at_utc_epoch_ms - cut.issued_at_utc_epoch_ms).toBe(300000);
  expect(page.observed_at_utc_epoch_ms).toBeGreaterThanOrEqual(cut.issued_at_utc_epoch_ms);
  expect(page.room_head.revision).toBe(head);
  expect(cut.watermark.conversation_ref).toEqual(reference(page.room_head));
  expect(cut.watermark.event_ref === null).toBe(head === floor);
  if (!floor) {
    expect(cut.coverage_floor.conversation_ref).toBeNull(); expect(cut.coverage_floor.message_ref).toBeNull();
  } else {
    expect(cut.coverage_floor.conversation_ref?.revision).toBe(floor);
    expect(cut.coverage_floor.conversation_ref?.id).toBe(page.room_head.id);
  }
  const start = previous ? previous.range.next_sequence! : head;
  const sequences = page.items.map(item => item.message.conversation_sequence), end = sequences.at(-1)!;
  expect(sequences.length).toBeGreaterThan(0);
  expect(sequences.length).toBeLessThanOrEqual(limit);
  expect(sequences).toEqual(Array.from({length: sequences.length}, (_, index) => start - index));
  for (const item of page.items) {
    assertItem(item, item.message.conversation_sequence, selected === 'empty' ? 'regular' : selected);
    expect(item.conversation.id).toBe(page.room_head.id);
  }
  if (previous) {
    expect(cut).toEqual(previous.snapshot); expect(page.room_head).toEqual(previous.room_head);
  } else {
    expect(page.room_head).toEqual(page.items[0].conversation);
    expect(cut.watermark.message_ref).toEqual(reference(page.items[0].message));
  }
  expect(page.range).toEqual({start_sequence: start, end_sequence: end, next_sequence: end > 1 ? end - 1 : null});
  expect(page.has_more).toBe(end > 1);
  expect(page.coverage).toEqual({status: end > 1 ? 'partial' : 'complete_for_cut',
    truncation: end === 1 ? 'none' : sequences.length === limit ? 'item_limit' : 'byte_limit', total_count: null});
  if (end > 1) {
    expect(page.next_snapshot_cursor).toMatch(/^[A-Za-z0-9_-]{1,4096}$/); expect(page.changes_cursor).toBeNull();
  } else {
    expect(page.next_snapshot_cursor).toBeNull(); expect(page.changes_cursor).toMatch(/^[A-Za-z0-9_-]{1,4096}$/);
  }
}
function assertChanges(page: ChangesPage, raw: Uint8Array, limit: number, cut: SnapshotPage['snapshot'],
  after: number, observed: number, selected: Case) {
  expect(raw.byteLength).toBeLessThanOrEqual(maximumResponseBytes);
  expect(Buffer.from(canonicalBytes(page))).toEqual(Buffer.from(raw)); assertDigest(page);
  expect(page).toMatchObject({schema_version: 1, projection_type: 'owner_discussion_changes',
    company_id: 'leo-company', scope: {kind: 'project', id: 'alpha'}, requested_limit: limit,
    order: 'public_event_sequence_ascending',
    limits: {max_items: 50, max_event_utf8_bytes: 65536, max_response_utf8_bytes: maximumResponseBytes, max_cursor_chars: 4096},
    observation: {source: 'stored_record', evidence_scope: 'stored_record', live_verified: false}});
  expect(page.snapshot).toEqual(cut);
  expect(page.items.length).toBeLessThanOrEqual(limit);
  const positions = page.items.map(item => item.event.sequence), end = positions.at(-1) ?? after;
  expect(positions).toEqual(Array.from({length: positions.length}, (_, index) => after + index + 1));
  expect(page.range).toEqual({after_position: after, start_position: positions.length ? after + 1 : null,
    end_position: end, observed_through_position: observed});
  expect(page.caught_up).toBe(end === observed);
  expect(page.coverage).toEqual({status: end === observed ? 'caught_up_through_observed' : 'partial',
    truncation: end === observed ? 'none' : positions.length === limit ? 'item_limit' : 'byte_limit', total_count: null});
  expect(page.next_cursor).toMatch(/^[A-Za-z0-9_-]{1,4096}$/);
  for (const item of page.items) {
    expect(canonicalBytes(item).byteLength).toBeLessThanOrEqual(65536); assertDigest(item); assertDigest(item.event);
    const {event, record} = item, sequence = cut.coverage_floor.sequence + event.sequence;
    assertItem(record, sequence, selected === 'empty' ? 'regular' : selected);
    expect(event).toMatchObject({record_type: 'communication_event', schema_version: 1, revision: 1, visibility_revision: 1,
      company_id: 'leo-company', scope: {kind: 'project', id: 'alpha'}, event_type: 'owner_discussion.message_stored',
      producer: {kind: 'company_service', component: 'owner_discussion_acceptance', version: 1},
      stream_epoch: cut.stream_epoch, recorded_at_utc_epoch_ms: record.message.recorded_at_utc_epoch_ms,
      observation: {source: 'stored_record', evidence_scope: 'stored_record', live_verified: false}});
    expect(event.conversation_ref).toEqual(reference(record.conversation));
    expect(event.message_ref).toEqual(reference(record.message));
    expect(event.conversation_ref.id).toBe(cut.watermark.conversation_ref.id);
    expect(event.accepted_command).toEqual({action: 'owner.discussion.append', principal_id: record.receipt.principal_id,
      command_id: record.receipt.command_id, request_digest: record.receipt.request_digest});
  }
}
function changesState(state: SnapshotResult['state']): ChangesState {
  if (state.mode !== 'changes') throw new Error('Complete baseline required before catch-up.');
  return state;
}
function snapshotState(state: SnapshotResult['state']): SnapshotState {
  if (state.mode !== 'snapshot') throw new Error('Expected an incomplete snapshot.');
  return state;
}

for (const selected of ['regular', 'byte', 'empty'] as const) {
  it.skipIf(!fixtureRoot)('consumes actual disposable verified-TLS C07 stream fixture (' + selected + ')', async () => {
    const env = environment(), root = realpathSync.native(resolve(fixtureRoot!));
    expect(root.toLowerCase()).toBe(realpathSync.native(reviewedRoot).toLowerCase());
    const evidenceRoot = resolve(import.meta.dirname, '../../.harness-company-evidence');
    mkdirSync(evidenceRoot, {recursive: true});
    const evidence = mkdtempSync(join(evidenceRoot, 'stream-https-' + selected + '-'));
    const saved: Record<string, {bytes: number; sha256: string}> = {};
    const save: Save = (name, raw) => {
      const bytes = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw;
      writeFileSync(join(evidence, name), bytes, {flag: 'wx'});
      saved[name] = {bytes: bytes.byteLength, sha256: hash(bytes)};
    };
    // Permission, project and fixed query are retained before obtaining fixture credentials.
    const expected: ReadContext = {company_id: 'leo-company', scope: {kind: 'project', id: 'alpha'}};
    const beta: ReadContext = {company_id: 'leo-company', scope: {kind: 'project', id: 'beta'}};
    const limit = {regular: 2, byte: 50, empty: 20}[selected];
    const initialRequest = normalizeOwnerDiscussionStreamRequest('snapshot', expected, limit, null);
    save('retained-authority.json', JSON.stringify({expected, initialRequest, fixtureOnly: true}, null, 2) + '\n');
    let failure: unknown, fixture: ReturnType<typeof startFixture> | undefined;
    let beforeProduct: ReturnType<typeof productHashes> | undefined;
    const total = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      verifyPins(root, env, save, 'source-before.json');
      beforeProduct = productHashes(); save('product-before.json', JSON.stringify(beforeProduct, null, 2) + '\n');
      fixture = startFixture(root, env, selected, save);
      timer = setTimeout(() => total.abort(), Math.max(1, fixture.deadline - performance.now()));
      const readyRaw = await fixture.readLine(12000); save('ready.json', readyRaw);
      const ready = decodeBoundedJson(readyRaw, maximumMetadataBytes) as unknown as Ready;
      const certificate = join(root, 'tests/communications/fixtures/owner-history-test.cert.pem');
      expect(ready).toEqual({event: 'ready', fixture_only: true, base_url: ready.base_url,
        bearer_token: publicToken, other_owner_token: otherToken, ca_certificate: certificate,
        company_id: expected.company_id, project_id: expected.scope.id, case: selected, actual_live_employees: 0});
      expect(ready.base_url).toMatch(/^https:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
      const ca = readFileSync(certificate);
      expect(hash(ca)).toBe(sourcePins['tests/communications/fixtures/owner-history-test.cert.pem']);
      let origin = ready.base_url;
      const client = (token = publicToken, trust: Buffer | string = ca) => new OwnerDiscussionStreamClient({
        origin, role: 'owner', credential: () => token, ca: trust, timeoutMs: 3000});
      let owner = client();
      const exchanges: {name: string; status: number; rawBytes: number; sha256: string}[] = [];
      const wire = async (name: string, path = snapshotRoute, token = publicToken, options?: RawOptions) => {
        const result = await capture(origin, ca, path, token, name, save, total.signal, options);
        exchanges.push({name, status: result.status, rawBytes: result.raw.byteLength, sha256: hash(result.raw)});
        return result;
      };
      const denied = async (name: string, status: number, code: string, path = snapshotRoute, token = publicToken, options?: RawOptions) => {
        const result = await wire(name, path, token, options); expect(result.status).toBe(status);
        expect(decodeBoundedJson(result.raw, maximumResponseBytes)).toEqual({schema_version: 1, error: {code}});
      };
      const pathFor = (mode: 'snapshot' | 'changes', state: SnapshotState | ChangesState) =>
        (mode === 'snapshot' ? snapshotRoute : changesRoute) + '?limit=' + state.requestedLimit + '&cursor=' + state.nextCursor;
      const initialPath = snapshotRoute + '?limit=' + limit;
      const snapshots: SnapshotPage[] = [], pages: ChangesPage[] = [], pageRaw: Buffer[] = [];
      const projection = new Map<string, Buffer>();
      const apply = (items: readonly EventItem[]) => {
        for (const item of items) {
          const identity = item.event.id + ':' + item.event.revision, bytes = Buffer.from(canonicalBytes(item));
          if (projection.has(identity)) expect(projection.get(identity)).toEqual(bytes);
          else projection.set(identity, bytes);
        }
      };
      await expect(client('PUBLIC-wrong-stream-fixture-token').start(expected, limit, total.signal))
        .rejects.toMatchObject({code: 'AUTHENTICATION_REQUIRED'});
      await denied('wrong-token', 401, 'AUTHENTICATION_REQUIRED', snapshotRoute, 'PUBLIC-wrong-stream-fixture-token');
      await expect(owner.start(beta, limit, total.signal)).rejects.toMatchObject({code: 'SCOPE_DENIED'});
      await denied('foreign-project', 403, 'SCOPE_DENIED', snapshotRoute.replace('/alpha/', '/beta/'));
      await expect(client(publicToken, rootCertificates[0]).start(expected, limit, total.signal)).rejects.toMatchObject({code: 'TRANSPORT'});
      save('wrong-ca.json', JSON.stringify({wrongCARejected: true, hostnameVerificationRequired: true,
        rejectUnauthorized: true, insecureAgent: false, rawResponseAvailable: false}, null, 2) + '\n');
      await denied('changes-without-cursor', 400, 'INVALID_REQUEST', changesRoute);
      await denied('post', 404, 'NOT_FOUND', snapshotRoute, publicToken, {method: 'POST'});
      for (const [index, suffix] of ['?limit=0', '?limit=51', '?limit=01', '?cursor=', '?extra=1', '?limit=2&limit=2', '?limit=%32'].entries()) {
        await denied('invalid-query-' + index, 400, 'INVALID_REQUEST', snapshotRoute + suffix);
      }
      for (const [name, headers] of [['origin', {Origin: ''}], ['content-type', {'Content-Type': ''}],
        ['transfer-encoding', {'Transfer-Encoding': ''}], ['content-encoding', {'Content-Encoding': ''}]] as const) {
        await denied('framing-' + name, 400, 'INVALID_REQUEST', snapshotRoute, publicToken, {headers});
      }
      await denied('framing-body', 400, 'INVALID_REQUEST', snapshotRoute, publicToken, {body: Buffer.from('x')});
      let terminal: SnapshotResult;
      const baseline = {regular: 3, byte: 1, empty: 1}[selected];
      if (selected === 'empty') {
        await expect(owner.start(expected, limit, total.signal)).rejects.toMatchObject({code: 'NOT_FOUND'});
        await denied('empty-unbound', 404, 'NOT_FOUND', initialPath);
        await fixture.control('append');
      } else {
        await expect(client(otherToken).start(expected, limit, total.signal)).rejects.toMatchObject({code: 'SCOPE_DENIED'});
        await denied('other-owner', 403, 'SCOPE_DENIED', initialPath, otherToken);
      }
      const firstWire = await wire('snapshot-first', initialPath); expect(firstWire.status).toBe(200);
      const first = await validateOwnerDiscussionSnapshot(firstWire.raw, expected, initialRequest);
      assertSnapshot(first.page, firstWire.raw, limit, baseline, selected); snapshots.push(first.page);
      const independentlyStarted = await owner.start(expected, limit, total.signal);
      assertSnapshot(independentlyStarted.page, canonicalBytes(independentlyStarted.page), limit, baseline, selected);
      expect(independentlyStarted.page.snapshot.id).not.toBe(first.page.snapshot.id);
      expect(independentlyStarted.page.items).toEqual(first.page.items);
      if (selected !== 'empty') await fixture.control('append');
      terminal = first;
      if (first.page.has_more) {
        const state = snapshotState(first.state), retained = Buffer.from(canonicalBytes(state));
        await denied('snapshot-cursor-in-changes-mode', 409, 'RESYNC_REQUIRED', pathFor('changes', state));
        const next = await owner.continueSnapshot(expected, state, total.signal);
        const raw = await wire('snapshot-second', pathFor('snapshot', state)); expect(raw.status).toBe(200);
        const validated = await validateOwnerDiscussionSnapshot(raw.raw, expected,
          normalizeOwnerDiscussionStreamRequest('snapshot', expected, limit, state.nextCursor), state);
        expect(next).toEqual(validated); assertSnapshot(next.page, raw.raw, limit, baseline, selected, first.page);
        const repeated = await wire('snapshot-second-repeat', pathFor('snapshot', state));
        expect(repeated.raw).toEqual(raw.raw);
        expect(Buffer.from(canonicalBytes(state))).toEqual(retained); snapshots.push(next.page); terminal = next;
      }
      expect(terminal.page.has_more).toBe(false);
      expect(snapshots.flatMap(page => page.items.map(item => item.message.conversation_sequence)))
        .toEqual(Array.from({length: baseline}, (_, index) => baseline - index));
      const completedBaseline = snapshots.flatMap(page => page.items);
      const floorRecord = completedBaseline.find(item => item.message.conversation_sequence === first.page.snapshot.coverage_floor.sequence);
      if (floorRecord) {
        expect(first.page.snapshot.coverage_floor.conversation_ref).toEqual(reference(floorRecord.conversation));
        expect(first.page.snapshot.coverage_floor.message_ref).toEqual(reference(floorRecord.message));
      }
      let latest = changesState(terminal.state);
      const original = latest, originalBytes = Buffer.from(canonicalBytes(original));
      const originalPath = pathFor('changes', original), cut = first.page.snapshot;
      await denied('changes-cursor-in-snapshot-mode', 409, 'RESYNC_REQUIRED', pathFor('snapshot', original));
      const readChanges = async (name: string, state: ChangesState, observed: number) => {
        const result = await owner.changes(expected, state, total.signal);
        const raw = await wire(name, pathFor('changes', state)); expect(raw.status).toBe(200);
        const validated = await validateOwnerDiscussionChanges(raw.raw, expected,
          normalizeOwnerDiscussionStreamRequest('changes', expected, state.requestedLimit, state.nextCursor), state);
        expect(result).toEqual(validated);
        assertChanges(result.page, raw.raw, state.requestedLimit, state.snapshot, state.position, observed, selected);
        return {result, raw: raw.raw};
      };
      const one = await readChanges('changes-initial', original, 1);
      if (selected === 'empty') {
        expect(one.result.page.items).toEqual([]); expect(one.result.applied).toEqual([]);
        latest = one.result.state;
        await fixture.control('replay');
        const idle = await readChanges('empty-after-replay', latest, 1);
        expect(idle.raw).toEqual(one.raw); expect(idle.result.applied).toEqual([]);
      } else {
        expect(one.result.page.items.map(item => item.event.sequence)).toEqual([1]);
        apply(one.result.applied); latest = one.result.state;
        await fixture.control('append-many');
        const observed = selected === 'regular' ? 6 : 12;
        // This old cursor overlaps event1 and can now include newly committed tail.
        await owner.changes(expected, original, total.signal); // Fully received reply deliberately discarded.
        const replay = await readChanges('changes-old-cursor-after-discard', original, observed);
        const repeated = await readChanges('changes-old-cursor-repeat', original, observed);
        expect(repeated.raw).toEqual(replay.raw);
        expect(replay.result.page.items[0]).toEqual(one.result.page.items[0]);
        expect(Buffer.from(canonicalBytes(original))).toEqual(originalBytes);
        const forged = (original.nextCursor[0] === 'A' ? 'B' : 'A') + original.nextCursor.slice(1);
        await denied('forged-cursor', 409, 'RESYNC_REQUIRED', changesRoute + '?limit=' + limit + '&cursor=' + forged);
        await denied('changed-limit', 409, 'RESYNC_REQUIRED', changesRoute + '?limit=1&cursor=' + original.nextCursor);
        await denied('other-owner-cursor', 403, 'SCOPE_DENIED', originalPath, otherToken);
        await denied('foreign-project-cursor', 403, 'SCOPE_DENIED', originalPath.replace('/alpha/', '/beta/'));
        await denied('wrong-token-cursor', 401, 'AUTHENTICATION_REQUIRED', originalPath, 'PUBLIC-wrong-stream-fixture-token');
        let current = replay;
        for (let index = 0; index < 8; index++) {
          pages.push(current.result.page); pageRaw.push(current.raw);
          const merged = await projectOwnerDiscussionChanges(latest, current.result);
          const expectedNew = current.result.page.items.filter(item => !projection.has(item.event.id + ':' + item.event.revision));
          expect(merged.applied).toEqual(expectedNew); apply(merged.applied); latest = merged.state;
          if (current.result.page.caught_up) break;
          current = await readChanges('changes-page-' + (index + 2), latest, observed);
        }
        expect(pages.at(-1)?.caught_up).toBe(true);
        expect(latest.position).toBe(observed); expect(projection.size).toBe(observed);
        const all = pages.flatMap(page => page.items);
        expect(all.map(item => item.event.sequence)).toEqual(Array.from({length: observed}, (_, index) => index + 1));
        expect(new Set(all.map(item => item.event.id)).size).toBe(observed);
        expect(all.map(item => item.record.message.conversation_sequence))
          .toEqual(Array.from({length: observed}, (_, index) => baseline + index + 1));
        const noAdvance = await projectOwnerDiscussionChanges(latest, repeated.result);
        expect(noAdvance.applied).toEqual([]); expect(noAdvance.state).toEqual(latest);
        const idle = await readChanges('changes-idle', latest, observed);
        expect(idle.result.page.items).toEqual([]); expect(idle.result.applied).toEqual([]);
        latest = idle.result.state;
        if (selected === 'byte') {
          expect(pages).toHaveLength(2); expect(pages[0].coverage.truncation).toBe('byte_limit');
          const nextWholePrefixBytes = canonicalBytes({...pages[0], items: [...pages[0].items, pages[1].items[0]]}).byteLength;
          expect(nextWholePrefixBytes).toBeGreaterThan(maximumResponseBytes);
          expect(pageRaw[0].includes(Buffer.from('\\u0001'))).toBe(true);
          expect(pageRaw[0].includes(Buffer.from('\u00e9', 'utf8'))).toBe(true);
          save('byte-sizing.json', JSON.stringify({rawBytes: pageRaw[0].byteLength, returnedWholeItems: pages[0].items.length,
            nextWholePrefixBytes, maximumResponseBytes, sizingOnly: true, fabricatedCompletePage: false}, null, 2) + '\n');
        }
        await fixture.control('replay');
        const afterExactReplay = await readChanges('changes-after-exact-append-replay', latest, observed);
        expect(afterExactReplay.raw).toEqual(idle.raw); expect(afterExactReplay.result.applied).toEqual([]);
        const oldAfterExactReplay = await readChanges('changes-old-cursor-after-exact-append-replay', original, observed);
        expect(oldAfterExactReplay.raw).toEqual(replay.raw);
        if (selected === 'regular') {
          const resync = async (name: string, state: ChangesState, status: 409 | 410) => {
            await expect(owner.changes(expected, state, total.signal)).rejects.toMatchObject({code: 'RESYNC_REQUIRED', status});
            await denied(name, status, 'RESYNC_REQUIRED', pathFor('changes', state));
          };
          const fresh = async (name: string, head: number) => {
            const result = await owner.start(expected, 50, total.signal);
            assertSnapshot(result.page, canonicalBytes(result.page), 50, head, selected);
            const raw = await wire(name, snapshotRoute + '?limit=50'); expect(raw.status).toBe(200);
            const independentlyValidated = await validateOwnerDiscussionSnapshot(raw.raw, expected,
              normalizeOwnerDiscussionStreamRequest('snapshot', expected, 50, null));
            assertSnapshot(independentlyValidated.page, raw.raw, 50, head, selected);
            expect(independentlyValidated.page.items).toEqual(result.page.items);
            return result;
          };
          const initialOrigin = origin;
          origin = (await fixture.control('restart'))!; expect(origin).not.toBe(initialOrigin); owner = client();
          await resync('restart-old-cursor', latest, 409);
          const restarted = await fresh('snapshot-restarted', 9);
          expect(restarted.page.snapshot.incarnation).not.toBe(cut.incarnation);
          expect(restarted.page.snapshot.watermark.event_ref).toEqual(reference(all.at(-1)!.event));
          const historical = new Map(all.map(item => [item.record.message.id, Buffer.from(canonicalBytes(item.record))]));
          for (const item of restarted.page.items.filter(item => item.message.conversation_sequence > baseline)) {
            expect(Buffer.from(canonicalBytes(item))).toEqual(historical.get(item.message.id));
          }
          const restartedOrigin = origin;
          origin = (await fixture.control('restore'))!; expect(origin).not.toBe(restartedOrigin); owner = client();
          await resync('restore-old-cursor', changesState(restarted.state), 409);
          const restored = await fresh('snapshot-restored', 3);
          expect(restored.page.snapshot.incarnation).not.toBe(restarted.page.snapshot.incarnation);
          await fixture.control('expire'); await resync('expired-cursor', changesState(restored.state), 410);
          const renewed = await fresh('snapshot-renewed', 3);
          expect(renewed.page.snapshot.issued_at_utc_epoch_ms).toBe(1793664301000);
          await fixture.control('access-change'); await resync('access-changed-cursor', changesState(renewed.state), 409);
          const changed = await fresh('snapshot-access-changed', 3);
          expect(changed.page.snapshot.access_digest).not.toBe(renewed.page.snapshot.access_digest);
          await fixture.control('revoke-principal');
          await expect(owner.start(expected, limit, total.signal)).rejects.toMatchObject({code: 'AUTHENTICATION_REQUIRED'});
          await denied('principal-revoked-main', 401, 'AUTHENTICATION_REQUIRED');
          await expect(client(otherToken).start(expected, limit, total.signal)).rejects.toMatchObject({code: 'SCOPE_DENIED'});
          await denied('principal-revoked-other', 403, 'SCOPE_DENIED', snapshotRoute, otherToken);
          await fixture.control('revoke');
          for (const [name, token] of [['main', publicToken], ['other', otherToken]] as const) {
            await expect(client(token).start(expected, limit, total.signal)).rejects.toMatchObject({code: 'AUTHENTICATION_REQUIRED'});
            await denied('registry-revoked-' + name, 401, 'AUTHENTICATION_REQUIRED', snapshotRoute, token);
          }
          save('lifecycle.json', JSON.stringify({explicitFreshSnapshots: true, silentReset: false,
            restartedHead: 9, restoredHead: 3, offlineSeedBackupRestore: true, lostLaterAppends: 6,
            losslessProductionRecovery: false, syntheticClockAdvanceSeconds: 301,
            snapshotIds: [first, restarted, restored, renewed, changed].map(result => result.page.snapshot.id)}, null, 2) + '\n');
        }
      }
      expect(performance.now()).toBeLessThan(fixture.deadline);
      save('consumer.json', JSON.stringify({checkpoint, case: selected, proof: 'actual_disposable_verified_https_public_snapshot_catchup',
        company: expected.company_id, project: expected.scope.id, independentlyRetainedLimit: limit,
        baselineSequences: snapshots.flatMap(page => page.items.map(item => item.message.conversation_sequence)),
        baselineHistoricalIdentities: completedBaseline.map(item => ({messageId: item.message.id,
          conversationRef: item.message.conversation_ref, messageRef: item.receipt.message_ref, digest: item.digest})),
        initialWatermarkPosition: cut.watermark.position, coverageFloor: cut.coverage_floor,
        changesPages: pages.map((page, index) => ({rawBytes: pageRaw[index].byteLength, sha256: hash(pageRaw[index]),
          range: page.range, snapshot: page.snapshot, eventIdentities: page.items.map(item =>
            ({id: item.event.id, revision: item.event.revision, sequence: item.event.sequence, digest: item.event.digest,
              conversationRef: item.event.conversation_ref, messageRef: item.event.message_ref})), pageDigest: page.digest})),
        appliedEventIdentities: [...projection.keys()], noGapsOrDoubles: true, completeBaselineBeforeHandoff: true,
        immutableEventPrefixAcrossOldCursorRetry: true, oldCursorCanObserveNewTail: selected !== 'empty',
        exactAppendReplayCreatesNoEvent: true, wrongCARejected: true, exchanges,
        reconstructedAppendDigestProof: 'response internal consistency only; not independently retained append provenance',
        scope: 'public synthetic disposable same-host TLS; enumerated source custody only',
        liveVerified: false, companyAccepted: false, nativeAccepted: false, remoteOwnerSessionAccepted: false,
        fullC07Accepted: false, sseAccepted: false, recoveryAccepted: false}, null, 2) + '\n');
    } catch (error) {failure = error;}
    finally {
      clearTimeout(timer); total.abort();
      if (fixture) try {await fixture.stop();} catch (error) {
        failure = failure ? new AggregateError([failure, error], 'Consumer and fixture cleanup failed.') : error;
      }
      try {
        verifyPins(root, env, save, 'source-after.json');
        const afterProduct = productHashes(); save('product-after.json', JSON.stringify(afterProduct, null, 2) + '\n');
        if (beforeProduct) expect(afterProduct).toEqual(beforeProduct);
      } catch (error) {failure = failure ? new AggregateError([failure, error], 'Consumer or source custody failed.') : error;}
      save('result.json', JSON.stringify({checkpoint, case: selected, status: failure ? 'failed' : 'passed',
        failure: failure instanceof Error ? {name: failure.name, message: failure.message,
          causes: failure instanceof AggregateError ? failure.errors.map(cause => cause instanceof Error ?
            {name: cause.name, message: cause.message} : String(cause)) : []} : failure ? {name: 'UnknownFailure'} : null,
        files: saved}, null, 2) + '\n');
      console.info('Owner discussion stream HTTPS consumer evidence: ' + evidence);
    }
    if (failure) throw failure;
  }, 55000);
}

