import {execFileSync, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync} from 'node:fs';
import {request} from 'node:https';
import {isAbsolute, join, resolve} from 'node:path';
import {rootCertificates, type TLSSocket} from 'node:tls';
import {expect, it} from 'vitest';
import {OwnerDiscussionThreadClient} from '../../packages/company-client/owner-discussion-thread.ts';
import {canonicalBytes, decodeBoundedJson} from '../../packages/company-contracts/communications/json.ts';
import {validateOwnerDiscussionThread} from '../../packages/company-contracts/communications/owner-discussion-thread.ts';
import type {OwnerDiscussionReadBack} from '../../packages/company-contracts/communications/owner-discussion.ts';
import type {ReadContext} from '../../packages/company-contracts/communications/reads.ts';

const fixtureRoot = process.env.GEN_COMPANY_OWNER_DISCUSSION_THREAD_FIXTURE_ROOT;
const checkpoint = '06dd3273f9238b830fed0a6e65b08eb9f1cc73fa';
const publicToken = 'PUBLIC-disposable-owner-discussion-thread-HTTPS-fixture-only';
const otherToken = 'PUBLIC-disposable-other-owner-discussion-thread-fixture-only';
const gitExecutable = 'C:\\Program Files\\Git\\cmd\\git.exe';
const route = '/company/v1/projects/alpha/owner-discussion/thread';
const maximumResponseBytes = 262144;
const maximumMetadataBytes = 32768;
type Case = 'regular' | 'empty' | 'byte';
type Thread = Awaited<ReturnType<OwnerDiscussionThreadClient['readThread']>>;
type Save = (name: string, raw: Uint8Array | string) => void;
const hash = (raw: Uint8Array) => createHash('sha256').update(raw).digest('hex');

