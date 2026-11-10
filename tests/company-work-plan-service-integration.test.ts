import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {request as httpRequest} from 'node:http';
import {dirname, isAbsolute, relative, resolve} from 'node:path';
import {expect, it} from 'vitest';
import {CompanyClient} from '../packages/company-client/index.ts';
import {WorkPlanClient} from '../packages/company-client/work-plan.ts';
import {validateWorkPlanResponse, workPlanCanonicalBytes, workPlanRef, type WorkPlanAuthorizeRequest, type WorkPlanBody, type WorkPlanProposeRequest, type WorkPlanReadRequest} from '../packages/company-contracts/work-plan.ts';

const rootInput = process.env.GEN_WORK_PLAN_SERVICE_ROOT;
const producerCheckpoint = '9eaf24ed2f20a8cabf76d6f6e2d07a0a18923841';
const receiptPath = 'docs/evidence/owner-work-plans-2026-11-03/receipt.json';
const receiptSHA256 = '4735ec3cdd241f7ba28019f5b5d4c1ef38eea2ff891d913a8cc25dbba7ca3a88';
const companyId = 'leo-company', projectId = 'alpha';
const instructionText = 'Prepare one bounded pilot change with frontend, backend and manager review.';
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

async function deadline<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {return await Promise.race([promise, new Promise<never>((_resolve, reject) => {timer = setTimeout(() => reject(new Error(`Disposable work-plan ${label} timed out`)), milliseconds);})]);}
  finally {clearTimeout(timer);}
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
  return value;
}
interface Ready {
  event: 'ready'; fixture_only: true; base_url: string; bearer_token: string; rotated_owner_token: string;
  non_authorizing_owner_token: string; other_owner_token: string; company_id: string; project_id: string; forbidden_project_id: string;
  instruction: string; instruction_id: string; legacy_instruction_receipt: {id: string; instruction: string; project_id: string};
  legacy_message_id: string; proposed_plan: WorkPlanBody; expiry_epoch_seconds: number; actual_live_employees: 0;
}
function sourceInventory(root: string) {
  const receiptBytes = readFileSync(resolve(root, receiptPath));
  expect(hash(receiptBytes)).toBe(receiptSHA256);
  const receipt = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(receiptBytes)) as {source_files: Record<string, {sha256: string; bytes: number}>};
  expect(Object.keys(receipt.source_files)).toHaveLength(19);
  return Object.fromEntries(Object.entries(receipt.source_files).map(([path, expected]) => {
    expect(path).not.toMatch(/(?:^|\/)\.\.(?:\/|$)|^[/\\]|:/);
    const bytes = readFileSync(resolve(root, path));
    expect(hash(bytes), path).toBe(expected.sha256); expect(bytes.byteLength, path).toBe(expected.bytes);
    return [path, {sha256: hash(bytes), bytes: bytes.byteLength}];
  }));
}

