import {execFileSync, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync} from 'node:fs';
import {request} from 'node:https';
import {isAbsolute, join, resolve} from 'node:path';
import {rootCertificates} from 'node:tls';
import {expect, it} from 'vitest';
import {OwnerHistoryClient} from '../../packages/company-client/owner-history.ts';
import {canonicalBytes, decodeJson} from '../../packages/company-contracts/communications/index.ts';
import {validateOwnerNoteHistory} from '../../packages/company-contracts/communications/history.ts';

const fixtureRoot = process.env.GEN_COMPANY_OWNER_HISTORY_FIXTURE_ROOT;
const checkpoint = '7a96002234aae799c23bef841353c8af0f557876';
const publicToken = 'PUBLIC-disposable-owner-history-HTTPS-fixture-only';
const gitExecutable = 'C:\\Program Files\\Git\\cmd\\git.exe';
// Enumerated source custody only: these pins do not cover every imported Python,
// configuration or locked-environment dependency. No ignored receipt is an input.
const sourcePins = {
  'contracts/communications/owner-history-read-candidate.1/manifest.json': '7022869daf40871777f8bd5368b2c75481f3cd4a1ce81bb737f2c92e0e6e60f3',
  'docs/evidence/owner-history-ingress-2026-11-02.json': '72b1c2bd0b773cd60815ec4061c0f701047ae2725032c4dd98c5f99d5e838a87',
  'docs/integrations/owner-history-read-fixture.md': 'b88eb13ec9e70566c0f72dea9de170fb395e4c869428a97a257def200b73551d',
  'src/company/comms/owner_history_ingress.py': '1dad8036cb86cd7fa05e6a889cab1e617030f43fbb2d01165f83c2f4690ca4a3',
  'tests/communications/test_owner_history_ingress.py': '7b9cce9a12f0fa49d943ef3c4ab1e1b4c80ceefb119c9946c2f482565cba75a0',
  'tools/owner_history_ingress_fixture.py': '5a11b051a73f610948f3204a1e552b6237951a2ee2d5d5b89b4b6f11e17e89d8',
  'tests/communications/fixtures/README.md': 'eaf160430f5c2744f40a253dedd232548adf3eababad88192b2dd9bc2d6932d7',
  'tests/communications/fixtures/owner-history-test.cert.pem': 'e90aac4fc38cfc57051c4c3ebdcdde8b12b1fa23bc0af13669c15b552252ce99',
  'tests/communications/fixtures/owner-history-test.key.pem': '9cfb337da6d23f82182485ce8b19acdac769b2883e949a0f6c70fc8fe0d499d4',
  'docs/communications/owner-history-ingress.md': '973d95352fa890bb84337193c3f30082333e348974bb0e17d566a62094c249e1',
};
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

async function deadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Owned owner-history fixture deadline exceeded')), milliseconds);
    })]);
  } finally {clearTimeout(timer);}
}