// Literal pins copied from the sealed checkpoint: exactly 13 candidate sources,
// all 33 enumerated frozen sources, the checkpoint, and public fixture trust.
// These are enumerated source custody, not custody of every Python dependency.
const sourcePins = {
  'src/company/comms/queries.py': '8bcf9bb0bb04ebbaad971c5479cfc3e54a560b634c19fe88c9adf19c6d1aa38b',
  'src/company/comms/owner_discussion_thread_ingress.py': 'b0d942105902ab6730a31b26027cdd681ec658f45d41d28660694ba46b5eac83',
  'tools/owner_discussion_thread_fixture.py': '2a83d513c0c1d80d23f1116cf62b631507c122e23552e3fc0107e832149c9229',
  'tests/communications/test_discussion_thread.py': '3c1316de5916aaf91d33977b9f441c6307e4d08892083815a27ab5e13770cadc',
  'tests/communications/test_discussion_thread_ingress.py': 'd203138e46f807852608a8132471cf515e1693679d2c81a804cd7824f45edf42',
  'tests/communications/test_discussion_thread_fixture.py': 'b62e07b19fdce1f955a4b4e190f0d70eb955abb213ec769c67e1a11421aeea7e',
  'tests/communications/test_discussion_thread_contract.py': 'dd83a36a576b78830e7533aee721a8340ec5bb81ad58a219aafff7036aa95f4b',
  'contracts/communications/owner-discussion-thread-candidate.1/manifest.json': 'cd386b8a084f2619868219a673be2b718802be95bc90cfca96258e13e5c0f6d8',
  'contracts/communications/owner-discussion-thread-candidate.1/thread.schema.json': '442ed5428659ce3336639efd89d651bea54bb4db03bec1b0ca285700c8a173b4',
  'contracts/communications/owner-discussion-thread-candidate.1/examples.json': '6e9ba136bcf3fca5e235201120441b59fc5a983397c6e978f800000e2c872427',
  'docs/integrations/owner-discussion-thread.md': '665778e05bf7a6db729ba9342c406a8ef78c3d45bfb9a6a02ca98d772bf68abc',
  'docs/integrations/owner-discussion-thread-fixture.md': '82f5f5757f00a4e514622db08f5e64f3dbf79912ceb46115be0bfd55aca3a03e',
  '.gitattributes': 'b275e23834b38c5fde875d973a410e0abfd22a998150dcd339272f6c0d01e831',
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
  'contracts/communications/owner-history-read-candidate.1/manifest.json': '7022869daf40871777f8bd5368b2c75481f3cd4a1ce81bb737f2c92e0e6e60f3',
  'contracts/communications/owner-note-history-candidate.1/golden.json': 'f0afeb4ba60c5c11bfcd9c02f5c51d240ce7043351a5d5f9984ff80c7ea239e5',
  'contracts/communications/owner-note-history-candidate.1/history.schema.json': '56810ef076b97563bce763eba05bb55fb6f60aa5f76a960eae92c3628680ad74',
  'contracts/communications/owner-note-history-candidate.1/manifest.json': '26fd87d8b2065a1546f905963c8c0ebdc06f7a4783dd10993f94d83bb85a5f54',
  'contracts/communications/reads-candidate.1/golden.json': '733936251185f535dc516f4b4eb6b315dd5fcb539114cb0b65eec294d9de8241',
  'contracts/communications/reads-candidate.1/manifest.json': 'd7cecf4b7d49c3bbb2ae154725762b5d5dc3af24abbfecf4f56ad70004a12df3',
  'contracts/communications/reads-candidate.1/records.schema.json': '98fd331df7aa5262eefbf7bf73a3396d7ffd3b40e13f186e4d9aaa3a735958af',
  'contracts/communications/v1/discussion-command.schema.json': 'ef5e4b198b3b150682e0915f3f5357cb634c11be5adaa96988aeb37b77040aec',
  'contracts/communications/v1/golden/codec.json': 'b27c8fcb41fbd20ccd0e52bc1fd5e4e5d1161c5aeda354ebd95192ac68807e65',
  'contracts/communications/v1/golden/commands.json': '1bbcb949346ef82a5a30923271ccf7072ddc5a0e7b0c273f37af220e507f1a80',
  'contracts/communications/v1/manifest.json': '4762203741d169461130796dab86e39adb5effa1e6c52bf77e837ba41a5e1492',
  'contracts/communications/v1/strict-json-value.schema.json': '980317764c7d686b46f438a73184971cfe5fae41f34d332817a45c921324ca62',
  'docs/superpowers/plans/2026-11-02-gen-company-communications.md': '0831d2f2e52cd9f9c832e895e3b739322ee07eda4c6074ea5deda020faedea09',
  'src/company/comms/owner_history_ingress.py': '1dad8036cb86cd7fa05e6a889cab1e617030f43fbb2d01165f83c2f4690ca4a3',
  'tools/owner_history_ingress_fixture.py': '5a11b051a73f610948f3204a1e552b6237951a2ee2d5d5b89b4b6f11e17e89d8',
  'src/company/comms/contracts.py': '0194771eba78d435e3ddd1962dda40cdf0f62f1a22cb0dd185eba9e220b54891',
  'src/company/migrations/007_communications_records.sql': '74bbc84918e8b058f1f741361c1a5bb019a126b16d3da68a94617540c1961ded',
  'src/company/migrations/008_owner_note_journal.sql': '502babd731dfaa32584dc75f28b26b04ec0119a3f2d3feb171ac1344c096b35e',
  'docs/evidence/owner-discussion-thread-2026-11-03/checkpoint.json': '4b91ca161bf8d30ae9bfd4a0e95040c21b0648cdb7eec313a917d49c82cd7295',
  'tests/communications/fixtures/README.md': 'eaf160430f5c2744f40a253dedd232548adf3eababad88192b2dd9bc2d6932d7',
  'tests/communications/fixtures/owner-history-test.cert.pem': 'e90aac4fc38cfc57051c4c3ebdcdde8b12b1fa23bc0af13669c15b552252ce99',
  'tests/communications/fixtures/owner-history-test.key.pem': '9cfb337da6d23f82182485ce8b19acdac769b2883e949a0f6c70fc8fe0d499d4',
};
const consumerFrozenPins = {
  'packages/company-contracts/communications/json.ts': 'b7747da19b17c2ac5412e5caed242904268b552ac63a7d810e573e6eaae2021d',
  'packages/company-contracts/communications/reads.ts': '1418c47247c83c7a346d48ad863f2fb791cad36da81660ea2e95e73ddfd7de24',
  'packages/company-contracts/communications/owner-discussion.ts': '868d34e980de1bed9cfbc4b561914042dc8b0b19b023de88029c7dcf081c7db9',
  'packages/company-contracts/communications/reads-candidate.1/records.schema.json': '98fd331df7aa5262eefbf7bf73a3396d7ffd3b40e13f186e4d9aaa3a735958af',
  'packages/company-contracts/communications/owner-discussion-candidate.1/discussion.schema.json': '4a6b6fdd8cda6d2f3e8c13a5bd5cb17b9996f83b91dd40925741e990f2bc7a8a',
  'packages/company-contracts/communications/owner-discussion-thread-candidate.1/thread.schema.json': '442ed5428659ce3336639efd89d651bea54bb4db03bec1b0ca285700c8a173b4',
};

