import {execFileSync, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync} from 'node:fs';
import {request} from 'node:https';
import {isAbsolute, join, resolve} from 'node:path';
import {rootCertificates, type TLSSocket} from 'node:tls';
import {expect, it} from 'vitest';
import {OwnerDiscussionClient} from '../../packages/company-client/owner-discussion.ts';
import {canonicalBytes, decodeBoundedJson} from '../../packages/company-contracts/communications/json.ts';
import {parseOwnerDiscussionCommand, validateOwnerDiscussionReceipt, validateOwnerDiscussionReadBack} from '../../packages/company-contracts/communications/owner-discussion.ts';
import {validateReadOutput, type ReadContext} from '../../packages/company-contracts/communications/reads.ts';

const fixtureRoot = process.env.GEN_COMPANY_OWNER_DISCUSSION_FIXTURE_ROOT;
const checkpoint = '111214f5f535f982799fe9f1c178887a7b1dd385';
const publicToken = 'PUBLIC-disposable-owner-discussion-HTTPS-fixture-only';
const otherToken = 'PUBLIC-disposable-other-owner-discussion-fixture-only';
const gitExecutable = 'C:\\Program Files\\Git\\cmd\\git.exe';
// Literal custody: the checkpoint's 15 enumerated sources, checkpoint itself,
// public fixture PEMs and the frozen imports used here. Not all Python dependencies.
// No ignored receipt, operator DB, registry, credential or certificate is an input.
const sourcePins = {
  'src/company/comms/owner_discussions.py': '81a9bf1cb085842e89a210afdd0cff25aaa5757f2801c2fc6da71c9f64a2546b',
  'src/company/migrations/009_owner_discussions.sql': '6361aefdb8096c5953fe46133bad7aef93a0a34aa40f3428ae53505632cf8208',
  'src/company/comms/owner_notes.py': 'db8ef098bea69ac3f3772facab030d736085d8c85c680ab4d0319eb8eadb58cf',
  'src/company/service.py': 'dd7f07d16a607956f82337c29ebb1243dbde7b026f854c1f9b5a0973a5adaee9',
  'src/company/comms/owner_discussion_ingress.py': 'fedc09bc3c1257a8e9f4a8e7a409322c0623af5ef812c62a27cd64b0de825c90',
  'tools/owner_discussion_fixture.py': 'ac0371325660e7b6412611649df153c8f51d4426d122a6b5370ec96c2abf89b6',
  'tests/communications/test_owner_discussions.py': '3d19af8e9bcf2b944467085778e59272c0f953dd0f458fc7bc07d1b490d81205',
  'tests/communications/test_owner_discussion_ingress.py': '18cd0dc9334c5880f27d6eeca8a105166821b6c3eb509ebcfd713a83165fc821',
  'tests/communications/test_owner_discussion_fixture.py': 'eeb213f4e63507adcd3db5422e8ec4d7656e0ce3e0f7f07642b7a87c1d9e8ef4',
  'tests/communications/test_owner_discussion_contract.py': '7efb6c1bf52bf34419322f8bfb8fd1f588eedb3e7765c820ec72f9f958746b2c',
  'contracts/communications/owner-discussion-candidate.1/manifest.json': '0552e449d911f63ba4655a0745a2a93db2b98708f721a1ec37c67ced27ad009a',
  'contracts/communications/owner-discussion-candidate.1/discussion.schema.json': '4a6b6fdd8cda6d2f3e8c13a5bd5cb17b9996f83b91dd40925741e990f2bc7a8a',
  'contracts/communications/owner-discussion-candidate.1/examples.json': 'f2bac10ee73fa274f18913e89fcb7262143117f9a4584ade067a16956284d7ea',
  'docs/integrations/owner-discussion-append.md': '6eaf23c6c3dbb0d641a9d4adfb5f89a8296f747151024016a8623d558ee487a4',
  'docs/integrations/owner-discussion-fixture.md': '1eb1a4ef43c7dda456574ec7f8773a21ee0ad1377fdfa3035cffc59a204878e0',
  'docs/evidence/owner-discussion-2026-11-03/checkpoint.json': '9e69c6a80fa1c15a84b95d2aa3269d8836a31f3120f85aebe5ba224ae4a21171',
  'tests/communications/fixtures/README.md': 'eaf160430f5c2744f40a253dedd232548adf3eababad88192b2dd9bc2d6932d7',
  'tests/communications/fixtures/owner-history-test.cert.pem': 'e90aac4fc38cfc57051c4c3ebdcdde8b12b1fa23bc0af13669c15b552252ce99',
  'tests/communications/fixtures/owner-history-test.key.pem': '9cfb337da6d23f82182485ce8b19acdac769b2883e949a0f6c70fc8fe0d499d4',
  'contracts/communications/reads-candidate.1/records.schema.json': '98fd331df7aa5262eefbf7bf73a3396d7ffd3b40e13f186e4d9aaa3a735958af',
  'contracts/communications/v1/manifest.json': '4762203741d169461130796dab86e39adb5effa1e6c52bf77e837ba41a5e1492',
  'contracts/communications/owner-history-read-candidate.1/manifest.json': '7022869daf40871777f8bd5368b2c75481f3cd4a1ce81bb737f2c92e0e6e60f3',
  'src/company/comms/contracts.py': '0194771eba78d435e3ddd1962dda40cdf0f62f1a22cb0dd185eba9e220b54891',
};
const consumerFrozenPins = {
  'packages/company-contracts/communications/json.ts': 'b7747da19b17c2ac5412e5caed242904268b552ac63a7d810e573e6eaae2021d',
  'packages/company-contracts/communications/reads.ts': '1418c47247c83c7a346d48ad863f2fb791cad36da81660ea2e95e73ddfd7de24',
  'packages/company-contracts/communications/reads-candidate.1/records.schema.json': '98fd331df7aa5262eefbf7bf73a3396d7ffd3b40e13f186e4d9aaa3a735958af',
};
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type Save = (name: string, raw: Uint8Array | string) => void;

