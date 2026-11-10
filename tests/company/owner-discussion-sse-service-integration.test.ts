import {execFileSync, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync} from 'node:fs';
import {request} from 'node:https';
import {isAbsolute, join, resolve} from 'node:path';
import {rootCertificates, type TLSSocket} from 'node:tls';
import {expect, it} from 'vitest';
import {OwnerDiscussionSSEClient, OwnerDiscussionSSEError} from '../../packages/company-client/owner-discussion-sse.ts';
import {OwnerDiscussionStreamClient} from '../../packages/company-client/owner-discussion-stream.ts';
import {canonicalBytes, decodeBoundedJson} from '../../packages/company-contracts/communications/json.ts';
import {normalizeOwnerDiscussionStreamRequest, validateOwnerDiscussionChanges, validateOwnerDiscussionSnapshot,
  projectOwnerDiscussionChanges, type OwnerDiscussionChangesState, type OwnerDiscussionSnapshotState,
  type OwnerDiscussionChangesResult} from '../../packages/company-contracts/communications/owner-discussion-stream.ts';
import type {ReadContext} from '../../packages/company-contracts/communications/reads.ts';

const fixtureRoot = process.env.GEN_COMPANY_OWNER_DISCUSSION_SSE_FIXTURE_ROOT;
const reviewedRoot = 'C:/Users/user/Documents/Maritime/hermes-swarm-control';
const checkpoint = '3c2ec7acf393f86a59a4c70aaec672fb8bc34d80';
const frozenCheckpoint = '10bc0d8d20ba55f95130bdb0724800850cbb0c06';
const gitExecutable = 'C:\\Program Files\\Git\\cmd\\git.exe';
const publicToken = 'PUBLIC-disposable-owner-discussion-thread-HTTPS-fixture-only';
const rotatedToken = 'PUBLIC-disposable-same-owner-rotated-SSE-fixture-only';
const otherToken = 'PUBLIC-disposable-other-owner-discussion-thread-fixture-only';
const base = '/company/v1/projects/alpha/owner-discussion/';
const expectedControls = ['append', 'burst', 'replay', 'expire', 'revoke-registry', 'revoke-store', 'stop'];
type Control = 'append' | 'burst' | 'replay' | 'expire' | 'revoke-registry' | 'revoke-store' | 'stats';
type Save = (name: string, raw: string | Uint8Array) => void;
type SSEEvent = {kind: 'comment'; comment: 'connected' | 'keepalive'; rawFrame: Uint8Array} |
  {kind: 'changes'; result: OwnerDiscussionChangesResult; rawFrame: Uint8Array};
type Stream = ReturnType<OwnerDiscussionSSEClient['open']>;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

