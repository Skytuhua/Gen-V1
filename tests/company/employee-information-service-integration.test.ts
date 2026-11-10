// Opt-in, one finite synthetic HTTPS counterpart. No employee/model/runtime activation.
import {execFileSync, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync} from 'node:fs';
import {request} from 'node:https';
import {isAbsolute, join, resolve} from 'node:path';
import {rootCertificates, type TLSSocket} from 'node:tls';
import {expect, it} from 'vitest';
import {EmployeeInformationClient} from '../../packages/company-client/employee-information.ts';
import {canonicalBytes, decodeBoundedJson} from '../../packages/company-contracts/communications/json.ts';
import {
  prepareEmployeeInformationCommand, validateEmployeeInformationInbox, validateEmployeeInformationReceipt,
} from '../../packages/company-contracts/communications/employee-information.ts';

const fixtureRoot = process.env.GEN_COMPANY_EMPLOYEE_INFORMATION_FIXTURE_ROOT;
const reviewedRoot = 'C:/Users/user/Documents/Maritime/hermes-swarm-control';
const checkpoint = 'ea63ac3dbb668ff5c41e0d62c7fbfcbfbb7b0520';
const gitExecutable = 'C:/Program Files/Git/cmd/git.exe';
const manifestPath = '.harness-company-evidence/employee-information-20261103/producer-pin.json';
const manifestSHA256 = '424670b1c1968110acb533a9d0bb039804d7539fc1b92fb9fd7c6a67d4af0d66';
// Additive fixture metadata handoff; canonical service/contracts stay on ea63.
const fixtureMetadata = {
  commit: '5da24ef65e95554c433c5c81f662b38028be5d55',
  checkpointPath: 'docs/evidence/employee-information-2026-11-03/fixture-metadata/checkpoint.json',
  checkpointSHA256: 'c8b72e250a7a293125969ca28828be58d7b17e4aba83d7041de14360b524006b',
  sources: {
    'tools/employee_information_fixture.py': '05f4d149119ace985918ab5a774b974d9d7ccd27b056cf769e17fabb32980422',
    'tests/communications/test_employee_information_fixture.py': 'f0bebaf1e9f0f79558f8a1ac023dc6a252a5ddf99982867e712ef301749d85f1',
    'docs/integrations/employee-information-fixture.md': 'cc5c14a6cd0599125ba23d261b959bf46d73289611a572f58d32b8bab8683e57',
  } as Record<string, string>,
};
const scope = {kind: 'project', id: 'alpha'} as const;
const commandId = '10000000-0000-4000-8000-000000000001';
const secondCommandId = '10000000-0000-4000-8000-000000000002';
const conversationId = '20000000-0000-4000-8000-000000000001';
const noteText = 'Interface note: \u00e9 and \u{1f30a}, information only.';
const sendPath = '/company/v1/commands';
const inboxPath = '/company/v1/me/inbox?project_id=alpha';
const controls = ['restart', 'advance-recipient', 'revoke-registry', 'revoke-store'] as const;
const productPaths = [
  'packages/company-client/employee-information.ts',
  'packages/company-contracts/communications/employee-information.ts',
  'tests/company/employee-information-service-integration.test.ts',
  'packages/company-contracts/communications/v1/employee-information.json',
  'packages/company-contracts/communications/v1/employee-information.schema.json',
  'packages/company-contracts/communications/v1/golden/employee-information.json',
  'tools/company/capture-command.mjs',
] as const;
type SendContext = Parameters<EmployeeInformationClient['send']>[0];
type InboxContext = Parameters<EmployeeInformationClient['inbox']>[0];
type Receipt = Awaited<ReturnType<EmployeeInformationClient['send']>>;
type Inbox = Awaited<ReturnType<EmployeeInformationClient['inbox']>>;
type Save = (name: string, raw: Uint8Array | string) => void;
interface PinManifest {
  base: string; commit: string; checkpoint: {path: string; sha256: string}; sources: Record<string, string>;
  runtime: {path: string; workingSHA256: string; committedSHA256: string; rawEqual: boolean}[];
}
interface Ready {
  event: 'ready'; fixture_only: true; base_url: string; ca_certificate: string;
  company_id: 'leo-company'; project_id: 'alpha'; sender_employee_id: 'E10'; recipient_employee_id: 'E11';
  sender_task_id: string; sender_attempt_id: string; recipient_task_id: string; recipient_attempt_id: string;
  sender_token: string; recipient_token: string; foreign_employee_token: string; missing_generation_token: string;
  authority_evidence_scope: 'synthetic_only'; actual_live_employees: 0; controls: string[];
}
interface ControlEvent {
  event: 'control'; operation: typeof controls[number]; done: true; base_url?: string;
  recipient_generation?: number; recipient_generation2_token?: string; recipient_generation2_rotated_token?: string;
  recipient_generation2_task_id?: string; recipient_generation2_attempt_id?: string;
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const projectRoot = resolve(import.meta.dirname, '../..');
const products = () => Object.fromEntries(productPaths.map(path => [path, hash(readFileSync(join(projectRoot, path)))]));

async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {return await Promise.race([promise, new Promise<never>((_accept, reject) => {
    timer = setTimeout(() => reject(new Error('Owned employee fixture deadline exceeded.')), Math.max(1, milliseconds));
  })]);} finally {clearTimeout(timer);}
}
function environment(): NodeJS.ProcessEnv {
  if (process.platform !== 'win32') throw new Error('Requires the reviewed Windows fixture and existing interpreter.');
  const directory = (input: string | undefined) => {
    if (!input || !isAbsolute(input) || input.includes('\0')) throw new Error('Fixture environment directory unavailable.');
    const path = realpathSync.native(input);
    if (!statSync(path).isDirectory()) throw new Error('Fixture environment path unavailable.');
    return path;
  };
  const systemRoot = directory(process.env.SystemRoot ?? process.env.WINDIR);
  const temporary = directory(process.env.TEMP ?? process.env.TMP);
  return {SystemRoot: systemRoot, WINDIR: systemRoot, TEMP: temporary, TMP: temporary};
}
function verifyPins(root: string, env: NodeJS.ProcessEnv, save: Save, name: string) {
  const manifestRaw = readFileSync(join(projectRoot, manifestPath));
  expect(hash(manifestRaw)).toBe(manifestSHA256);
  const pins = decodeBoundedJson(manifestRaw, 32768) as unknown as PinManifest;
  expect(pins.base).toBe(reviewedRoot); expect(pins.commit).toBe(checkpoint);
  expect(Object.keys(pins.sources)).toHaveLength(17); expect(pins.runtime).toHaveLength(29);
  const git = (args: string[]) => execFileSync(gitExecutable, ['--no-pager', '-C', root, ...args], {
    env: {...env, GIT_NO_REPLACE_OBJECTS: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL'},
    windowsHide: true, timeout: 5000, maxBuffer: 1048576, stdio: ['ignore', 'pipe', 'pipe'],
  });
  expect(git(['rev-parse', '--verify', `${checkpoint}^{commit}`]).toString('ascii').trim()).toBe(checkpoint);
  expect(git(['rev-parse', '--verify', `${fixtureMetadata.commit}^{commit}`]).toString('ascii').trim()).toBe(fixtureMetadata.commit);
  const observedHead = git(['rev-parse', '--verify', 'HEAD']).toString('ascii').trim();
  const observed: Record<string, unknown> = {};
  const paths = new Set([...Object.keys(pins.sources), ...pins.runtime.map(pin => pin.path), pins.checkpoint.path]);
  for (const path of paths) {
    const committed = git(['cat-file', 'blob', `${checkpoint}:${path}`]), working = readFileSync(join(root, path));
    const source = pins.sources[path], runtime = pins.runtime.find(pin => pin.path === path), override = fixtureMetadata.sources[path];
    const committedSHA256 = hash(committed), workingSHA256 = hash(working);
    const metadataCommitted = override ? git(['cat-file', 'blob', `${fixtureMetadata.commit}:${path}`]) : undefined;
    observed[path] = {committedSHA256, workingSHA256, rawEqualToOriginal: committed.equals(working),
      ...(metadataCommitted ? {metadataCommittedSHA256: hash(metadataCommitted), rawEqualToMetadata: metadataCommitted.equals(working)} : {})};
    if (source) {expect(committedSHA256, `original committed ${path}`).toBe(source); expect(workingSHA256, `working ${path}`).toBe(override ?? source);}
    if (metadataCommitted) {expect(hash(metadataCommitted), `metadata committed ${path}`).toBe(override); expect(metadataCommitted.equals(working)).toBe(true);}
    if (runtime) {
      expect(committedSHA256, `runtime committed ${path}`).toBe(runtime.committedSHA256);
      expect(workingSHA256, `runtime working ${path}`).toBe(override ?? runtime.workingSHA256);
      if (!override) expect(committed.equals(working)).toBe(runtime.rawEqual);
      if (!override && !runtime.rawEqual) {
        expect(path).toBe('config/company.example.yaml');
        expect(working.toString('utf8').replaceAll('\r\n', '\n')).toBe(committed.toString('utf8').replaceAll('\r\n', '\n'));
      }
    }
    if (path === pins.checkpoint.path) {
      expect(committedSHA256).toBe(pins.checkpoint.sha256); expect(workingSHA256).toBe(pins.checkpoint.sha256);
    }
  }
  const metadataCheckpointCommitted = git(['cat-file', 'blob', `${fixtureMetadata.commit}:${fixtureMetadata.checkpointPath}`]);
  const metadataCheckpointWorking = readFileSync(join(root, fixtureMetadata.checkpointPath));
  expect(hash(metadataCheckpointCommitted)).toBe(fixtureMetadata.checkpointSHA256);
  expect(hash(metadataCheckpointWorking)).toBe(fixtureMetadata.checkpointSHA256);
  save(name, JSON.stringify({checkpoint, observedHead, manifestSHA256, reviewedSources: 17, runtimeFiles: 29,
    fixtureMetadata, metadataCheckpointCommittedSHA256: hash(metadataCheckpointCommitted), metadataCheckpointWorkingSHA256: hash(metadataCheckpointWorking),
    observed, scope: 'enumerated source/runtime custody only; no whole Python/dependency/configuration claim'}, null, 2) + '\n');
  for (const path of ['employee-information.json', 'employee-information.schema.json', 'golden/employee-information.json']) {
    expect(readFileSync(join(projectRoot, 'packages/company-contracts/communications/v1', path)))
      .toEqual(readFileSync(join(root, 'contracts/communications/v1', path)));
  }
}

function startFixture(root: string, env: NodeJS.ProcessEnv, save: Save) {
  const python = join(root, '.venv/Scripts/python.exe'), script = join(root, 'tools/employee_information_fixture.py');
  if (!existsSync(python) || !existsSync(script)) throw new Error('Existing fixture/interpreter unavailable.');
  const args = ['-I', '-B', script, '--seconds', '45'];
  const startedAt = new Date().toISOString(), deadline = performance.now() + 40000;
  const child = spawn(python, args, {cwd: root, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
  const stdout: Buffer[] = [], stderr: Buffer[] = [], lines: Buffer[] = [];
  let fragment = Buffer.alloc(0), total = 0, forced = false, failure: Error | undefined;
  let waiting: {resolve: (line: Buffer) => void; reject: (error: Error) => void} | undefined;
  const fail = (error: Error) => {failure ??= error; waiting?.reject(error);};
  const collect = (chunk: Buffer, output: Buffer[]) => {
    output.push(Buffer.from(chunk.subarray(0, Math.max(0, 32768 - total)))); total += chunk.length;
    if (total > 32768) {fail(new Error('Fixture process output exceeded 32768 bytes.')); return false;} return true;
  };
  child.stdin.on('error', () => {});
  child.once('error', () => fail(new Error('Owned fixture launch failed.')));
  child.stdout.on('data', (chunk: Buffer) => {
    if (!collect(chunk, stdout)) return;
    fragment = Buffer.concat([fragment, chunk]);
    for (let end = fragment.indexOf(10); end >= 0; end = fragment.indexOf(10)) {
      const line = Buffer.from(fragment.subarray(0, end + 1)); fragment = fragment.subarray(end + 1);
      if (waiting) {const current = waiting; waiting = undefined; current.resolve(line);} else lines.push(line);
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {collect(chunk, stderr);});
  const closed = new Promise<{code: number | null; signal: NodeJS.Signals | null}>(accept => {
    child.once('close', (code, signal) => {waiting?.reject(new Error('Fixture closed before its event.')); accept({code, signal});});
  });
  async function readLine(milliseconds = 3000) {
    if (failure) throw failure;
    const queued = lines.shift(); if (queued) return queued;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Fixture event unavailable after close.');
    try {return await bounded(new Promise<Buffer>((accept, reject) => {waiting = {resolve: accept, reject};}),
      Math.min(milliseconds, deadline - performance.now()));} finally {waiting = undefined;}
  }
  async function control(operation: typeof controls[number]) {
    if (performance.now() >= deadline) throw new Error('Fixture deadline exceeded before control.');
    child.stdin.write(operation + '\n');
    const raw = await readLine(); save(`${operation}.json`, raw);
    const result = decodeBoundedJson(raw, 32768) as unknown as ControlEvent;
    expect(result).toMatchObject({event: 'control', operation, done: true});
    return result;
  }
  async function stop() {
    let exit: Awaited<typeof closed> | undefined, pidRemains: boolean | null = null;
    try {
      if (child.exitCode === null && child.signalCode === null) child.stdin.end('stop\n');
      try {exit = await bounded(closed, 5000);} catch {
        forced = true; child.kill('SIGKILL'); exit = await bounded(closed, 2000);
        throw new Error('Owned fixture required forced termination.');
      }
      if (child.pid !== undefined) {
        try {process.kill(child.pid, 0); pidRemains = true;} catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; pidRemains = false;
        }
      }
      const raw = await readLine(100); save('stopped.json', raw);
      expect(decodeBoundedJson(raw, 32768)).toEqual({event: 'stopped', fixture_only: true, normal_stop: true,
        canonical_messages: 2, canonical_deliveries: 2, canonical_events: 2, canonical_receipts: 2,
        expected_counts: true, protected_beta_unchanged: true, historical_rows_unchanged: true,
        operational_rows_unchanged_outside_controls: true, temporary_store_removed: true,
        control_thread_stopped: true, server_instances: 2, controls: [...controls], expected_controls: true,
        no_delivery_consumption: true, actual_live_employees: 0});
      expect(exit).toEqual({code: 0, signal: null}); expect(pidRemains).toBe(false);
      expect(Buffer.concat(stderr)).toHaveLength(0); expect(lines).toHaveLength(0); expect(fragment).toHaveLength(0);
      expect(child.stdout.readableEnded && child.stdout.destroyed).toBe(true);
      expect(child.stderr.readableEnded && child.stderr.destroyed).toBe(true);
      if (failure) throw failure;
    } finally {
      save('fixture.stdout.bin', Buffer.concat(stdout)); save('fixture.stderr.bin', Buffer.concat(stderr));
      save('cleanup.json', JSON.stringify({startedAt, finishedAt: new Date().toISOString(), executable: python, args,
        environmentKeys: Object.keys(env), pid: child.pid, exit, pidRemains, forcedTermination: forced,
        stdoutReaderStopped: child.stdout.readableEnded && child.stdout.destroyed,
        stderrReaderStopped: child.stderr.readableEnded && child.stderr.destroyed,
        outputBytes: total, outputLimitExceeded: total > 32768, fragmentBytes: fragment.length, pendingLines: lines.length,
      }, null, 2) + '\n');
    }
  }
  return {readLine, control, stop, deadline};
}

interface RawOptions {method?: 'GET' | 'POST'; body?: Buffer; headers?: string[]}
// Independent verified-TLS capture: retain complete raw replies and headers before parsing.
async function capture(origin: string, ca: Buffer, path: string, token: string, name: string, save: Save,
  signal: AbortSignal, options: RawOptions = {}) {
  return new Promise<{status: number; raw: Buffer}>((accept, reject) => {
    const url = new URL(origin), method = options.method ?? 'GET', chunks: Buffer[] = [];
    let bytes = 0, finished = false;
    const headers = ['Host', url.host, 'Authorization', `Bearer ${token}`, 'Connection', 'close',
      ...(options.body ? ['Content-Type', 'application/json', 'Content-Length', String(options.body.length)] : []),
      ...(options.headers ?? [])];
    const finish = (error?: Error, result?: {status: number; raw: Buffer}) => {
      if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort); pending.destroy();
      if (error) reject(error); else accept(result!);
    };
    const abort = () => finish(new Error('Employee HTTPS deadline exceeded.'));
    const pending = request({hostname: '127.0.0.1', port: url.port, method, path, headers,
      ca, rejectUnauthorized: true, minVersion: 'TLSv1.2', agent: false, maxHeaderSize: 16384}, response => {
      const socket = response.socket as TLSSocket, protocol = socket.getProtocol(), authorized = socket.authorized;
      response.on('data', (chunk: Buffer) => {
        chunks.push(Buffer.from(chunk.subarray(0, Math.max(0, 262144 - bytes)))); bytes += chunk.length;
        if (bytes > 262144) {save(`${name}.response.bin`, Buffer.concat(chunks)); finish(new Error('Response exceeded262144 bytes.'));}
      });
      response.once('error', () => finish(new Error('Employee HTTPS response failed.')));
      response.once('aborted', () => finish(new Error('Employee HTTPS response aborted.')));
      response.once('end', () => {
        if (finished) return;
        const raw = Buffer.concat(chunks), status = response.statusCode ?? 0;
        save(`${name}.response.bin`, raw);
        save(`${name}.exchange.json`, JSON.stringify({origin, method, path, requestHeaders: headers,
          requestBodySHA256: options.body ? hash(options.body) : null, requestBytes: options.body?.length ?? 0,
          status, responseHeaders: response.rawHeaders, responseBytes: raw.length, responseSHA256: hash(raw),
          tlsProtocol: protocol, tlsAuthorized: authorized, complete: response.complete,
        }, null, 2) + '\n');
        const headerValues = (key: string) => response.rawHeaders.filter((_value, index) =>
          index % 2 === 1 && response.rawHeaders[index - 1].toLowerCase() === key);
        if (!response.complete || !authorized || !['TLSv1.2', 'TLSv1.3'].includes(protocol ?? '') ||
          JSON.stringify(headerValues('content-type')) !== JSON.stringify(['application/json; charset=utf-8']) ||
          JSON.stringify(headerValues('content-length')) !== JSON.stringify([String(raw.length)]) ||
          JSON.stringify(headerValues('cache-control')) !== JSON.stringify(['no-store']) ||
          JSON.stringify(headerValues('x-content-type-options')) !== JSON.stringify(['nosniff']) ||
          headerValues('content-encoding').length || headerValues('transfer-encoding').length) {
          finish(new Error('Employee HTTPS response framing/TLS mismatch.')); return;
        }
        try {expect(Buffer.from(canonicalBytes(decodeBoundedJson(raw, 262144)))).toEqual(raw);}
        catch {finish(new Error('Employee HTTPS response is not canonical strict JSON.')); return;}
        finish(undefined, {status, raw});
      });
    });
    const timer = setTimeout(abort, 3000);
    pending.once('error', () => finish(new Error('Employee HTTPS transport failed.')));
    signal.addEventListener('abort', abort, {once: true});
    if (signal.aborted) {abort(); return;} pending.end(options.body);
  });
}
function signed(value: {readonly digest: string}) {
  expect(value.digest).toBe(hash(canonicalBytes(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'digest')))));
}
function assertPage(page: Inbox, expectedLimit: number, receipts: Receipt[], truncation: 'none' | 'item_limit' = 'none') {
  expect(page).toMatchObject({schema_version: 1, projection_type: 'employee_inbox', company_id: 'leo-company', scope,
    requested_limit: expectedLimit, order: 'recipient_sequence_descending', next_cursor: null, has_more: null,
    coverage: {status: truncation === 'none' ? 'observed' : 'partial', truncation, total_count: null}});
  expect(page.items).toHaveLength(receipts.length); signed(page);
  for (const [index, receipt] of receipts.entries()) {
    const item = page.items[index]; signed(item);
    expect(item.receipt).toEqual(receipt);
    for (const key of ['conversation', 'message', 'delivery', 'event', 'receipt'] as const) signed(item[key]);
    expect(item.message.body).toBe(index === 0 && receipts.length > 1 ? 'Still information only.' :
      receipt.command_id === secondCommandId ? 'Still information only.' : noteText);
    expect(item.delivery.received_at).toBeNull(); expect(item.delivery.consumed_at).toBeNull();
  }
}

it.skipIf(!fixtureRoot)('one finite employee information send/replay/inbox/current-authority HTTPS counterpart', async () => {
  expect(realpathSync.native(fixtureRoot!)).toBe(realpathSync.native(reviewedRoot));
  const evidenceParent = join(projectRoot, '.harness-company-evidence'); mkdirSync(evidenceParent, {recursive: true});
  const output = mkdtempSync(join(evidenceParent, 'employee-https-'));
  const save: Save = (name, raw) => writeFileSync(join(output, name), raw, {flag: 'wx'});
  const env = environment(), before = products(); save('product-before.json', JSON.stringify(before, null, 2) + '\n');
  verifyPins(reviewedRoot, env, save, 'source-before.json');
  const fixture = startFixture(reviewedRoot, env, save);
  try {
    const readyRaw = await fixture.readLine(8000); save('ready.json', readyRaw);
    const ready = decodeBoundedJson(readyRaw, 32768) as unknown as Ready;
    expect(ready).toMatchObject({event: 'ready', fixture_only: true, company_id: 'leo-company', project_id: 'alpha',
      sender_employee_id: 'E10', recipient_employee_id: 'E11', sender_task_id: 'task-E10', recipient_task_id: 'task-E11',
      authority_evidence_scope: 'synthetic_only', actual_live_employees: 0, controls: [...controls, 'stop'],
      sender_token: 'PUBLIC-synthetic-information-E10-fixture', recipient_token: 'PUBLIC-synthetic-information-E11-fixture',
      foreign_employee_token: 'PUBLIC-synthetic-information-E12-fixture',
      missing_generation_token: 'PUBLIC-synthetic-information-missing-generation-fixture'});
    expect(ready.sender_attempt_id).toMatch(/^[a-f0-9]{32}$/); expect(ready.recipient_attempt_id).toMatch(/^[a-f0-9]{32}$/);
    expect(ready.base_url).toMatch(/^https:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
    expect(realpathSync.native(ready.ca_certificate)).toBe(realpathSync.native(join(reviewedRoot, 'tests/communications/fixtures/owner-history-test.cert.pem')));
    let origin = ready.base_url;
    const ca = readFileSync(ready.ca_certificate), signal = AbortSignal.timeout(Math.max(1, Math.ceil(fixture.deadline - performance.now())));
    const identity = (role: 'sender' | 'recipient') => ({principal_id: `employee:${role === 'sender' ? 'E10' : 'E11'}`,
      employee_id: role === 'sender' ? 'E10' : 'E11', machine_id: `synthetic-machine-${role === 'sender' ? 'E10' : 'E11'}`,
      generation: 1, task_id: ready[`${role}_task_id`], attempt_id: ready[`${role}_attempt_id`],
      work_order_id: `order-${role === 'sender' ? 'E10' : 'E11'}`});
    const expected: SendContext = {company_id: 'leo-company', scope, sender: identity('sender'), recipient: identity('recipient')};
    const expectedInbox: InboxContext = {company_id: 'leo-company', scope, recipient: identity('recipient')};
    save('independently-retained-context.json', JSON.stringify({send: expected, inbox: expectedInbox}, null, 2) + '\n');
    const client = (token: string, selectedCA = ca) => new EmployeeInformationClient({origin, role: 'employee', credential: () => token, ca: selectedCA, timeoutMs: 3000});
    const command = (second = false) => ({schema_version: 1, command_id: second ? secondCommandId : commandId,
      action: 'message.send', scope, payload: {conversation_id: conversationId, kind: 'note', task_id: ready.sender_task_id,
        attempt_id: ready.sender_attempt_id, summary: second ? 'Second note' : 'Bounded employee information',
        body: second ? 'Still information only.' : noteText, required_action: null, response_required: false,
        recipient_employee_ids: ['E11'], observer_employee_ids: [], artifact_refs: [], reply_to_message_id: null}});
    const original = command(), originalRaw = Buffer.from(canonicalBytes(original)); save('original-command.bin', originalRaw);
    const prepared = await prepareEmployeeInformationCommand(originalRaw, expected);
    const raw = (name: string, token: string, path = inboxPath, options: RawOptions = {}) =>
      capture(origin, ca, path, token, name, save, signal, options);
    const denied = async (name: string, status: number, code: string, token: string, path = inboxPath, options: RawOptions = {}) => {
      const result = await raw(name, token, path, options); expect(result.status).toBe(status);
      expect(decodeBoundedJson(result.raw, 262144)).toEqual({schema_version: 1, error: {code}});
    };
    await expect(capture(origin, Buffer.from(rootCertificates.join('\n')), inboxPath, ready.recipient_token,
      'wrong-ca', save, signal)).rejects.toThrow('transport failed');
    await expect(client(ready.recipient_token, Buffer.from(rootCertificates.join('\n'))).inbox(expectedInbox, 20, signal)).rejects.toMatchObject({code: 'TRANSPORT'});
    await denied('wrong-token', 401, 'AUTHENTICATION_REQUIRED', 'PUBLIC-invalid-employee-token');
    await denied('missing-generation', 403, 'SCOPE_DENIED', ready.missing_generation_token);
    await denied('beta-on-alpha', 403, 'SCOPE_DENIED', ready.foreign_employee_token);
    for (const [name, header] of [['origin', 'Origin'], ['transfer-encoding', 'Transfer-Encoding'], ['content-encoding', 'Content-Encoding']] as const) {
      await denied(`forbidden-${name}`, 400, 'INVALID_REQUEST', ready.recipient_token, inboxPath, {headers: [header, '']});
    }
    await denied('wrong-host', 400, 'INVALID_REQUEST', ready.recipient_token, inboxPath, {headers: ['Host', 'localhost']});
    await denied('get-content-type', 400, 'INVALID_REQUEST', ready.recipient_token, inboxPath, {headers: ['Content-Type', 'application/json']});
    await denied('duplicate-length', 400, 'INVALID_REQUEST', ready.sender_token, sendPath, {method: 'POST', body: originalRaw, headers: ['Content-Length', String(originalRaw.length)]});
    for (const [name, patch, status] of [
      ['forged-actor', {sender_role: 'owner'}, 400], ['forged-task', {task_id: 'task-E11'}, 403],
      ['foreign-recipient', {recipient_employee_ids: ['E12']}, 403], ['unsupported-assignment', {kind: 'assignment'}, 400],
      ['unsupported-handoff', {kind: 'handoff'}, 403], ['artifact', {artifact_refs: [{id: 'fake'}]}, 400],
    ] as const) {
      const forged = Buffer.from(canonicalBytes({...original, payload: {...original.payload, ...patch}}));
      await denied(name, status, status === 400 ? 'INVALID_REQUEST' : 'SCOPE_DENIED', ready.sender_token, sendPath, {method: 'POST', body: forged});
    }
    const accepted = await raw('first-accepted', ready.sender_token, sendPath, {method: 'POST', body: originalRaw});
    expect(accepted.status).toBe(202);
    const receipt = await validateEmployeeInformationReceipt(accepted.raw, expected, prepared);
    expect(receipt).toEqual(await client(ready.sender_token).send(expected, originalRaw, signal));
    const firstRaw = await raw('first-inbox', ready.recipient_token, inboxPath + '&limit=20'); expect(firstRaw.status).toBe(200);
    const first = await validateEmployeeInformationInbox(firstRaw.raw, expectedInbox, 20); assertPage(first, 20, [receipt]);
    expect(await client(ready.recipient_token).inbox(expectedInbox, 20, signal)).toEqual(first);
    const senderInbox: InboxContext = {company_id: 'leo-company', scope, recipient: identity('sender')};
    assertPage(await client(ready.sender_token).inbox(senderInbox, 20, signal), 20, []);
    const historical = Buffer.from(canonicalBytes(first.items[0])); save('first-historical-item.bin', historical);
    const changed = Buffer.from(canonicalBytes({...original, payload: {...original.payload, body: 'Changed same command arguments'}}));
    await denied('changed-same-command', 409, 'IDEMPOTENCY_CONFLICT', ready.sender_token, sendPath, {method: 'POST', body: changed});
    const secondRaw = Buffer.from(canonicalBytes(command(true))); save('second-command.bin', secondRaw);
    const second = await client(ready.sender_token).send(expected, secondRaw, signal);
    const secondResponse = await raw('second-accepted-replay', ready.sender_token, sendPath, {method: 'POST', body: secondRaw});
    expect(secondResponse.status).toBe(202); expect(secondResponse.raw).toEqual(Buffer.from(canonicalBytes(second)));
    const all = await client(ready.recipient_token).inbox(expectedInbox, 20, signal); assertPage(all, 20, [second, receipt]);
    const allRaw = await raw('two-items-inbox', ready.recipient_token, inboxPath + '&limit=20');
    expect(allRaw.status).toBe(200); expect(await validateEmployeeInformationInbox(allRaw.raw, expectedInbox, 20)).toEqual(all);
    expect(all.items.map(item => item.conversation.revision)).toEqual([2, 1]);
    expect(all.items.map(item => item.delivery.inbox_sequence)).toEqual([2, 1]);
    expect(Buffer.from(canonicalBytes(all.items[1]))).toEqual(historical);
    const limited = await client(ready.recipient_token).inbox(expectedInbox, 1, signal); assertPage(limited, 1, [second], 'item_limit');
    const limitedRaw = await raw('limit-one-inbox', ready.recipient_token, inboxPath + '&limit=1');
    expect(limitedRaw.status).toBe(200); expect(await validateEmployeeInformationInbox(limitedRaw.raw, expectedInbox, 1)).toEqual(limited);
    const replay = await raw('first-replay-after-second', ready.sender_token, sendPath, {method: 'POST', body: originalRaw});
    expect(replay.status).toBe(202); expect(replay.raw).toEqual(accepted.raw);
    const restart = await fixture.control('restart'); expect(restart.base_url).toMatch(/^https:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
    expect(restart.base_url).not.toBe(origin); origin = restart.base_url!;
    expect(await client(ready.sender_token).send(expected, originalRaw, signal)).toEqual(receipt);
    const reopenedReplay = await raw('first-replay-after-store-listener-reopen', ready.sender_token, sendPath, {method: 'POST', body: originalRaw});
    expect(reopenedReplay.status).toBe(202); expect(reopenedReplay.raw).toEqual(accepted.raw);
    const reopened = await client(ready.recipient_token).inbox(expectedInbox, 20, signal);
    assertPage(reopened, 20, [second, receipt]); expect(Buffer.from(canonicalBytes(reopened.items[1]))).toEqual(historical);
    const reopenedRaw = await raw('inbox-after-store-listener-reopen', ready.recipient_token, inboxPath + '&limit=20');
    expect(reopenedRaw.status).toBe(200); expect(await validateEmployeeInformationInbox(reopenedRaw.raw, expectedInbox, 20)).toEqual(reopened);
    const advance = await fixture.control('advance-recipient');
    expect(advance).toMatchObject({recipient_generation: 2, recipient_generation2_token: 'PUBLIC-synthetic-information-E11-generation2-fixture',
      recipient_generation2_rotated_token: 'PUBLIC-synthetic-information-E11-generation2-rotated-fixture', recipient_generation2_task_id: 'task-E11'});
    expect(advance.recipient_generation2_attempt_id).toMatch(/^[a-f0-9]{32}$/);
    expect(advance.recipient_generation2_attempt_id).not.toBe(ready.recipient_attempt_id);
    // Actual fixture claim metadata is retained before credential/inbox awaits.
    // The returned inbox Actor never becomes expected identity or authority.
    const generationTwo: InboxContext = {company_id: 'leo-company', scope, recipient: {...identity('recipient'),
      generation: 2, task_id: advance.recipient_generation2_task_id!, attempt_id: advance.recipient_generation2_attempt_id!}};
    save('independently-retained-generation-two.json', JSON.stringify(generationTwo, null, 2) + '\n');
    await denied('generation-one-denied', 403, 'SCOPE_DENIED', ready.recipient_token);
    await expect(client(ready.recipient_token).inbox(expectedInbox, 20, signal)).rejects.toMatchObject({code: 'SCOPE_DENIED', status: 403});
    const generationTwoPage = await client(advance.recipient_generation2_token!).inbox(generationTwo, 20, signal);
    assertPage(generationTwoPage, 20, []);
    const generationTwoRaw = await raw('generation-two-empty-inbox', advance.recipient_generation2_token!, inboxPath + '&limit=20');
    expect(generationTwoRaw.status).toBe(200);
    expect(await validateEmployeeInformationInbox(generationTwoRaw.raw, generationTwo, 20)).toEqual(generationTwoPage);
    await denied('replay-after-generation-change', 403, 'SCOPE_DENIED', ready.sender_token, sendPath, {method: 'POST', body: originalRaw});
    await expect(client(ready.sender_token).send(expected, originalRaw, signal)).rejects.toMatchObject({code: 'SCOPE_DENIED', status: 403});
    await fixture.control('revoke-registry');
    await denied('registry-revoked', 401, 'AUTHENTICATION_REQUIRED', advance.recipient_generation2_token!);
    await expect(client(advance.recipient_generation2_token!).inbox(generationTwo, 20, signal)).rejects.toMatchObject({code: 'AUTHENTICATION_REQUIRED', status: 401});
    const rotatedPage = await client(advance.recipient_generation2_rotated_token!).inbox(generationTwo, 20, signal);
    assertPage(rotatedPage, 20, []);
    const rotatedRaw = await raw('rotated-generation-two-empty-inbox', advance.recipient_generation2_rotated_token!, inboxPath + '&limit=20');
    expect(rotatedRaw.status).toBe(200);
    expect(await validateEmployeeInformationInbox(rotatedRaw.raw, generationTwo, 20)).toEqual(rotatedPage);
    await fixture.control('revoke-store');
    await denied('store-revoked', 401, 'AUTHENTICATION_REQUIRED', advance.recipient_generation2_rotated_token!);
    await expect(client(advance.recipient_generation2_rotated_token!).inbox(generationTwo, 20, signal)).rejects.toMatchObject({code: 'AUTHENTICATION_REQUIRED', status: 401});
    await denied('sender-replay-after-recipient-revocation', 403, 'SCOPE_DENIED', ready.sender_token, sendPath, {method: 'POST', body: originalRaw});
    await expect(client(ready.sender_token).send(expected, originalRaw, signal)).rejects.toMatchObject({code: 'SCOPE_DENIED', status: 403});
    save('scope.json', JSON.stringify({proofScope: 'finite_authenticated_synthetic_employee_information_TLS_counterpart',
      fixtureOnly: true, actualLiveEmployees: 0, tlsCAAndHostnameVerified: true, wrongCARejected: true,
      physicalStoreAndListenerReopen: true, producerProcessRestart: false, expectedCanonicalRecordsEach: 2,
      noAutomaticRetryPollingACKRuntimeOrModel: true, originalReceiptSHA256: hash(accepted.raw),
      generationTwoIndependentAttemptHandoff: fixtureMetadata.commit, outputDirectory: output}, null, 2) + '\n');
  } catch (error) {
    save('failed.json', JSON.stringify({errorType: error instanceof Error ? error.name : 'UNKNOWN',
      errorMessage: error instanceof Error ? error.message : 'UNKNOWN'}, null, 2) + '\n'); throw error;
  } finally {
    try {await fixture.stop();} finally {
      const after = products(); save('product-after.json', JSON.stringify(after, null, 2) + '\n');
      verifyPins(reviewedRoot, env, save, 'source-after.json'); expect(after).toEqual(before);
    }
  }
}, 90000);