async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_accept, reject) => {
      timer = setTimeout(() => reject(new Error('Owned discussion fixture deadline exceeded.')), milliseconds);
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
  expect(observedHead).toMatch(/^[a-f0-9]{40}$/); // Diagnostic only: HEAD may advance independently.
  const committed: Record<string, string> = {}, working: Record<string, string> = {}, consumerFrozen: Record<string, string> = {};
  for (const path of Object.keys(sourcePins)) {
    committed[path] = hash(git(['cat-file', 'blob', `${checkpoint}:${path}`]));
    working[path] = hash(readFileSync(join(root, path)));
  }
  for (const path of Object.keys(consumerFrozenPins)) consumerFrozen[path] = hash(readFileSync(resolve(import.meta.dirname, '../..', path)));
  // Retain the complete observed hashes even if a later equality assertion fails.
  save(name, JSON.stringify({checkpoint, observedHead, committed, working, consumerFrozen,
    scope: 'enumerated source files only; not complete dependency custody'}, null, 2) + '\n');
  for (const [path, expected] of Object.entries(sourcePins)) {
    expect(committed[path], `committed source ${path}`).toBe(expected);
    expect(working[path], `working source ${path}`).toBe(expected);
  }
  for (const [path, expected] of Object.entries(consumerFrozenPins)) expect(consumerFrozen[path], `consumer frozen source ${path}`).toBe(expected);
}