it.skipIf(!rootInput)('uses the three fixed clients against actual disposable WorkOrder storage and exact receipt recovery', async () => {
  const root = resolve(rootInput!), before = sourceInventory(root);
  const evidenceRoot = resolve('.harness-company-evidence/work-plan-20261103');
  const output = resolve(process.env.GEN_WORK_PLAN_EVIDENCE_DIR ?? `${evidenceRoot}/actual-${Date.now()}`);
  const evidenceRelative = relative(evidenceRoot, output);
  expect(isAbsolute(evidenceRelative) || evidenceRelative.startsWith('..') || !evidenceRelative.startsWith('actual-')).toBe(false);
  await mkdir(dirname(output), {recursive: true});
  await mkdir(output, {recursive: false});
  const python = resolve(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  expect(existsSync(python)).toBe(true);
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[key] !== undefined) environment[key] = process.env[key];
  const child = spawn(python, ['-I', '-B', resolve(root, 'tools/owner_work_plan_fixture.py'), '--seconds', '45'], {cwd: root, env: environment, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
  child.stdin.on('error', () => {});
  const stdout: Buffer[] = [], stderr: Buffer[] = [], transcript: unknown[] = [];
  let firstLine!: (value: Buffer) => void, firstError!: (error: Error) => void;
  const readyLine = new Promise<Buffer>((accept, reject) => {firstLine = accept; firstError = reject;});
  let waiting = Buffer.alloc(0), firstEmitted = false, totalBytes = 0, forced = false, launchError: string | null = null;
  child.stdout.on('data', (chunk: Buffer) => {
    stdout.push(Buffer.from(chunk)); totalBytes += chunk.length;
    if (totalBytes > 131072) {forced = true; child.kill(); firstError(new Error('Disposable fixture exceeded its output bound')); return;}
    if (!firstEmitted) {waiting = Buffer.concat([waiting, chunk]); const end = waiting.indexOf(10); if (end !== -1) {firstEmitted = true; firstLine(waiting.subarray(0, end));}}
  });
  child.stderr.on('data', (chunk: Buffer) => {stderr.push(Buffer.from(chunk)); totalBytes += chunk.length; if (totalBytes > 131072) {forced = true; child.kill();}});
  child.once('error', () => {launchError = 'fixture_launch_failed'; firstError(new Error('Disposable fixture could not launch'));});
  const closed = new Promise<{code: number | null; signal: NodeJS.Signals | null}>(accept => child.once('close', (code, signal) => {if (!firstEmitted) firstError(new Error('Disposable fixture closed before ready')); accept({code, signal});}));
  let ready: Ready | undefined, stopped: Record<string, unknown> | undefined, failure: unknown, exit: Awaited<typeof closed> | undefined, pidAbsent = false;
  try {
    const rawReady = await deadline(readyLine, 10000, 'ready');
    ready = freeze(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(rawReady))) as Ready;
    expect(ready).toMatchObject({event: 'ready', fixture_only: true, company_id: companyId, project_id: projectId, forbidden_project_id: 'beta', actual_live_employees: 0, instruction: instructionText, expiry_epoch_seconds: 1793664900});
    expect(ready.base_url).toMatch(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
    expect(ready.instruction_id).toBe(ready.legacy_instruction_receipt.id);
    expect(ready.legacy_instruction_receipt).toMatchObject({project_id: projectId, instruction: instructionText});
    const target = new URL(ready.base_url);
    const request = freeze(structuredClone({project_id: projectId, message_id: 'gen-fixture-propose-1', instruction_id: ready.instruction_id, expected_head_ref: null, plan: ready.proposed_plan})) satisfies WorkPlanProposeRequest;
    const client = (token: string) => new WorkPlanClient({origin: ready!.base_url, role: 'owner', credential: () => token, timeoutMs: 3000});
    const owner = client(ready.bearer_token);
    async function rawPost(path: string, payload: unknown, options: {token?: string; discard?: boolean; bytes?: Uint8Array} = {}) {
      const encoded = options.bytes ?? workPlanCanonicalBytes(payload), token = options.token ?? ready!.bearer_token;
      expect(encoded.byteLength).toBeLessThanOrEqual(32768);
      return new Promise<{status: number; bytes: Buffer | null; value?: unknown}>((accept, reject) => {
        const call = httpRequest({hostname: '127.0.0.1', port: target.port, method: 'POST', path, agent: false, headers: {Host: target.host, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': String(encoded.byteLength)}}, response => {
          const status = response.statusCode ?? 0;
          if (options.discard) {
            transcript.push({kind: 'wire', path, request: payload, status, body: 'deliberately_discarded_before_validation'});
            response.destroy(); call.destroy(); accept({status, bytes: null}); return;
          }
          const chunks: Buffer[] = []; let count = 0;
          response.on('data', (chunk: Buffer) => {count += chunk.length; if (count > 262144) {response.destroy(); call.destroy(new Error('Response exceeded whole-body bound'));} else chunks.push(Buffer.from(chunk));});
          response.once('error', reject);
          response.once('end', () => {
            try {
              const bytes = Buffer.concat(chunks);
              expect(Number(response.headers['content-length'])).toBe(bytes.length); expect(response.headers['cache-control']).toBe('no-store');
              const value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
              transcript.push({kind: 'wire', path, request: payload, status, response_utf8: bytes.toString('utf8'), response_bytes: bytes.length, response_sha256: hash(bytes)});
              accept({status, bytes, value});
            } catch (error) {reject(error);}
          });
        });
        call.once('error', reject); call.setTimeout(4000, () => call.destroy(new Error('Fixed request deadline exceeded'))); call.end(encoded);
      });
    }
    const proposed = await owner.propose(request);
    transcript.push({kind: 'validated_client', operation: 'propose', request, response: proposed});
    expect(proposed.plan.plan).toEqual(request.plan); expect(proposed.plan.basis.instruction.record).toEqual(ready.legacy_instruction_receipt);
    const reference = freeze(workPlanRef(proposed.plan));
    const readRequest = freeze({project_id: projectId, instruction_id: ready.instruction_id, plan_ref: reference}) satisfies WorkPlanReadRequest;
    const rawReplay = await rawPost('/v1/owner/work-plan/propose', request);
    expect(rawReplay.status).toBe(200); expect(await validateWorkPlanResponse('propose', rawReplay.bytes!, request, companyId)).toEqual(proposed);
    const viewed = await owner.read(readRequest);
    transcript.push({kind: 'validated_client', operation: 'read', request: readRequest, response: viewed});
    expect(viewed.plan).toEqual(proposed.plan); expect(viewed.eligibility.can_authorize).toBe(true);
    const authorizationRequest = freeze({project_id: projectId, message_id: 'gen-fixture-authorize-1', plan_ref: reference, expires_at_epoch_seconds: ready.expiry_epoch_seconds}) satisfies WorkPlanAuthorizeRequest;
    await expect(client(ready.non_authorizing_owner_token).authorize(authorizationRequest)).rejects.toMatchObject({code: 'scope_denied', status: 403});
    try {await client(ready.other_owner_token).read(readRequest); throw new Error('Foreign owner unexpectedly read the plan');}
    catch (error) {expect([403, 404]).toContain((error as {status?: number}).status);}
    await expect(client('PUBLIC-wrong-fixture-token').read(readRequest)).rejects.toMatchObject({code: 'authentication_required', status: 401});
    const foreign = freeze({...readRequest, project_id: 'beta', plan_ref: {...reference, project_id: 'beta'}});
    await expect(owner.read(foreign)).rejects.toMatchObject({code: 'scope_denied', status: 403});
    const strictUTF8 = await rawPost('/v1/owner/work-plan/read', readRequest, {bytes: Buffer.from('\ufeff' + JSON.stringify(readRequest), 'utf16le')});
    expect(strictUTF8.status).toBe(400);
    const lost = await rawPost('/v1/owner/work-plan/authorize', authorizationRequest, {discard: true});
    expect(lost.status).toBe(200); expect(lost.bytes).toBeNull();
    const recovered = await owner.read(readRequest);
    transcript.push({kind: 'validated_client', operation: 'read_after_discard', request: readRequest, response: recovered});
    expect(recovered.authorization).not.toBeNull();
    const authorized = await validateWorkPlanResponse('authorize', workPlanCanonicalBytes(recovered.authorization), authorizationRequest, companyId);
    expect(authorized.authorization.request).toEqual(authorizationRequest);
    expect(authorized.receipt).toMatchObject({work_order_stored: true, task_materialization: false, dispatch_authorized: false, live_ready: false});
    expect(recovered.eligibility.authorization_current).toBe(true);
    const rawRecovered = await rawPost('/v1/owner/work-plan/read', readRequest);
    expect(await validateWorkPlanResponse('read', rawRecovered.bytes!, readRequest, companyId)).toEqual(recovered);
    const rotated = await client(ready.rotated_owner_token).authorize(authorizationRequest);
    transcript.push({kind: 'validated_client', operation: 'rotated_authorize_replay', request: authorizationRequest, response: rotated});
    expect(rotated).toEqual(authorized);
    await expect(owner.authorize({...authorizationRequest, expires_at_epoch_seconds: authorizationRequest.expires_at_epoch_seconds + 1})).rejects.toMatchObject({code: 'command_conflict', status: 409});
    const legacy = new CompanyClient({origin: ready.base_url, role: 'owner', credential: () => ready!.bearer_token, timeoutMs: 3000});
    const blockedStart = await legacy.start({project_id: projectId, work_order_id: authorized.authorization.work_order.id, message_id: 'gen-fixture-blocked-start'});
    expect(blockedStart).toMatchObject({status: 'capability_missing', dispatch_authorized: false, live_ready: false});
    transcript.push({kind: 'validated_client', operation: 'explicit_blocked_start_assertion', response: blockedStart});
    const revisedRequest = freeze({...structuredClone(request), message_id: 'gen-fixture-propose-2', expected_head_ref: reference, plan: {...structuredClone(request.plan), summary: 'Changed owner-reviewed scope'}}) satisfies WorkPlanProposeRequest;
    const revised = await owner.propose(revisedRequest);
    expect(revised.plan.revision).toBe(2);
    const historical = await owner.read(readRequest);
    transcript.push({kind: 'validated_client', operation: 'historical_read', request: readRequest, response: historical});
    expect(historical.authorization).toEqual(authorized); expect(historical.current_head_ref).toEqual(workPlanRef(revised.plan));
    expect(historical.eligibility.authorization_current).toBe(false); expect(historical.eligibility.is_current).toBe(false);
    expect(await owner.authorize(authorizationRequest)).toEqual(authorized);
    await expect(owner.authorize({...authorizationRequest, message_id: 'gen-fixture-stale-authorize'})).rejects.toMatchObject({code: 'stale_plan', status: 409});
  } catch (error) {failure = error;}
  finally {
    if (child.exitCode === null && child.signalCode === null) child.stdin.end('stop\n');
    try {exit = await deadline(closed, 8000, 'normal stop');}
    catch (error) {forced = true; child.kill('SIGKILL'); exit = await deadline(closed, 3000, 'forced cleanup'); failure ??= error;}
    // Persist native producer exit before fallible decoding/metadata, separately
    // from the outer native runner and collector exits captured by the helper.
    await writeFile(resolve(output, 'producer-exit.txt'), JSON.stringify(exit.code) + '\n', {encoding: 'utf8', flag: 'wx', flush: true});
    await writeFile(resolve(output, 'producer.stdout.bin'), Buffer.concat(stdout), {flag: 'wx'});
    await writeFile(resolve(output, 'producer.stderr.bin'), Buffer.concat(stderr), {flag: 'wx'});
    try {
      const lines = new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(stdout)).trim().split(/\r?\n/).map(line => JSON.parse(line));
      expect(lines).toHaveLength(2); stopped = lines[1]; expect(stopped?.event).toBe('stopped');
      try {process.kill(child.pid!, 0);} catch (error) {pidAbsent = (error as NodeJS.ErrnoException).code === 'ESRCH';}
      expect(exit).toEqual({code: 0, signal: null}); expect(forced).toBe(false); expect(launchError).toBeNull(); expect(Buffer.concat(stderr)).toHaveLength(0); expect(pidAbsent).toBe(true);
      expect(stopped).toMatchObject({fixture_only: true, normal_stop: true, work_orders_stored: 1, no_operational_rows: {employees: true, tasks: true, attempts: true, reservations: true, outbox: true}, beta_unchanged: true, temporary_store_removed: true, control_thread_stopped: true});
    } catch (error) {failure ??= error;}
    const after = Object.fromEntries(Object.keys(before).map(path => {
      try {const bytes = readFileSync(resolve(root, path)); return [path, {sha256: hash(bytes), bytes: bytes.byteLength}];}
      catch {return [path, {error: 'source_read_unavailable'}];}
    }));
    try {expect(after).toEqual(before);} catch (error) {failure ??= error;}
    await writeFile(resolve(output, 'counterpart.json'), JSON.stringify({proof_scope: 'Local disposable synthetic authority; actual IPv4 loopback HTTP, not TLS, live workers or full company acceptance', producer_checkpoint: producerCheckpoint, source_inventory_scope: '19 paths enumerated in pinned CONTROL receipt only; not whole Python/config/dependency custody', source_before: before, source_after: after, ready, transcript, stopped, producer_pid: child.pid, producer_exit: exit, pid_absent: pidAbsent, forced, failure: failure instanceof Error ? {name: failure.name, message: failure.message} : failure ? String(failure) : null}, null, 2) + '\n', {encoding: 'utf8', flag: 'wx'});
  }
  if (failure) throw failure;
}, 40000);