async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_accept, reject) => {
      timer = setTimeout(() => reject(new Error('Owned thread fixture deadline exceeded.')), Math.max(1, milliseconds));
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
  save(name, JSON.stringify({checkpoint, observedHead, candidateSources: 13, frozenSources: 33,
    committed, working, consumerFrozen, scope: 'enumerated source custody only; not complete dependency/configuration custody'}, null, 2) + '\n');
  for (const [path, expected] of Object.entries(sourcePins)) {
    expect(committed[path], `committed source ${path}`).toBe(expected);
    expect(working[path], `working source ${path}`).toBe(expected);
  }
  for (const [path, expected] of Object.entries(consumerFrozenPins)) expect(consumerFrozen[path], `consumer frozen source ${path}`).toBe(expected);
}

function startFixture(root: string, env: NodeJS.ProcessEnv, selected: Case, save: Save) {
  const python = join(root, '.venv/Scripts/python.exe'), script = join(root, 'tools/owner_discussion_thread_fixture.py');
  if (!existsSync(python) || !existsSync(script)) throw new Error('Requires existing locked interpreter and pinned fixture.');
  const args = ['-I', '-B', '-u', script, '--case', selected, '--seconds', '30'];
  const startedAt = new Date().toISOString(), deadline = performance.now() + 25000;
  const child = spawn(python, args, {cwd: root, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
  child.stdin.on('error', () => {});
  const stdout: Buffer[] = [], stderr: Buffer[] = [], lines: Buffer[] = [];
  let totalBytes = 0, stdoutBytes = 0, stderrBytes = 0, exceeded = false, forced = false;
  let fragment = Buffer.alloc(0), failure: Error | undefined;
  let waiting: {resolve: (line: Buffer) => void; reject: (error: Error) => void} | undefined;
  const fail = (error: Error) => {failure ??= error; waiting?.reject(error);};
  child.once('error', () => fail(new Error('Owned thread fixture failed to start.')));
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
  async function control(operation: 'append' | 'revoke-principal' | 'revoke') {
    if (performance.now() >= deadline) throw new Error('Fixture total deadline exceeded before control.');
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
        throw new Error('Owned thread fixture required forced termination.');
      }
      if (child.pid !== undefined) {
        try {process.kill(child.pid, 0); pidRemains = true;} catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
          pidRemains = false;
        }
      }
      const raw = await readLine(100); save('stopped.json', raw);
      const count = {regular: 4, empty: 0, byte: 12}[selected];
      expect(decodeBoundedJson(raw, 32768)).toEqual({event: 'stopped', fixture_only: true,
        alpha_messages: count, alpha_receipts: count, alpha_acceptances: count,
        expected_alpha_commands: true, no_duplicate_records: true, beta_rows_unchanged: true,
        historical_revisions_unchanged: true, read_only_observations: true, expected_controls: true,
        temporary_store_removed: true, control_thread_stopped: true,
        controls: selected === 'regular' ? ['append', 'revoke-principal', 'revoke', 'stop'] : ['stop'],
      });
      expect(result).toEqual({code: 0, signal: null}); expect(pidRemains).toBe(false); expect(stderrBytes).toBe(0);
      if (failure || exceeded) throw failure ?? new Error('Fixture output bound exceeded.');
      expect(lines).toHaveLength(0); expect(fragment.byteLength).toBe(0);
    } finally {
      save('fixture.stdout.raw', Buffer.concat(stdout)); save('fixture.stderr.raw', Buffer.concat(stderr));
      save('process.json', JSON.stringify({checkpoint, case: selected, python, script, args, pid: child.pid ?? null,
        startedAt, closedAt: new Date().toISOString(), environmentKeys: Object.keys(env),
        code: result?.code ?? child.exitCode, signal: result?.signal ?? child.signalCode,
        stdoutBytes, stderrBytes, rawOutputCap: maximumMetadataBytes, outputExceeded: exceeded,
        forcedTermination: forced, pidRemains, processReaped: result !== undefined,
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
    const abort = () => finish(new Error('Thread HTTPS total deadline exceeded.'));
    const pending = request({hostname: '127.0.0.1', port: url.port, path, method,
      ca, rejectUnauthorized: true, minVersion: 'TLSv1.2', agent: false, maxHeaderSize: 16384, headers}, response => {
      const socket = response.socket as TLSSocket, protocol = socket.getProtocol(), authorized = socket.authorized;
      response.on('data', (chunk: Buffer) => {
        if (finished) return;
        chunks.push(Buffer.from(chunk.subarray(0, Math.max(0, maximumResponseBytes - bytes)))); bytes += chunk.length;
        if (bytes > maximumResponseBytes) {save(`${name}.response.bin`, Buffer.concat(chunks)); finish(new Error('Response exceeded 262144 bytes.'));}
      });
      response.once('error', () => finish(new Error('Thread response stream failed.')));
      response.once('aborted', () => finish(new Error('Thread response stream aborted.')));
      response.once('end', () => {
        if (finished) return;
        const raw = Buffer.concat(chunks), status = response.statusCode ?? 0;
        save(`${name}.response.bin`, raw);
        save(`${name}.exchange.json`, JSON.stringify({method, path, requestBodySHA256: options.body ? hash(options.body) : null,
          requestExtraHeaders: options.headers ?? {}, status, rawBytes: raw.byteLength, sha256: hash(raw),
          headers: response.rawHeaders, tlsProtocol: protocol, tlsAuthorized: authorized,
        }, null, 2) + '\n');
        if (!response.complete || response.headers['content-type'] !== 'application/json; charset=utf-8' ||
          response.headers['content-encoding'] !== undefined || response.headers['content-length'] !== String(raw.length) ||
          response.headers['cache-control'] !== 'no-store' || !authorized || !['TLSv1.2', 'TLSv1.3'].includes(protocol ?? '')) {
          finish(new Error('Thread response headers/TLS do not match the fixed ingress.')); return;
        }
        finish(undefined, {status, raw});
      });
    });
    const timer = setTimeout(abort, 3000);
    pending.once('error', () => finish(new Error('Thread HTTPS transport failed.')));
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
function assertPage(page: Thread, raw: Uint8Array, limit: number, sequences: number[], selected: Case, truncation: string) {
  expect(raw.byteLength).toBeLessThanOrEqual(maximumResponseBytes); expect(Buffer.from(canonicalBytes(page))).toEqual(Buffer.from(raw));
  expect(page).toMatchObject({schema_version: 1, projection_type: 'owner_discussion_thread', company_id: 'leo-company', scope: {kind: 'project', id: 'alpha'},
    requested_limit: limit, order: 'conversation_sequence_descending', observed_at_utc_epoch_ms: 1793664000000,
    limits: {max_items: 50, max_response_utf8_bytes: maximumResponseBytes},
    coverage: {status: 'partial', truncation, total_count: null}, has_more: null, next_cursor: null,
    continuation: {status: 'unavailable', reason: 'cursor_protocol_unimplemented'},
    snapshot: {status: 'unavailable', reason: 'snapshot_protocol_unimplemented'},
    observation: {source: 'stored_record', evidence_scope: 'stored_record', live_verified: false}});
  expect(page.items.map(item => item.message.conversation_sequence)).toEqual(sequences);
  expect(new Set(page.items.map(item => item.message.id)).size).toBe(sequences.length);
  for (const [index, item] of page.items.entries()) {
    assertItem(item, sequences[index], selected); expect(item.conversation.id).toBe(page.room_head?.id);
  }
  if (!sequences.length) expect(page.room_head).toBeNull();
  else {expect(page.room_head).not.toBeNull(); assertDigest(page.room_head!);
    expect(page.room_head!.revision).toBe(sequences[0]); expect(page.room_head).toEqual(page.items[0].conversation);}
  assertDigest(page);
}

for (const selected of ['regular', 'empty', 'byte'] as const) {
  it.skipIf(!fixtureRoot)(`discovers ${selected} owner discussion thread over actual disposable verified HTTPS`, async () => {
    const root = realpathSync.native(resolve(fixtureRoot!)), env = environment();
    const evidenceRoot = resolve(import.meta.dirname, '../../.harness-company-evidence');
    mkdirSync(evidenceRoot, {recursive: true});
    const evidence = mkdtempSync(join(evidenceRoot, `thread-https-${selected}-`));
    const saved: Record<string, {bytes: number; sha256: string}> = {};
    const save: Save = (name, raw) => {const bytes = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw;
      writeFileSync(join(evidence, name), bytes, {flag: 'wx'}); saved[name] = {bytes: bytes.byteLength, sha256: hash(bytes)};};
    let failure: unknown, fixture: ReturnType<typeof startFixture> | undefined;
    const total = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      verifyPins(root, env, save, 'source-before.json');
      fixture = startFixture(root, env, selected, save);
      timer = setTimeout(() => total.abort(), Math.max(1, fixture.deadline - performance.now()));
      const readyRaw = await fixture.readLine(5000); save('ready.json', readyRaw);
      const ready = decodeBoundedJson(readyRaw, 32768) as unknown as Ready;
      const certificate = join(root, 'tests/communications/fixtures/owner-history-test.cert.pem');
      expect(ready).toEqual({event: 'ready', fixture_only: true, base_url: ready.base_url, bearer_token: publicToken,
        other_owner_token: otherToken, ca_certificate: certificate, company_id: 'leo-company', project_id: 'alpha', case: selected, actual_live_employees: 0});
      expect(ready.base_url).toMatch(/^https:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
      const ca = readFileSync(certificate); expect(hash(ca)).toBe(sourcePins['tests/communications/fixtures/owner-history-test.cert.pem']);
      const expected: ReadContext = {company_id: 'leo-company', scope: {kind: 'project', id: 'alpha'}};
      const beta: ReadContext = {company_id: 'leo-company', scope: {kind: 'project', id: 'beta'}};
      const client = (token: string, trust: Buffer | string = ca) => new OwnerDiscussionThreadClient({origin: ready.base_url, role: 'owner', credential: () => token, ca: trust, timeoutMs: 3000});
      const owner = client(publicToken), other = client(otherToken), wrong = client('PUBLIC-wrong-thread-fixture-token');
      const exchanges: {name: string; status: number; rawBytes: number; sha256: string}[] = [];
      const wire = async (name: string, path = route, token = publicToken, options?: RawOptions) => {
        const result = await capture(ready.base_url, ca, path, token, name, save, total.signal, options);
        exchanges.push({name, status: result.status, rawBytes: result.raw.byteLength, sha256: hash(result.raw)}); return result;
      };
      const denied = async (name: string, status: number, code: string, path = route, token = publicToken, options?: RawOptions) => {
        const result = await wire(name, path, token, options); expect(result.status).toBe(status);
        expect(decodeBoundedJson(result.raw, 262144)).toEqual({schema_version: 1, error: {code}});
      };
      const pages: {limit: number; page: Thread; raw: Buffer}[] = [];
      const sequences = selected === 'regular' ? [3, 2, 1] : selected === 'empty' ? [] : [12, 11, 10, 9, 8, 7, 6, 5, 4];
      for (const limit of [undefined, 1, 50]) {
        const retainedLimit = limit ?? 20;
        const page = await owner.readThread(expected, limit, total.signal);
        const result = await wire(`limit-${retainedLimit}`, route + (limit === undefined ? '' : `?limit=${limit}`));
        expect(result.status).toBe(200);
        const validated = await validateOwnerDiscussionThread(result.raw, expected, retainedLimit);
        expect(page).toEqual(validated);
        assertPage(page, result.raw, retainedLimit, limit === 1 ? sequences.slice(0, 1) : sequences, selected,
          selected === 'empty' ? 'none_observed' : limit === 1 ? 'item_limit' : selected === 'byte' ? 'byte_limit' : 'none_observed');
        save(`limit-${retainedLimit}.client.bin`, canonicalBytes(page)); pages.push({limit: retainedLimit, page, raw: result.raw});
      }
      expect(pages[2].page.items).toEqual(pages[0].page.items);
      expect(pages[1].page.items).toEqual(pages[0].page.items.slice(0, 1));
      if (selected === 'byte') {
        expect(pages[0].raw.byteLength).toBe(252815); expect(pages[2].raw.byteLength).toBe(252815);
        expect(pages[0].raw.includes(Buffer.from('\\u0001'))).toBe(true); expect(pages[0].raw.includes(Buffer.from('\u00e9', 'utf8'))).toBe(true);
        // The producer-reviewed sizing recipe preserves all fixed-width IDs and
        // digests, changing only decimal-width sequence fields. This candidate is
        // sizing data only, never a validated record or a fabricated complete page.
        const nextSequence = 3;
        const next = structuredClone(pages[0].page.items.at(-1)!);
        const sizing = next as unknown as {conversation: {revision: number}; message: {conversation_sequence: number; conversation_ref: {revision: number}}; receipt: {conversation_ref: {revision: number}; command_id: string}};
        sizing.conversation.revision = nextSequence; sizing.message.conversation_sequence = nextSequence;
        sizing.message.conversation_ref.revision = nextSequence; sizing.receipt.conversation_ref.revision = nextSequence;
        sizing.receipt.command_id = `20000000-0000-4000-8000-${String(nextSequence).padStart(12, '0')}`;
        const nextPrefixBytes = canonicalBytes({...pages[0].page, items: [...pages[0].page.items, next]}).byteLength;
        expect(nextPrefixBytes).toBeGreaterThan(maximumResponseBytes);
        save('byte-sizing.json', JSON.stringify({returnedWholeItems: 9, rawBytes: 252815, nextSequence,
          nextWholePrefixBytes: nextPrefixBytes, maximumResponseBytes, sizingOnly: true, fabricatedCompletePage: false}, null, 2) + '\n');
      }
      await expect(wrong.readThread(expected, undefined, total.signal)).rejects.toMatchObject({code: 'AUTHENTICATION_REQUIRED'});
      await denied('wrong-token', 401, 'AUTHENTICATION_REQUIRED', route, 'PUBLIC-wrong-thread-fixture-token');
      await expect(owner.readThread(beta, undefined, total.signal)).rejects.toMatchObject({code: 'SCOPE_DENIED'});
      await denied('beta', 403, 'SCOPE_DENIED', route.replace('/alpha/', '/beta/'));
      if (selected !== 'empty') {
        await expect(other.readThread(expected, undefined, total.signal)).rejects.toMatchObject({code: 'SCOPE_DENIED'});
        await denied('other-owner', 403, 'SCOPE_DENIED', route, otherToken);
      }
      await expect(client(publicToken, rootCertificates[0]).readThread(expected, undefined, total.signal)).rejects.toMatchObject({code: 'TRANSPORT'});
      for (const [index, suffix] of ['?limit=0', '?limit=51', '?limit=01', '?limit=-0', '?limit=1.0', '?limit=1e0', '?limit=true', '?limit=1&limit=2', '?cursor=x', '?limit=%31', '?', '?other=1'].entries()) {
        await denied(`invalid-query-${index}`, 400, 'INVALID_REQUEST', route + suffix);
      }
      for (const [name, headers] of [
        ['origin', {Origin: ''}], ['transfer-encoding', {'Transfer-Encoding': ''}],
        ['content-encoding', {'Content-Encoding': ''}], ['content-type', {'Content-Type': 'application/json'}],
      ] as const) await denied(`framing-${name}`, 400, 'INVALID_REQUEST', route, publicToken, {headers});
      await denied('framing-body', 400, 'INVALID_REQUEST', route, publicToken, {body: Buffer.from('x')});
      await denied('post', 404, 'NOT_FOUND', route, publicToken, {method: 'POST'});
      await denied('unknown-path', 404, 'NOT_FOUND', route + '/unknown');
      let afterAppend: Thread | undefined;
      if (selected === 'regular') {
        await fixture.control('append');
        afterAppend = await owner.readThread(expected, undefined, total.signal);
        const result = await wire('after-append'); expect(result.status).toBe(200);
        expect(afterAppend).toEqual(await validateOwnerDiscussionThread(result.raw, expected, 20));
        assertPage(afterAppend, result.raw, 20, [4, 3, 2, 1], selected, 'none_observed');
        expect(afterAppend.room_head!.revision).toBe(4); expect(afterAppend.room_head).not.toEqual(pages[0].page.room_head);
        const beforeWrappers = pages[0].page.items.map(item => Buffer.from(canonicalBytes(item)));
        const afterWrappers = afterAppend.items.slice(1).map(item => Buffer.from(canonicalBytes(item)));
        expect(afterWrappers).toEqual(beforeWrappers);
        for (const [index, raw] of beforeWrappers.entries()) save(`historical-${3 - index}.bin`, raw);
        await fixture.control('revoke-principal');
        await expect(owner.readThread(expected, undefined, total.signal)).rejects.toMatchObject({code: 'AUTHENTICATION_REQUIRED'});
        await denied('principal-revoked-main', 401, 'AUTHENTICATION_REQUIRED');
        await expect(other.readThread(expected, undefined, total.signal)).rejects.toMatchObject({code: 'SCOPE_DENIED'});
        await denied('principal-revoked-other', 403, 'SCOPE_DENIED', route, otherToken);
        await fixture.control('revoke');
        for (const [name, current, token] of [['main', owner, publicToken], ['other', other, otherToken]] as const) {
          await expect(current.readThread(expected, undefined, total.signal)).rejects.toMatchObject({code: 'AUTHENTICATION_REQUIRED'});
          await denied(`registry-revoked-${name}`, 401, 'AUTHENTICATION_REQUIRED', route, token);
        }
      }
      expect(performance.now()).toBeLessThan(fixture.deadline);
      save('consumer.json', JSON.stringify({checkpoint, case: selected, proof: 'actual_disposable_https',
        company: expected.company_id, project: expected.scope.id, independentlyRetainedLimits: [20, 1, 50],
        pages: pages.map(({limit, page, raw}) => ({limit, rawBytes: raw.byteLength, rawSHA256: hash(raw),
          messageSequences: page.items.map(item => item.message.conversation_sequence), currentHeadRevision: page.room_head?.revision ?? null,
          historicalConversationRevisions: page.items.map(item => item.conversation.revision), truncation: page.coverage.truncation,
          records: page.items.map(item => ({messageId: item.message.id, sequence: item.message.conversation_sequence,
            messageDigest: item.message.digest, historicalConversationRef: item.message.conversation_ref, wrapperDigest: item.digest})), pageDigest: page.digest})),
        afterAppendHeadRevision: afterAppend?.room_head?.revision ?? null,
        historicalWrappersByteIdentical: selected === 'regular' ? true : null,
        wrongCARejected: true, exchanges, noOriginalCommandOrReceiptQueryInputs: true,
        reconstructedReceiptProof: 'response internal consistency only; not independently retained append provenance',
        scope: 'public synthetic disposable fixture; enumerated source custody only',
        liveVerified: false, companyAccepted: false, nativeAccepted: false, remoteOwnerSessionAccepted: false,
      }, null, 2) + '\n');
    } catch (error) {failure = error;}
    finally {
      clearTimeout(timer); total.abort();
      if (fixture) try {await fixture.stop();} catch (error) {failure = failure ? new AggregateError([failure, error], 'Consumer and fixture cleanup failed.') : error;}
      try {verifyPins(root, env, save, 'source-after.json');}
      catch (error) {failure = failure ? new AggregateError([failure, error], 'Consumer or source custody failed.') : error;}
      save('result.json', JSON.stringify({checkpoint, case: selected, status: failure ? 'failed' : 'passed',
        failure: failure instanceof Error ? {name: failure.name, message: failure.message} : failure ? {name: 'UnknownFailure'} : null,
        files: saved}, null, 2) + '\n');
      console.info(`Owner discussion thread HTTPS consumer evidence: ${evidence}`);
    }
    if (failure) throw failure;
  }, 45000);
}