function startFixture(root: string, env: NodeJS.ProcessEnv, save: Save) {
  const python = join(root, '.venv/Scripts/python.exe'), script = join(root, 'tools/owner_discussion_fixture.py');
  if (!existsSync(python) || !existsSync(script)) throw new Error('Requires existing locked interpreter and pinned fixture.');
  const args = ['-I', '-B', '-u', script, '--seconds', '30'];
  const startedAt = new Date().toISOString();
  const child = spawn(python, args, {cwd: root, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
  child.stdin.on('error', () => {});
  const stdout: Buffer[] = [], stderr: Buffer[] = [], lines: Buffer[] = [];
  let totalBytes = 0, stdoutBytes = 0, stderrBytes = 0, exceeded = false, forced = false;
  let fragment = Buffer.alloc(0), failure: Error | undefined;
  let waiting: {resolve: (line: Buffer) => void; reject: (error: Error) => void} | undefined;
  const fail = (error: Error) => {failure ??= error; waiting?.reject(error);};
  child.once('error', () => fail(new Error('Owned discussion fixture failed to start.')));
  const collect = (chunk: Buffer, output: Buffer[]) => {
    const remaining = Math.max(0, 32768 - totalBytes);
    if (remaining) output.push(Buffer.from(chunk.subarray(0, remaining)));
    totalBytes += chunk.length;
    if (totalBytes > 32768) {exceeded = true; fail(new Error('Fixture output exceeded 32768 bytes.')); return false;}
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
      if (line.byteLength > 8192) {fail(new Error('Fixture event exceeded 8192 bytes.')); return;}
      if (waiting) {const current = waiting; waiting = undefined; current.resolve(line);} else lines.push(line);
    }
    if (fragment.byteLength > 8192) fail(new Error('Fixture event exceeded 8192 bytes.'));
  });
  child.stderr.on('data', (chunk: Buffer) => {stderrBytes += chunk.length; collect(chunk, stderr);});
  const closed = new Promise<{code: number | null; signal: NodeJS.Signals | null}>(accept => {
    child.once('close', (code, signal) => {waiting?.reject(new Error('Fixture closed before its event.')); accept({code, signal});});
  });
  async function readLine(milliseconds = 3000) {
    if (failure) throw failure;
    const queued = lines.shift(); if (queued) return queued;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Fixture event unavailable after close.');
    try {return await bounded(new Promise<Buffer>((accept, reject) => {waiting = {resolve: accept, reject};}), milliseconds);}
    finally {waiting = undefined;}
  }
  async function control(operation: 'revoke-principal' | 'revoke') {
    child.stdin.write(`${operation}\n`);
    const raw = await readLine(); save(`${operation}.json`, raw);
    expect(decodeBoundedJson(raw, 32768)).toEqual({event: 'control', operation, done: true});
  }
  const stop = async () => {
    let result: Awaited<typeof closed> | undefined, pidRemains: boolean | null = null;
    try {
      if (child.exitCode === null && child.signalCode === null) child.stdin.end('stop\n');
      try {result = await bounded(closed, 5000);} catch {
        forced = true; child.kill('SIGKILL'); await bounded(closed, 2000);
        throw new Error('Owned discussion fixture required forced termination.');
      }
      if (child.pid !== undefined) {
        try {process.kill(child.pid, 0); pidRemains = true;} catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
          pidRemains = false;
        }
        expect(pidRemains).toBe(false);
      }
      const raw = await readLine(100); save('stopped.json', raw);
      expect(decodeBoundedJson(raw, 32768)).toEqual({
        event: 'stopped', fixture_only: true, alpha_messages: 2, alpha_receipts: 2, alpha_acceptances: 2,
        expected_alpha_commands: true, beta_rows_unchanged: true, temporary_store_removed: true,
        control_thread_stopped: true, controls: ['revoke-principal', 'revoke'],
      });
      expect(result).toEqual({code: 0, signal: null});
      if (failure || exceeded) throw failure ?? new Error('Fixture output bound exceeded.');
      expect(lines).toHaveLength(0); expect(fragment.byteLength).toBe(0);
    } finally {
      save('fixture.stdout.raw', Buffer.concat(stdout)); save('fixture.stderr.raw', Buffer.concat(stderr));
      save('process.json', JSON.stringify({checkpoint, python, script, args, pid: child.pid ?? null,
        startedAt, closedAt: new Date().toISOString(), environmentKeys: Object.keys(env),
        code: result?.code ?? child.exitCode, signal: result?.signal ?? child.signalCode,
        stdoutBytes, stderrBytes, rawOutputCap: 32768, outputExceeded: exceeded, forcedTermination: forced, pidRemains,
      }, null, 2) + '\n');
    }
  };
  return {readLine, control, stop};
}