function environment(): NodeJS.ProcessEnv {
  if (process.platform !== 'win32') throw new Error('This opt-in fixture requires the reviewed Windows interpreter and git.exe.');
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

function verifyPins(root: string, env: NodeJS.ProcessEnv) {
  if (!existsSync(gitExecutable)) throw new Error('Reviewed absolute git.exe is unavailable.');
  const git = (args: string[]) => execFileSync(gitExecutable, ['--no-pager', '-C', root, ...args], {
    env: {...env, GIT_NO_REPLACE_OBJECTS: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL'},
    windowsHide: true, timeout: 5000, maxBuffer: 1048576, stdio: ['ignore', 'pipe', 'pipe'],
  });
  expect(git(['rev-parse', '--verify', `${checkpoint}^{commit}`]).toString('ascii').trim()).toBe(checkpoint);
  const observedHead = git(['rev-parse', '--verify', 'HEAD']).toString('ascii').trim();
  expect(observedHead).toMatch(/^[a-f0-9]{40}$/);
  const committed: Record<string, string> = {}, working: Record<string, string> = {};
  for (const [path, expected] of Object.entries(sourcePins)) {
    committed[path] = hash(git(['cat-file', 'blob', `${checkpoint}:${path}`]));
    working[path] = hash(readFileSync(join(root, path)));
    expect(committed[path], `committed source ${path}`).toBe(expected);
    expect(working[path], `working source ${path}`).toBe(expected);
  }
  return {checkpoint, observedHead, committed, working, scope: 'enumerated source files only'};
}

function startFixture(root: string, env: NodeJS.ProcessEnv, save: (name: string, raw: Uint8Array | string) => void) {
  const python = join(root, '.venv/Scripts/python.exe');
  const script = join(root, 'tools/owner_history_ingress_fixture.py');
  if (!existsSync(python) || !existsSync(script)) throw new Error('Opt-in fixture requires its existing locked interpreter and pinned script.');
  const args = ['-I', '-B', '-u', script, '--seconds', '15'];
  const startedAt = new Date().toISOString();
  const child = spawn(python, args, {cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
  child.stdin.on('error', () => {});
  const stdout: Buffer[] = [], stderr: Buffer[] = [], lines: Buffer[] = [];
  let totalBytes = 0, stdoutBytes = 0, stderrBytes = 0, exceeded = false, forced = false;
  let fragment = Buffer.alloc(0), failure: Error | undefined;
  let waiting: {resolve: (line: Buffer) => void; reject: (error: Error) => void} | undefined;
  const fail = (error: Error) => {failure ??= error; waiting?.reject(error);};
  child.once('error', () => fail(new Error('Owned owner-history fixture failed to start.')));
  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBytes += chunk.length;
    const remaining = Math.max(0, 16384 - totalBytes);
    if (remaining > 0) stdout.push(Buffer.from(chunk.subarray(0, remaining)));
    totalBytes += chunk.length;
    if (totalBytes > 16384) {exceeded = true; fail(new Error('Fixture output exceeded 16384 bytes.')); return;}
    fragment = Buffer.concat([fragment, chunk]);
    while (true) {
      const end = fragment.indexOf(10);
      if (end < 0) break;
      const line = Buffer.from(fragment.subarray(0, end + 1)); fragment = fragment.subarray(end + 1);
      if (line.byteLength > 4096) {fail(new Error('Fixture metadata line exceeded 4096 bytes.')); return;}
      if (waiting) {const current = waiting; waiting = undefined; current.resolve(line);} else lines.push(line);
    }
    if (fragment.byteLength > 4096) fail(new Error('Fixture metadata line exceeded 4096 bytes.'));
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderrBytes += chunk.length;
    const remaining = Math.max(0, 16384 - totalBytes);
    if (remaining > 0) stderr.push(Buffer.from(chunk.subarray(0, remaining)));
    totalBytes += chunk.length;
    if (totalBytes > 16384) {exceeded = true; fail(new Error('Fixture output exceeded 16384 bytes.'));}
  });
  const closed = new Promise<{code: number | null; signal: NodeJS.Signals | null}>(accept => {
    child.once('close', (code, signal) => {waiting?.reject(new Error('Fixture closed before its metadata line.')); accept({code, signal});});
  });
  async function readLine(milliseconds: number) {
    if (failure) throw failure;
    const queued = lines.shift(); if (queued) return queued;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Fixture metadata is unavailable after close.');
    try {return await deadline(new Promise<Buffer>((accept, reject) => {waiting = {resolve: accept, reject};}), milliseconds);}
    finally {waiting = undefined;}
  }
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => {
    let result: Awaited<typeof closed> | undefined;
    try {
      if (child.exitCode === null && child.signalCode === null) child.stdin.end('stop\n');
      try {result = await deadline(closed, 5000);} catch {
        forced = true; child.kill('SIGKILL'); await deadline(closed, 2000);
        throw new Error('Owned owner-history fixture required forced termination after its close deadline.');
      }
      expect(result).toEqual({code: 0, signal: null});
      if (failure || exceeded) throw failure ?? new Error('Fixture output bound exceeded.');
      const stoppedRaw = await readLine(100);
      save('stopped.json', stoppedRaw);
      expect(decodeJson(stoppedRaw)).toEqual({event: 'stopped', fixture_only: true, store_rows_unchanged: true, temporary_store_removed: true});
      expect(lines).toHaveLength(0); expect(fragment.byteLength).toBe(0);
    } finally {
      save('fixture.stdout.raw', Buffer.concat(stdout)); save('fixture.stderr.raw', Buffer.concat(stderr));
      save('process.json', JSON.stringify({
        checkpoint, python, script, args, pid: child.pid ?? null, startedAt, closedAt: new Date().toISOString(),
        environmentKeys: Object.keys(env), code: result?.code ?? child.exitCode, signal: result?.signal ?? child.signalCode,
        stdoutBytes, stderrBytes, rawOutputCap: 16384, outputExceeded: exceeded, forcedTermination: forced,
      }, null, 2) + '\n');
    }
  })();
  return {readLine, stop};
}

interface Ready {
  event: string; fixture_only: boolean; base_url: string; bearer_token: string; ca_certificate: string;
  company_id: string; project_id: string; conversation_id: string; forbidden_conversation_id: string; actual_live_employees: number;
}

// A small test-local GET capture. It retains bounded raw bytes before any decoder,
// uses isolated CA trust and a total deadline, and never follows a Location header.
async function capture(origin: string, ca: Buffer, path: string, token: string, name: string,
  save: (name: string, raw: Uint8Array | string) => void, originHeader = false) {
  return await new Promise<{status: number; raw: Buffer}>((accept, reject) => {
    const url = new URL(origin), chunks: Buffer[] = [];
    let bytes = 0, finished = false;
    const finish = (error?: Error, value?: {status: number; raw: Buffer}) => {
      if (finished) return; finished = true; clearTimeout(timer);
      if (error) reject(error); else accept(value!);
    };
    const headers: Record<string, string> = {Host: url.host, Authorization: `Bearer ${token}`};
    if (originHeader) headers.Origin = '';
    const pending = request({
      protocol: 'https:', hostname: '127.0.0.1', port: url.port, path, method: 'GET',
      ca, rejectUnauthorized: true, minVersion: 'TLSv1.2', agent: false, headers,
    }, response => {
      response.on('data', (chunk: Buffer) => {
        if (finished) return;
        const remaining = Math.max(0, 262144 - bytes); chunks.push(Buffer.from(chunk.subarray(0, remaining))); bytes += chunk.length;
        if (bytes > 262144) {
          save(`${name}.response.bin`, Buffer.concat(chunks)); pending.destroy();
          finish(new Error('Fixture response exceeded 262144 raw bytes.'));
        }
      });
      response.once('error', () => finish(new Error('Fixture response stream failed.')));
      response.once('end', () => {
        if (finished) return;
        const raw = Buffer.concat(chunks), status = response.statusCode ?? 0;
        save(`${name}.response.bin`, raw);
        save(`${name}.response.json`, JSON.stringify({status, rawBytes: raw.byteLength, sha256: hash(raw), headers: response.rawHeaders}, null, 2) + '\n');
        if (response.headers['content-type'] !== 'application/json; charset=utf-8' || response.headers['content-encoding'] !== undefined) {
          finish(new Error('Fixture JSON response headers do not match the fixed ingress.')); return;
        }
        finish(undefined, {status, raw});
      });
    });
    const timer = setTimeout(() => {pending.destroy(); finish(new Error('Fixture HTTPS response deadline exceeded.'));}, 3000);
    pending.once('error', () => finish(new Error('Fixture HTTPS transport failed.')));
    pending.end();
  });
}

it.skipIf(!fixtureRoot)('conforms to the disposable verified owner-history HTTPS ingress and its cleanup receipt', async () => {
  const root = realpathSync.native(resolve(fixtureRoot!)), env = environment();
  const evidenceRoot = resolve(import.meta.dirname, '../../.harness-company-evidence');
  mkdirSync(evidenceRoot, {recursive: true});
  const evidence = mkdtempSync(join(evidenceRoot, 'owner-history-https-'));
  const save = (name: string, raw: Uint8Array | string) => writeFileSync(join(evidence, name), raw, {flag: 'wx'});
  save('source-before.json', JSON.stringify(verifyPins(root, env), null, 2) + '\n');
  const fixture = startFixture(root, env, save);
  // Expected query data is fixed independently before any service request.
  const expected = {company_id: 'leo-company', scope: {kind: 'project' as const, id: 'alpha'}};
  try {
    const startedRaw = await fixture.readLine(8000); save('started.json', startedRaw);
    const ready = decodeJson(startedRaw) as unknown as Ready;
    const expectedCertificate = join(root, 'tests/communications/fixtures/owner-history-test.cert.pem');
    expect(ready).toEqual({
      event: 'ready', fixture_only: true, base_url: expect.stringMatching(/^https:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/),
      bearer_token: publicToken, ca_certificate: expectedCertificate, company_id: expected.company_id, project_id: expected.scope.id,
      conversation_id: expect.stringMatching(uuid), forbidden_conversation_id: expect.stringMatching(uuid), actual_live_employees: 0,
    });
    expect(Number(new URL(ready.base_url).port)).toBeLessThanOrEqual(65535);
    const alphaRoom = ready.conversation_id, betaRoom = ready.forbidden_conversation_id;
    expect(alphaRoom).not.toBe(betaRoom);
    const ca = readFileSync(expectedCertificate);
    expect(hash(ca)).toBe(sourcePins['tests/communications/fixtures/owner-history-test.cert.pem']);
    const reader = new OwnerHistoryClient({origin: ready.base_url, role: 'owner', credential: () => publicToken, ca, timeoutMs: 2500});
    const route = (room: string, query = 'project_id=alpha') => `/company/v1/conversations/${room}/messages?${query}`;
    const normal = await reader.readHistory(expected, alphaRoom);
    expect(normal).toMatchObject({company_id: expected.company_id, scope: expected.scope, requested_limit: 20, room_head: {id: alphaRoom, revision: 2}});
    expect(normal.items).toHaveLength(2);
    expect(normal.items.map(pair => pair.message.conversation_sequence)).toEqual([2, 1]);
    const rawNormal = await capture(ready.base_url, ca, route(alphaRoom), publicToken, 'default20', save);
    expect(rawNormal.status).toBe(200);
    const decodedNormal = await validateOwnerNoteHistory(rawNormal.raw, expected, 20);
    expect(decodedNormal.room_head?.id).toBe(alphaRoom);
    expect(Buffer.from(canonicalBytes(normal))).toEqual(rawNormal.raw);
    expect(Buffer.from(canonicalBytes(decodedNormal))).toEqual(rawNormal.raw);
    const one = await reader.readHistory(expected, alphaRoom, 1);
    expect(one.requested_limit).toBe(1); expect(one.items).toHaveLength(1); expect(one.room_head?.id).toBe(alphaRoom);
    const rawOne = await capture(ready.base_url, ca, route(alphaRoom, 'project_id=alpha&limit=1'), publicToken, 'limit1', save);
    expect(rawOne.status).toBe(200);
    const decodedOne = await validateOwnerNoteHistory(rawOne.raw, expected, 1);
    expect(decodedOne.room_head?.id).toBe(alphaRoom);
    expect(Buffer.from(canonicalBytes(one))).toEqual(rawOne.raw);
    expect(Buffer.from(canonicalBytes(decodedOne))).toEqual(rawOne.raw);
    await expect(reader.readHistory({company_id: expected.company_id, scope: {kind: 'project', id: 'beta'}}, betaRoom)).rejects.toMatchObject({code: 'SCOPE_DENIED'});
    await expect(reader.readHistory(expected, betaRoom)).rejects.toMatchObject({code: 'NOT_FOUND'});
    const wrongToken = new OwnerHistoryClient({origin: ready.base_url, role: 'owner', credential: () => 'wrong-public-owner-history-fixture-token', ca, timeoutMs: 2500});
    await expect(wrongToken.readHistory(expected, alphaRoom)).rejects.toMatchObject({code: 'AUTHENTICATION_REQUIRED'});
    const wrongCA = new OwnerHistoryClient({origin: ready.base_url, role: 'owner', credential: () => publicToken, ca: rootCertificates[0], timeoutMs: 2500});
    await expect(wrongCA.readHistory(expected, alphaRoom)).rejects.toMatchObject({code: 'TRANSPORT'});
    for (const [name, path, token, status, code, browserOrigin] of [
      ['beta-scope', route(betaRoom, 'project_id=beta'), publicToken, 403, 'SCOPE_DENIED', false],
      ['beta-room', route(betaRoom), publicToken, 404, 'NOT_FOUND', false],
      ['wrong-token', route(alphaRoom), 'wrong-public-owner-history-fixture-token', 401, 'AUTHENTICATION_REQUIRED', false],
      ['noncanonical-limit', route(alphaRoom, 'project_id=alpha&limit=020'), publicToken, 400, 'INVALID_REQUEST', false],
      ['browser-origin', route(alphaRoom), publicToken, 400, 'INVALID_REQUEST', true],
      ['old-status', '/v1/status', publicToken, 404, 'NOT_FOUND', false],
    ] as const) {
      const actual = await capture(ready.base_url, ca, path, token, name, save, browserOrigin);
      expect(actual.status).toBe(status);
      expect(actual.raw).toEqual(Buffer.from(canonicalBytes({schema_version: 1, error: {code}})));
    }
    save('consumer.json', JSON.stringify({checkpoint, proof: 'actual_disposable_https', company: expected.company_id, project: expected.scope.id,
      alphaRoom, betaRoom, defaultLimit: 20, explicitLimit: 1, rawSuccesses: 2, rawClosedDenials: 6, wrongCARejected: true,
      scope: 'enumerated source pins and disposable fixture only', liveVerified: false, companyAccepted: false}, null, 2) + '\n');
  } finally {
    try {await fixture.stop();}
    finally {save('source-after.json', JSON.stringify(verifyPins(root, env), null, 2) + '\n');}
  }
  console.info(`Owner-history HTTPS consumer evidence: ${evidence}`);
}, 30000);