// Literal custody of the nine new paths and checkpoint seal. No old test is repinned.
const sourcePins = {
  'src/company/comms/sse.py': '1ebb8a1c889896fb6c5b460c7d285a31b2363cf77950033366f71ca60ce9c2ca',
  'tests/communications/test_sse.py': '7293f3e49e4e8aad8943ba97f9253eb5d1d93a1fd6311e9416d90ef8916519e1',
  'tools/owner_discussion_sse_fixture.py': '27739b89b777dca2a7e5211530bbed5ae1cf94a8fc8783ea6d2abff8b7dd35d7',
  'tests/communications/test_owner_discussion_sse_fixture.py': '336494d2530a6d7ced41e59c55c8e2dca85131d4e8f2c20abe7a3bdddec73e58',
  'tests/communications/test_sse_transport.py': 'd7eb0c71b28ebc2a025cc18c25ac7aa86d44a8dfdf890d41e6a80f7ba1bd34e8',
  'contracts/communications/owner-discussion-stream-candidate.1/sse.json': '2e2460b26be8463b671296590c2963bd68387a55ac133ab985b189387511b7c1',
  'docs/integrations/owner-discussion-sse.md': '760455473e7b6917d18634a8cc53701157e4ef0693a50e89d58883a4bcdd56d7',
  'docs/integrations/owner-discussion-sse-fixture.md': '19daa07ceb3b045260d475031ee17fc3e4ec5b04ac8c0abb6d8c6dd4ea4c0bde',
  '.gitattributes': 'ecd9a09760b34860eb3daf3af23a006f5a315885497daacafa678fd987a97f29',
  'docs/evidence/owner-discussion-sse-2026-11-03/checkpoint.json': 'baaa7696b9feef0f78b86bd6b8e9d7d4e9f5111d6e96d70bdcac45ec910636aa',
};
const dependencyPins = {
  'src/company/comms/events.py': '6b6bbf9319df380e37f57d06f538e827859bcf90182d31f7dc9a1036853ed1bc',
  'src/company/comms/streams.py': 'a19a489d3797ef46801a81bf337d75de34d9c1619418f4c37b78eed2b8aa1097',
  'src/company/comms/owner_discussion_stream_ingress.py': '7e71036f1240bb7c70fdd8629a7111f2b6476f51328f85ec30372e1e19779633',
  'src/company/migrations/010_owner_stream.sql': '888b6b8747c78f5446f8a51b8a20d772588ea7500739a4ec72ba86bd5da67a59',
  'tools/owner_discussion_thread_fixture.py': '2a83d513c0c1d80d23f1116cf62b631507c122e23552e3fc0107e832149c9229',
  'tools/owner_discussion_fixture.py': 'ac0371325660e7b6412611649df153c8f51d4426d122a6b5370ec96c2abf89b6',
  'src/company/comms/history.py': '53f84683703cc89357d865716072286ab3e01574e69935d8f0930bded1793d59',
  'src/company/comms/owner_discussion_ingress.py': 'fedc09bc3c1257a8e9f4a8e7a409322c0623af5ef812c62a27cd64b0de825c90',
  'src/company/comms/owner_history_ingress.py': '1dad8036cb86cd7fa05e6a889cab1e617030f43fbb2d01165f83c2f4690ca4a3',
  'src/company/comms/owner_discussions.py': '81a9bf1cb085842e89a210afdd0cff25aaa5757f2801c2fc6da71c9f64a2546b',
  'src/company/comms/owner_notes.py': 'db8ef098bea69ac3f3772facab030d736085d8c85c680ab4d0319eb8eadb58cf',
  'src/company/comms/contracts.py': '0194771eba78d435e3ddd1962dda40cdf0f62f1a22cb0dd185eba9e220b54891',
  'src/company/service.py': 'dd7f07d16a607956f82337c29ebb1243dbde7b026f854c1f9b5a0973a5adaee9',
  'src/company/store.py': 'e2e02c8f1afe9d211e043de10ec7dce9be0779fd24b330bbda6fc6229ab10975',
  'src/company/migrations/009_owner_discussions.sql': '6361aefdb8096c5953fe46133bad7aef93a0a34aa40f3428ae53505632cf8208',
  'tests/communications/fixtures/owner-history-test.cert.pem': 'e90aac4fc38cfc57051c4c3ebdcdde8b12b1fa23bc0af13669c15b552252ce99',
  'tests/communications/fixtures/owner-history-test.key.pem': '9cfb337da6d23f82182485ce8b19acdac769b2883e949a0f6c70fc8fe0d499d4',
  'contracts/communications/reads-candidate.1/records.schema.json': '98fd331df7aa5262eefbf7bf73a3396d7ffd3b40e13f186e4d9aaa3a735958af',
  'contracts/communications/owner-discussion-candidate.1/discussion.schema.json': '4a6b6fdd8cda6d2f3e8c13a5bd5cb17b9996f83b91dd40925741e990f2bc7a8a',
  'contracts/communications/owner-discussion-stream-candidate.1/manifest.json': '173f068fc1a01ad5e01c8f4a2d035a324ccc66508ee20af5cb612dbf55b6de30',
  'contracts/communications/owner-discussion-stream-candidate.1/stream.schema.json': '677d95b1d5d9ab95d2c479a3476cf9d8e0ad1f83d5bce91fb123d27738efc4ec',
  'contracts/communications/owner-discussion-stream-candidate.1/examples.json': '84d5053ebe73d71b6e8374b798c1f972293b4d24c933f2b425fb722fc95c8707',
  'docs/evidence/owner-discussion-stream-2026-11-03/checkpoint.json': '61666bfde09ef8989c120dbcf399f9d39475c21318c17a235cf099ed1a6ff122',
};
const productPaths = [
  'packages/company-client/owner-discussion-sse.ts',
  'packages/company-client/owner-discussion-sse-parser.ts',
  'tests/company/owner-discussion-sse-service-integration.test.ts',
  'packages/company-client/owner-discussion-stream.ts',
  'packages/company-contracts/communications/owner-discussion-stream.ts',
  'packages/company-contracts/communications/json.ts', 'packages/company-contracts/communications/reads.ts',
  'packages/company-contracts/communications/owner-discussion.ts',
  'packages/company-contracts/communications/reads-candidate.1/records.schema.json',
  'packages/company-contracts/communications/owner-discussion-candidate.1/discussion.schema.json',
  'packages/company-contracts/communications/owner-discussion-stream-candidate.1/manifest.json',
  'packages/company-contracts/communications/owner-discussion-stream-candidate.1/stream.schema.json',
  'packages/company-contracts/communications/owner-discussion-stream-candidate.1/examples.json',
  'packages/company-contracts/communications/owner-discussion-stream-candidate.1/sse.json',
] as const;