interface Ready {
  base_url: string; ca_certificate: string; forbidden_conversation_id: string; forbidden_message_id: string;
}

// Independent raw TLS capture retains actual bytes before decoding, uses isolated
// public test trust, and shares the consumer's total monotonic deadline.
async function capture(origin: string, ca: Buffer, path: string, token: string, name: string, save: Save,
  signal: AbortSignal, rawCommand?: Uint8Array) {
  return new Promise<{status: number; raw: Buffer}>((accept, reject) => {
    const url = new URL(origin), chunks: Buffer[] = [];
    let bytes = 0, finished = false;
    const headers: Record<string, string> = {Host: url.host, Authorization: `Bearer ${token}`, Connection: 'close'};
    if (rawCommand) {headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(rawCommand.byteLength);}
    const finish = (error?: Error, value?: {status: number; raw: Buffer}) => {
      if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      pending.destroy();
      if (error) reject(error); else accept(value!);
    };
    const abort = () => finish(new Error('Discussion HTTPS total deadline exceeded.'));
    const pending = request({hostname: '127.0.0.1', port: url.port, path, method: rawCommand ? 'POST' : 'GET',
      ca, rejectUnauthorized: true, minVersion: 'TLSv1.2', agent: false, maxHeaderSize: 16384, headers}, response => {
      const socket = response.socket as TLSSocket, protocol = socket.getProtocol(), authorized = socket.authorized;
      response.on('data', (chunk: Buffer) => {
        if (finished) return;
        chunks.push(Buffer.from(chunk.subarray(0, Math.max(0, 262144 - bytes)))); bytes += chunk.length;
        if (bytes > 262144) {save(`${name}.response.bin`, Buffer.concat(chunks)); finish(new Error('Response exceeded 262144 bytes.'));}
      });
      response.once('error', () => finish(new Error('Discussion response stream failed.')));
      response.once('aborted', () => finish(new Error('Discussion response stream aborted.')));
      response.once('end', () => {
        if (finished) return;
        const raw = Buffer.concat(chunks), status = response.statusCode ?? 0;
        save(`${name}.response.bin`, raw);
        save(`${name}.exchange.json`, JSON.stringify({method: rawCommand ? 'POST' : 'GET', path,
          requestSHA256: rawCommand ? hash(rawCommand) : null, status, rawBytes: raw.byteLength, sha256: hash(raw),
          headers: response.rawHeaders, tlsProtocol: protocol, tlsAuthorized: authorized,
        }, null, 2) + '\n');
        if (!response.complete || response.headers['content-type'] !== 'application/json; charset=utf-8' ||
          response.headers['content-encoding'] !== undefined || response.headers['content-length'] !== String(raw.length) ||
          response.headers['cache-control'] !== 'no-store' || !authorized || !['TLSv1.2', 'TLSv1.3'].includes(protocol ?? '')) {
          finish(new Error('Discussion response headers/TLS do not match the fixed ingress.')); return;
        }
        finish(undefined, {status, raw});
      });
    });
    const timer = setTimeout(abort, 3000);
    pending.once('error', () => finish(new Error('Discussion HTTPS transport failed.')));
    signal.addEventListener('abort', abort, {once: true});
    if (signal.aborted) {abort(); return;}
    pending.end(rawCommand);
  });
}