async function bounded<T>(promise: Promise<T>, milliseconds = 4000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Owned SSE counterpart deadline exceeded.')), Math.max(1, milliseconds));
  })]);} finally {clearTimeout(timer);}
}

function environment(): NodeJS.ProcessEnv {
  if (process.platform !== 'win32') throw new Error('Requires reviewed Windows interpreter and git.exe.');
  const directory = (value: string | undefined) => {
    if (!value || !isAbsolute(value) || value.includes('\0')) throw new Error('Fixture directory unavailable.');
    const result = realpathSync.native(value);
    if (!statSync(result).isDirectory()) throw new Error('Fixture path is not a directory.');
    return result;
  };
  const system = directory(process.env.SystemRoot ?? process.env.WINDIR);
  const temporary = directory(process.env.TEMP ?? process.env.TMP);
  return {SystemRoot: system, WINDIR: system, TEMP: temporary, TMP: temporary};
}

function custody(root: string, env: NodeJS.ProcessEnv) {
  if (!existsSync(gitExecutable)) throw new Error('Reviewed absolute git.exe unavailable.');
  const git = (args: string[]) => execFileSync(gitExecutable, ['--no-pager', '-C', root, ...args], {
    env: {...env, GIT_NO_REPLACE_OBJECTS: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL'},
    windowsHide: true, timeout: 5000, maxBuffer: 1048576, stdio: ['ignore', 'pipe', 'pipe'],
  });
  expect(git(['rev-parse', '--verify', `${checkpoint}^{commit}`]).toString('ascii').trim()).toBe(checkpoint);
  const observedHead = git(['rev-parse', '--verify', 'HEAD']).toString('ascii').trim();
  const pinned: Record<string, {committed: string; working: string; frozen?: string}> = {};
  for (const [path, expected] of Object.entries({...sourcePins, ...dependencyPins})) {
    const committed = hash(git(['cat-file', 'blob', `${checkpoint}:${path}`]));
    const working = hash(readFileSync(join(root, path)));
    const frozen = Object.hasOwn(dependencyPins, path) ? hash(git(['cat-file', 'blob', `${frozenCheckpoint}:${path}`])) : undefined;
    pinned[path] = {committed, working, ...(frozen ? {frozen} : {})};
    expect(committed, `checkpoint ${path}`).toBe(expected);
    expect(working, `working ${path}`).toBe(expected);
    if (frozen) expect(frozen, `frozen dependency ${path}`).toBe(expected);
  }
  const product = Object.fromEntries(productPaths.map(path => {
    const bytes = readFileSync(resolve(import.meta.dirname, '../..', path));
    return [path, {bytes: bytes.length, sha256: hash(bytes)}];
  }));
  return {checkpoint, frozenCheckpoint, observedHead, pinned, product,
    scope: 'enumerated source custody only; not complete dependency/configuration/Python custody'};
}

function startFixture(root: string, env: NodeJS.ProcessEnv, save: Save) {
  const python = join(root, '.venv/Scripts/python.exe'), script = join(root, 'tools/owner_discussion_sse_fixture.py');
  if (!existsSync(python)) throw new Error('Existing reviewed interpreter unavailable.');
  const args = ['-I', '-B', script, '--case', 'regular', '--seconds', '45'];
  const child = spawn(python, args, {cwd: root, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
  child.stdin.on('error', () => {});
  const stdout: Buffer[] = [], stderr: Buffer[] = [], lines: Buffer[] = [];
  let stdoutBytes = 0, stderrBytes = 0, fragment = Buffer.alloc(0), failure: Error | undefined;
  let waiter: {resolve: (value: Buffer) => void; reject: (error: Error) => void} | undefined;
  const fail = (error: Error) => {failure ??= error; waiter?.reject(error);};
  child.once('error', () => fail(new Error('Owned fixture failed to start.')));
  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes + stderrBytes > 32768) {fail(new Error('Fixture metadata exceeds 32768 bytes.')); return;}
    stdout.push(Buffer.from(chunk)); fragment = Buffer.concat([fragment, chunk]);
    for (let end = fragment.indexOf(10); end >= 0; end = fragment.indexOf(10)) {
      const line = Buffer.from(fragment.subarray(0, end + 1)); fragment = fragment.subarray(end + 1);
      if (waiter) {const active = waiter; waiter = undefined; active.resolve(line);} else lines.push(line);
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderrBytes += chunk.length;
    if (stdoutBytes + stderrBytes <= 32768) stderr.push(Buffer.from(chunk));
    else fail(new Error('Fixture metadata exceeds 32768 bytes.'));
  });
  const closed = new Promise<{code: number | null; signal: NodeJS.Signals | null}>(accept => child.once('close', (code, signal) => {
    waiter?.reject(new Error('Fixture closed before an expected line.')); accept({code, signal});
  }));
  const readLine = async (milliseconds = 4000) => {
    if (failure) throw failure;
    const line = lines.shift(); if (line) return line;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Fixture exited before an expected line.');
    try {return await bounded(new Promise<Buffer>((accept, reject) => {waiter = {resolve: accept, reject};}), milliseconds);}
    finally {waiter = undefined;}
  };
  const controls: string[] = [];
  let statsCount = 0, stopped = false;
  const control = async (operation: Control) => {
    child.stdin.write(operation + '\n');
    const raw = await readLine();
    save(operation === 'stats' ? `stats-${++statsCount}.json` : `${operation}.json`, raw);
    const value = decodeBoundedJson(raw, 32768) as {event: string; operation: string; done: boolean; stats?: Record<string, unknown>};
    expect(value).toEqual({event: 'control', operation, done: true, ...(operation === 'stats' ? {stats: value.stats} : {})});
    if (operation !== 'stats') controls.push(operation);
    return value.stats;
  };
  const stop = async () => {
    if (!stopped && child.exitCode === null && child.signalCode === null) {stopped = true; child.stdin.end('stop\n');}
    const result = await bounded(closed, 7000);
    save('fixture.stdout.bin', Buffer.concat(stdout)); save('fixture.stderr.bin', Buffer.concat(stderr));
    let pidRemains = false;
    if (child.pid !== undefined) {
      try {process.kill(child.pid, 0); pidRemains = true;} catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
    const receipt = {pid: child.pid, args, ...result, forcedTermination: false, pidRemains,
      stdoutBytes, stderrBytes, stdoutReaderStopped: child.stdout.readableEnded,
      stderrReaderStopped: child.stderr.readableEnded, fragmentBytes: fragment.length};
    save('cleanup.json', json(receipt));
    return {receipt, raw: lines.shift(), controls, statsCount};
  };
  return {readLine, control, stop};
}

function capture(origin: string, ca: Buffer | string, path: string, token: string, signal: AbortSignal, name: string, save: Save) {
  return new Promise<{status: number; raw: Buffer}>((accept, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: {status: number; raw: Buffer}) => {
      if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); outgoing.destroy();
      if (error) reject(error); else accept(value!);
    };
    const abort = () => finish(new Error('Owned HTTP capture aborted.'));
    const timer = setTimeout(() => finish(new Error('Owned HTTP capture timed out.')), 4000);
    const target = new URL(origin);
    const outgoing = request({hostname: '127.0.0.1', port: target.port, method: 'GET', path, agent: false,
      ca, rejectUnauthorized: true, minVersion: 'TLSv1.2', maxHeaderSize: 16384,
      headers: {Host: target.host, Authorization: `Bearer ${token}`, Connection: 'close'}}, response => {
      const socket = response.socket as TLSSocket;
      const transport = {authorized: socket.authorized, tlsVersion: socket.getProtocol(), rawHeaders: response.rawHeaders,
        status: response.statusCode, method: 'GET', path, rejectUnauthorized: true, hostname: '127.0.0.1'};
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 262144) {finish(new Error('HTTP capture exceeds 262144 bytes.')); return;}
        chunks.push(Buffer.from(chunk));
      });
      response.on('error', () => finish(new Error('HTTP capture failed.')));
      response.on('aborted', () => finish(new Error('HTTP capture incomplete.')));
      response.on('end', () => {
        const raw = Buffer.concat(chunks);
        save(`${name}.body.bin`, raw); save(`${name}.http.json`, json({...transport, bytes: raw.length, sha256: hash(raw)}));
        try {
          expect(response.complete).toBe(true); expect(socket.authorized).toBe(true);
          expect(transport.tlsVersion).toMatch(/^TLSv1\.[23]$/);
          expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
          expect(Buffer.from(canonicalBytes(decodeBoundedJson(raw, 262144)))).toEqual(raw);
          finish(undefined, {status: response.statusCode ?? 0, raw});
        } catch {finish(new Error('HTTP capture validation failed.'));}
      });
    });
    outgoing.on('error', () => finish(new Error('HTTP capture transport failed.')));
    signal.addEventListener('abort', abort, {once: true});
    if (signal.aborted) {abort(); return;} outgoing.end();
  });
}