it.skipIf(!fixtureRoot)('appends exactly two fixture discussions with current authorization, exact replay and historical read-back over verified TLS', async () => {
  const root = realpathSync.native(resolve(fixtureRoot!)), env = environment();
  const evidenceRoot = resolve(import.meta.dirname, '../../.harness-company-evidence');
  mkdirSync(evidenceRoot, {recursive: true});
  const evidence = mkdtempSync(join(evidenceRoot, 'discussion-https-'));
  const save: Save = (name, raw) => writeFileSync(join(evidence, name), raw, {flag: 'wx'});
  verifyPins(root, env, save, 'source-before.json');
  const expected: ReadContext = {company_id: 'leo-company', scope: {kind: 'project', id: 'alpha'}};
  const beta: ReadContext = {company_id: 'leo-company', scope: {kind: 'project', id: 'beta'}};
  const commands = [
    {schema_version: 1, action: 'owner.discussion.append', command_id: '10000000-0000-4000-8000-000000000001', summary: 'Discussion fixture 1', body: 'Alpha discussion 1: é and 🌊'},
    {schema_version: 1, action: 'owner.discussion.append', command_id: '10000000-0000-4000-8000-000000000002', summary: 'Discussion fixture 2', body: 'Alpha discussion 2: é and 🌊'},
  ] as const;
  const firstCommand = canonicalBytes(commands[0]), secondCommand = canonicalBytes(commands[1]);
  const parsedFirstCommand = parseOwnerDiscussionCommand(firstCommand);
  expect(parsedFirstCommand).toEqual(commands[0]);
  const equivalentCommand = Buffer.from(JSON.stringify(commands[0], null, 2), 'utf8');
  const changedCommand = canonicalBytes({...commands[0], body: 'conflicting fixture body'});
  // This envelope is only attempted after revocation and must never be accepted.
  const revokedCommand = canonicalBytes({...commands[0], command_id: '10000000-0000-4000-8000-000000000004', body: 'Revoked fixture command'});
  save('command-1.bin', firstCommand); save('command-1-equivalent.bin', equivalentCommand); save('command-2.bin', secondCommand);
  const fixture = startFixture(root, env, save), total = new AbortController();
  const consumerDeadline = performance.now() + 22000;
  const timer = setTimeout(() => total.abort(), 22000);
  let failure: unknown;
  try {
    const readyRaw = await fixture.readLine(5000); save('ready.json', readyRaw);
    const ready = decodeBoundedJson(readyRaw, 32768) as unknown as Ready;
    const certificate = join(root, 'tests/communications/fixtures/owner-history-test.cert.pem');
    expect(ready).toEqual({event: 'ready', fixture_only: true,
      base_url: expect.stringMatching(/^https:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/), bearer_token: publicToken,
      other_owner_token: otherToken, ca_certificate: certificate, company_id: 'leo-company', project_id: 'alpha',
      expected_command_ids: commands.map(command => command.command_id), forbidden_conversation_id: expect.stringMatching(uuid),
      forbidden_message_id: expect.stringMatching(uuid), actual_live_employees: 0,
    });
    expect(Number(new URL(ready.base_url).port)).toBeLessThanOrEqual(65535);
    const ca = readFileSync(certificate);
    expect(hash(ca)).toBe(sourcePins['tests/communications/fixtures/owner-history-test.cert.pem']);
    const client = (token = publicToken, trust: Buffer | string = ca) => new OwnerDiscussionClient({origin: ready.base_url,
      role: 'owner', credential: () => token, ca: trust, timeoutMs: 2500});
    const owner = client(), other = client(otherToken), wrong = client('public-wrong-discussion-fixture-token');
    const appendPath = '/company/v1/projects/alpha/owner-discussion/messages';
    const wire = (name: string, path: string, token = publicToken, raw?: Uint8Array) => capture(ready.base_url, ca, path, token, name, save, total.signal, raw);
    const denied = async (name: string, path: string, token: string, status: number, code: string, raw?: Uint8Array) => {
      const result = await wire(name, path, token, raw);
      expect(result.status).toBe(status);
      expect(result.raw).toEqual(Buffer.from(canonicalBytes({schema_version: 1, error: {code}})));
    };
    const receipt = await owner.append(expected, firstCommand, total.signal);
    expect(receipt).toMatchObject({command_id: commands[0].command_id, company_id: 'leo-company', scope: expected.scope,
      outcome: 'stored', request_digest: hash(canonicalBytes({contract: 'maritime-owner-discussion', version: 1, ...expected, command: commands[0]}))});
    const original = await wire('append-1-replay', appendPath, publicToken, firstCommand);
    expect(original.status).toBe(200);
    expect(Buffer.from(canonicalBytes(receipt))).toEqual(original.raw);
    expect(await validateOwnerDiscussionReceipt(original.raw, expected, parsedFirstCommand)).toEqual(receipt);
    expect(await owner.append(expected, firstCommand, total.signal)).toEqual(receipt);
    expect(await owner.append(expected, equivalentCommand, total.signal)).toEqual(receipt);
    const equivalent = await wire('append-1-equivalent', appendPath, publicToken, equivalentCommand);
    expect(equivalent.status).toBe(200); expect(equivalent.raw).toEqual(original.raw);
    await expect(owner.append(expected, changedCommand, total.signal)).rejects.toMatchObject({code: 'IDEMPOTENCY_CONFLICT'});
    await denied('conflicting-body', appendPath, publicToken, 409, 'IDEMPOTENCY_CONFLICT', changedCommand);
    await expect(wrong.append(expected, firstCommand, total.signal)).rejects.toMatchObject({code: 'AUTHENTICATION_REQUIRED'});
    await denied('wrong-token', appendPath, 'public-wrong-discussion-fixture-token', 401, 'AUTHENTICATION_REQUIRED', firstCommand);
    await expect(other.append(expected, secondCommand, total.signal)).rejects.toMatchObject({code: 'SCOPE_DENIED'});
    await denied('other-alpha-owner-append', appendPath, otherToken, 403, 'SCOPE_DENIED', secondCommand);
    await expect(owner.append(beta, secondCommand, total.signal)).rejects.toMatchObject({code: 'SCOPE_DENIED'});
    await denied('beta-append', appendPath.replace('/alpha/', '/beta/'), publicToken, 403, 'SCOPE_DENIED', secondCommand);
    const readPath = `/company/v1/projects/alpha/owner-discussion/conversations/${receipt.conversation_ref.id}/messages/${receipt.message_ref.id}`;
    const first = await owner.readBack(expected, firstCommand, receipt, total.signal);
    const historical = await wire('read-1-before-2', readPath);
    expect(historical.status).toBe(200); expect(Buffer.from(canonicalBytes(first))).toEqual(historical.raw);
    expect(await validateOwnerDiscussionReadBack(historical.raw, expected, parsedFirstCommand, receipt)).toEqual(first);
    await expect(other.readBack(expected, firstCommand, receipt, total.signal)).rejects.toMatchObject({code: 'SCOPE_DENIED'});
    await denied('other-alpha-owner-read', readPath, otherToken, 403, 'SCOPE_DENIED');
    await expect(wrong.readBack(expected, firstCommand, receipt, total.signal)).rejects.toMatchObject({code: 'AUTHENTICATION_REQUIRED'});
    await denied('wrong-token-read', readPath, 'public-wrong-discussion-fixture-token', 401, 'AUTHENTICATION_REQUIRED');
    // Shape-valid synthetic denial input only; these IDs come from the protected
    // fixture seed. It is never presented as a service-issued Beta receipt.
    const betaReceipt = await validateOwnerDiscussionReceipt(canonicalBytes({...receipt, scope: beta.scope,
      request_digest: hash(canonicalBytes({contract: 'maritime-owner-discussion', version: 1, ...beta, command: commands[0]})),
      conversation_ref: {...receipt.conversation_ref, scope: beta.scope, id: ready.forbidden_conversation_id},
      message_ref: {...receipt.message_ref, scope: beta.scope, id: ready.forbidden_message_id},
    }), beta, parsedFirstCommand);
    await expect(owner.readBack(beta, firstCommand, betaReceipt, total.signal)).rejects.toMatchObject({code: 'SCOPE_DENIED'});
    await denied('beta-read', `/company/v1/projects/beta/owner-discussion/conversations/${ready.forbidden_conversation_id}/messages/${ready.forbidden_message_id}`, publicToken, 403, 'SCOPE_DENIED');
    const receipt2 = await owner.append(expected, secondCommand, total.signal);
    expect(receipt2.command_id).toBe(commands[1].command_id);
    expect(receipt2.conversation_ref.id).toBe(receipt.conversation_ref.id);
    expect(receipt2.conversation_ref.revision).toBe(2);
    const second = await wire('append-2-replay', appendPath, publicToken, secondCommand);
    expect(second.status).toBe(200); expect(second.raw).toEqual(Buffer.from(canonicalBytes(receipt2)));
    const again = await owner.readBack(expected, firstCommand, receipt, total.signal);
    const historicalAgain = await wire('read-1-after-2', readPath);
    expect(historicalAgain.status).toBe(200); expect(historicalAgain.raw).toEqual(historical.raw);
    expect(Buffer.from(canonicalBytes(again))).toEqual(historical.raw);
    expect(again.receipt).toEqual(receipt); expect(again.conversation.revision).toBe(1);
    expect(again.conversation.digest).not.toBe(receipt2.conversation_ref.digest);
    const conversation = await validateReadOutput('Conversation', canonicalBytes(again.conversation), expected);
    const message = await validateReadOutput('Message', canonicalBytes(again.message), expected);
    for (const [record, reference] of [[conversation, receipt.conversation_ref], [message, receipt.message_ref]] as const) {
      expect(reference).toEqual({kind: record.record_type, id: record.id, company_id: 'leo-company', scope: expected.scope,
        availability: 'available', revision: record.revision, digest: record.digest, unavailable_reason: null});
      expect(record.digest).toBe(hash(canonicalBytes(Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'digest')))));
    }
    expect(message.conversation_ref).toEqual(receipt.conversation_ref);
    expect(message.summary).toBe('Discussion fixture 1'); expect(message.body).toBe('Alpha discussion 1: é and 🌊');
    expect(message.recorded_author.principal_id).toBe(receipt.principal_id);
    expect(again.digest).toBe(hash(canonicalBytes(Object.fromEntries(Object.entries(again).filter(([key]) => key !== 'digest')))));
    await expect(client(publicToken, rootCertificates[0]).readBack(expected, firstCommand, receipt, total.signal)).rejects.toMatchObject({code: 'TRANSPORT'});
    for (const operation of ['revoke-principal', 'revoke'] as const) {
      await fixture.control(operation);
      for (const [name, raw] of [['replay', firstCommand], ['append', revokedCommand]] as const) {
        await expect(owner.append(expected, raw, total.signal)).rejects.toMatchObject({code: 'AUTHENTICATION_REQUIRED'});
        await denied(`${operation}-${name}`, appendPath, publicToken, 401, 'AUTHENTICATION_REQUIRED', raw);
      }
      await expect(owner.readBack(expected, firstCommand, receipt, total.signal)).rejects.toMatchObject({code: 'AUTHENTICATION_REQUIRED'});
      await denied(`${operation}-read`, readPath, publicToken, 401, 'AUTHENTICATION_REQUIRED');
    }
    expect(performance.now()).toBeLessThan(consumerDeadline);
    save('consumer.json', JSON.stringify({checkpoint, proof: 'actual_disposable_https', company: 'leo-company', project: 'alpha',
      expectedCommandIds: commands.map(command => command.command_id), historicalRevision: 1, laterRevision: 2,
      byteIdenticalReplay: true, byteIdenticalHistoricalReadBack: true, wrongCARejected: true, controls: ['revoke-principal', 'revoke'],
      totalConsumerDeadlineMs: 22000, scope: 'public synthetic disposable fixture; enumerated source custody only',
      liveVerified: false, companyAccepted: false, nativeAccepted: false, remoteOwnerSessionAccepted: false,
    }, null, 2) + '\n');
  } catch (error) {failure = error;}
  finally {
    clearTimeout(timer); total.abort();
    try {await fixture.stop();} catch (error) {failure = failure ? new AggregateError([failure, error], 'Consumer and fixture cleanup failed.') : error;}
    try {verifyPins(root, env, save, 'source-after.json');}
    catch (error) {failure = failure ? new AggregateError([failure, error], 'Consumer or source custody failed.') : error;}
    console.info(`Owner discussion HTTPS consumer evidence: ${evidence}`);
  }
  if (failure) throw failure;
}, 45000);