function changesState(state: OwnerDiscussionChangesState | OwnerDiscussionSnapshotState): OwnerDiscussionChangesState {
  if (state.mode !== 'changes') throw new Error('Complete baseline required.');
  return state;
}

it.skipIf(!fixtureRoot)('consumes one finite verified-TLS SSE counterpart with explicit abort and reopen', async () => {
  const root = realpathSync.native(resolve(fixtureRoot!)), env = environment();
  expect(root.toLowerCase()).toBe(realpathSync.native(reviewedRoot).toLowerCase());
  const evidenceRoot = resolve(import.meta.dirname, '../../.harness-company-evidence');
  mkdirSync(evidenceRoot, {recursive: true});
  const evidence = mkdtempSync(join(evidenceRoot, 'sse-https-regular-'));
  const saved: Record<string, {bytes: number; sha256: string}> = {};
  let totalEvidence = 0;
  const save: Save = (name, raw) => {
    const bytes = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : Buffer.from(raw);
    totalEvidence += bytes.length;
    if (bytes.length > 1048576 || totalEvidence > 4194304 || Object.keys(saved).length >= 128) throw new Error('Evidence budget exceeded.');
    writeFileSync(join(evidence, name), bytes, {flag: 'wx'}); saved[name] = {bytes: bytes.length, sha256: hash(bytes)};
  };
  // Permission and resolved query precede fixture credential acquisition.
  const expected: ReadContext = {company_id: 'leo-company', scope: {kind: 'project', id: 'alpha'}};
  const limit = 20;
  const requested = normalizeOwnerDiscussionStreamRequest('snapshot', expected, limit, null);
  save('retained-authority.json', json({expected, requested, fixtureOnly: true}));
  const total = new AbortController(), timer = setTimeout(() => total.abort(), 40000);
  const controllers: AbortController[] = [], streams: Stream[] = [];
  const frameLog: {name: string; kind: string; bytes: number; sha256: string}[] = [];
  let fixture: ReturnType<typeof startFixture> | undefined, failure: unknown;
  let before: ReturnType<typeof custody> | undefined;
  let finalState: OwnerDiscussionChangesState | undefined;
  const terminalErrors: {name: string; code: string; status?: number; requiresSnapshot: boolean}[] = [];
  try {
    before = custody(root, env); save('source-before.json', json(before));
    fixture = startFixture(root, env, save);
    const readyRaw = await fixture.readLine(12000); save('ready.json', readyRaw);
    const ready = decodeBoundedJson(readyRaw, 32768) as {base_url: string};
    const certificate = join(root, 'tests/communications/fixtures/owner-history-test.cert.pem');
    expect(ready).toEqual({event: 'ready', fixture_only: true, base_url: ready.base_url,
      bearer_token: publicToken, rotated_owner_token: rotatedToken, other_owner_token: otherToken,
      ca_certificate: certificate, company_id: 'leo-company', project_id: 'alpha', case: 'regular',
      keepalive_seconds: 15, actual_live_employees: 0});
    expect(ready.base_url).toMatch(/^https:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
    const origin = ready.base_url, ca = readFileSync(certificate);
    const options = (token = publicToken) => ({origin, role: 'owner' as const, credential: () => token, ca, timeoutMs: 3000});
    const old = new OwnerDiscussionStreamClient(options());
    const client = new OwnerDiscussionSSEClient(options());
    const baseline = await old.start(expected, limit, total.signal);
    const initial = changesState(baseline.state);
    save('client-baseline.validated.json', canonicalBytes(baseline));
    expect(initial.baseline.map(item => item.message.conversation_sequence)).toEqual([1]);
    expect(initial.position).toBe(0); expect(initial.snapshot.coverage_floor.sequence).toBe(1);
    const untrustedController = new AbortController(); controllers.push(untrustedController);
    const untrusted = new OwnerDiscussionSSEClient({...options(), ca: rootCertificates[0]})
      .open(expected, initial, {signal: untrustedController.signal});
    streams.push(untrusted);
    try {await expect(untrusted.next()).rejects.toMatchObject({code: 'TRANSPORT'});}
    finally {untrustedController.abort(); await bounded(untrusted.return(undefined), 2000);}
    save('wrong-ca.json', json({newSSEClientRejected: true, verifiedCAAndHostnameRequired: true}));
    const firstWire = await capture(origin, ca, base + 'snapshot?limit=20', publicToken, total.signal, 'baseline', save);
    expect(firstWire.status).toBe(200);
    const independent = await validateOwnerDiscussionSnapshot(firstWire.raw, expected, requested);
    expect(independent.page.items).toEqual(baseline.page.items);
    expect(independent.page.snapshot.id).not.toBe(baseline.page.snapshot.id);

    const open = (state: OwnerDiscussionChangesState, projection?: OwnerDiscussionChangesState, token = publicToken) => {
      const controller = new AbortController(); controllers.push(controller);
      const abort = () => controller.abort(); total.signal.addEventListener('abort', abort, {once: true});
      if (total.signal.aborted) controller.abort();
      const iterator = (token === publicToken ? client : new OwnerDiscussionSSEClient(options(token)))
        .open(expected, state, {signal: controller.signal, ...(projection ? {projection} : {})});
      streams.push(iterator); return {iterator, controller};
    };
    const next = async (iterator: Stream, name: string, milliseconds = 4000): Promise<SSEEvent> => {
      const result = await bounded(iterator.next(), milliseconds);
      expect(result.done).toBe(false);
      if (result.done) throw new Error('Unexpected ordinary EOF.');
      const event = result.value, raw = Buffer.from(event.rawFrame);
      expect(raw.length).toBeLessThanOrEqual(65536); expect(raw.subarray(-2).toString()).toBe('\n\n');
      save(`${name}.sse.bin`, raw); frameLog.push({name, kind: event.kind, bytes: raw.length, sha256: hash(raw)});
      if (event.kind === 'comment') expect(raw.toString('utf8')).toBe(`: ${event.comment}\n\n`);
      else {
        const {page} = event.result;
        expect(raw.toString('utf8')).toBe(`id: ${page.next_cursor}\nevent: changes\ndata: ${Buffer.from(canonicalBytes(page)).toString('utf8')}\n\n`);
      }
      return event;
    };
    const connected = async (iterator: Stream, name: string) => {
      expect(await next(iterator, name)).toMatchObject({kind: 'comment', comment: 'connected'});
    };
    const data = async (iterator: Stream, name: string) => {
      const event = await next(iterator, name);
      if (event.kind !== 'changes') throw new Error('Expected a complete changes frame.');
      return event.result;
    };
    const terminal = async (iterator: Stream, name: string, code: string, requiresSnapshot: boolean, status?: number) => {
      try {await bounded(iterator.next()); throw new Error('Expected terminal SSE error.');}
      catch (error) {
        expect(error).toBeInstanceOf(OwnerDiscussionSSEError);
        const typed = error as OwnerDiscussionSSEError;
        expect(typed.code).toBe(code); expect(typed.requiresSnapshot).toBe(requiresSnapshot);
        if (status !== undefined) expect(typed.status).toBe(status);
        terminalErrors.push({name, code: typed.code, status: typed.status, requiresSnapshot: typed.requiresSnapshot});
      }
      expect(await bounded(iterator.next())).toMatchObject({done: true});
    };
    const apply = async (result: OwnerDiscussionChangesResult, from: OwnerDiscussionChangesState,
      projection = from): Promise<OwnerDiscussionChangesState> => {
      const independentlyValidated = await validateOwnerDiscussionChanges(canonicalBytes(result.page), expected,
        normalizeOwnerDiscussionStreamRequest('changes', expected, limit, from.nextCursor), from);
      const projected = await projectOwnerDiscussionChanges(projection, independentlyValidated);
      expect(result).toEqual(projected);
      for (const item of result.page.items) {
        const sequence = item.event.sequence + 1;
        expect(item.record.receipt.command_id).toBe(`20000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`);
        expect(item.record.message.body).toBe(sequence === 2 ? 'Alpha note 2: é and 🌊' : '\x01'.repeat(4000));
      }
      return result.state;
    };
    const observeClosedOwner = async () => {
      // Finite fixture cleanup grace: its select/poll interval is 250 ms.
      // Local request close alone does not acknowledge remote principal release.
      await new Promise<void>(accept => setTimeout(accept, 500));
      expect((await fixture!.control('stats'))?.active_streams).toBe(0);
    };

    let live = open(initial);
    await connected(live.iterator, 'initial-connected');
    const started = performance.now();
    expect(await next(live.iterator, 'actual-default-keepalive', 19000)).toMatchObject({kind: 'comment', comment: 'keepalive'});
    const keepaliveMs = performance.now() - started;
    expect(keepaliveMs).toBeGreaterThanOrEqual(13000); expect(keepaliveMs).toBeLessThanOrEqual(18500);
    await fixture.control('append');
    const appended = await data(live.iterator, 'appended');
    let current = await apply(appended, initial);
    expect(current.position).toBe(1); expect(appended.applied).toHaveLength(1);
    const oldCatchup = await old.changes(expected, initial, total.signal);
    expect(oldCatchup.page.items).toEqual(appended.page.items);
    const catchupWire = await capture(origin, ca, base + 'changes?limit=20&cursor=' + initial.nextCursor,
      publicToken, total.signal, 'same-listener-catchup', save);
    expect(catchupWire.status).toBe(200);
    expect(await validateOwnerDiscussionChanges(catchupWire.raw, expected,
      normalizeOwnerDiscussionStreamRequest('changes', expected, limit, initial.nextCursor), initial)).toEqual(oldCatchup);
    const retainedAfterAppend = Buffer.from(canonicalBytes(current));
    live.controller.abort(); expect(await bounded(live.iterator.next())).toMatchObject({done: true});
    expect(Buffer.from(canonicalBytes(current))).toEqual(retainedAfterAppend);
    await observeClosedOwner();

    live = open(initial, current);
    await connected(live.iterator, 'overlap-connected');
    const overlap = await data(live.iterator, 'overlap-identical-event');
    current = await apply(overlap, initial, current);
    expect(overlap.applied).toHaveLength(0); expect(current.position).toBe(1);
    let chain = (await validateOwnerDiscussionChanges(canonicalBytes(overlap.page), expected,
      normalizeOwnerDiscussionStreamRequest('changes', expected, limit, initial.nextCursor), initial)).state;
    await fixture.control('burst');
    const unique = new Set(current.seenEvents.map(item => item.event.id));
    let pages = 0, byteLimited = false;
    while (current.position < 13 && pages < 12) {
      const result = await data(live.iterator, `burst-${++pages}`);
      const validated = await validateOwnerDiscussionChanges(canonicalBytes(result.page), expected,
        normalizeOwnerDiscussionStreamRequest('changes', expected, limit, chain.nextCursor), chain);
      const beforePosition = current.position;
      current = await apply(result, chain, current); chain = validated.state;
      expect(current.position).toBeGreaterThan(beforePosition);
      for (const item of result.applied) {expect(unique.has(item.event.id)).toBe(false); unique.add(item.event.id);}
      byteLimited ||= result.page.coverage.truncation === 'byte_limit';
    }
    expect(current.position).toBe(13); expect(unique.size).toBe(13); expect(pages).toBeGreaterThan(1); expect(byteLimited).toBe(true);
    expect(current.seenEvents.map(item => item.event.sequence)).toEqual(Array.from({length: 13}, (_, i) => i + 1));
    const beforeTerminal = Buffer.from(canonicalBytes(current));
    await fixture.control('replay'); await fixture.control('expire');
    await terminal(live.iterator, 'expired-live', 'RESYNC_REQUIRED', true);
    expect(Buffer.from(canonicalBytes(current))).toEqual(beforeTerminal);
    await observeClosedOwner();
    const stale = open(current);
    await terminal(stale.iterator, 'expired-reopen', 'RESYNC_REQUIRED', true, 410);
    const expiredWire = await capture(origin, ca, base + 'events?limit=20&cursor=' + current.nextCursor,
      publicToken, total.signal, 'expired-http', save);
    expect(expiredWire.status).toBe(410);
    expect(decodeBoundedJson(expiredWire.raw, 262144)).toEqual({schema_version: 1, error: {code: 'RESYNC_REQUIRED'}});

    let fresh = await old.start(expected, limit, total.signal);
    for (let pages = 0; fresh.state.mode === 'snapshot' && pages < 8; pages++) fresh = await old.continueSnapshot(expected, fresh.state, total.signal);
    const resnapshot = changesState(fresh.state);
    expect(resnapshot.baseline.map(item => item.message.conversation_sequence)).toEqual(Array.from({length: 14}, (_, i) => 14 - i));
    live = open(resnapshot); await connected(live.iterator, 'registry-connected');
    await fixture.control('revoke-registry');
    await terminal(live.iterator, 'registry-revoked', 'AUTHENTICATION_REQUIRED', false);
    await observeClosedOwner();
    live = open(resnapshot, undefined, rotatedToken); await connected(live.iterator, 'store-connected');
    await fixture.control('revoke-store');
    await terminal(live.iterator, 'store-revoked', 'AUTHENTICATION_REQUIRED', false);
    finalState = current;
    save('last-applied-state.json', canonicalBytes(current));
    save('stream-summary.json', json({keepaliveMs, pages, byteLimited, uniqueEvents: unique.size,
      finalPosition: current.position, finalCursor: current.nextCursor, terminalErrors, frames: frameLog,
      explicitAbortRetainedState: true, callerOwnedConnections: true, automaticReconnects: 0, pollingReads: 0,
      fixtureCleanupGraceMsBeforeSingleObservation: 500}));
  } catch (error) {
    failure = error;
    save('failure.json', json({name: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : 'unknown', frames: frameLog, terminalErrors}));
  } finally {
    clearTimeout(timer); total.abort(); controllers.forEach(controller => controller.abort());
    await Promise.allSettled(streams.map(iterator => bounded(iterator.return(undefined), 2000)));
    try {
      if (fixture) {
        const {receipt, raw, controls, statsCount} = await fixture.stop();
        if (raw) save('stopped.json', raw);
        expect(receipt).toMatchObject({code: 0, signal: null, forcedTermination: false, pidRemains: false,
          stderrBytes: 0, stdoutReaderStopped: true, stderrReaderStopped: true, fragmentBytes: 0});
        expect(raw).toBeDefined();
        const stopped = decodeBoundedJson(raw!, 32768) as {stats: Record<string, unknown>};
        expect(stopped).toMatchObject({event: 'stopped', fixture_only: true, alpha_messages: 14, alpha_public_events: 13,
          expected_counts: true, events_unique_contiguous: true, read_only_observations: true, beta_rows_unchanged: true,
          historical_rows_unchanged: true, normal_stop: true, temporary_store_removed: true, server_thread_stopped: true,
          control_thread_stopped: true, expected_controls: true, controls: expectedControls, stats_requests: statsCount,
          exact_command_replays: 1, actual_live_employees: 0,
          model_or_work_execution_paths: 'not present in this fixture or read-only SSE route'});
        expect([...controls, 'stop']).toEqual(expectedControls);
        expect(stopped.stats).toMatchObject({active_handlers: 0, active_streams: 0});
        expect(stopped.stats.peak_outstanding_bytes).toBeLessThanOrEqual(262144);
      }
      const after = custody(root, env); save('source-after.json', json(after));
      expect(after.pinned).toEqual(before?.pinned); expect(after.product).toEqual(before?.product);
    } catch (error) {
      failure ??= error;
      save('verification-failure.json', json({name: error instanceof Error ? error.name : 'unknown',
        message: error instanceof Error ? error.message : 'unknown'}));
    }
    save('manifest.json', json({fixtureOnly: true, checkpoint, frozenCheckpoint, saved,
      passed: failure === undefined, finalPosition: finalState?.position,
      proofScope: 'same-host synthetic Store and actual verified TLS SSE; enumerated sources only',
      notAccepted: ['installer', 'native authentication', 'model invocation', 'cloud', 'pilot', 'full C07', 'company acceptance']}));
  }
  if (failure) throw failure;
}, 60000);
