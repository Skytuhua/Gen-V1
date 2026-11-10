import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {request as httpRequest} from 'node:http';
import {resolve} from 'node:path';
import {expect, it} from 'vitest';
import {CompanyClient} from '../packages/company-client/index.ts';
import {WorkPlanClient} from '../packages/company-client/work-plan.ts';
import {prepareWorkOrderTasksRequest, type WorkOrderTasksContext, type WorkOrderTasksRequest} from '../packages/company-contracts/work-order-tasks.ts';
import {workPlanRef, type WorkPlanBody, type WorkPlanProposeRequest, type WorkPlanAuthorizeRequest} from '../packages/company-contracts/work-plan.ts';

const rootInput = process.env.GEN_WORK_ORDER_TASKS_SERVICE_ROOT;
const producerCheckpoint = '20ea1aa0fa277d43c6904c2b35d761d5483820c5';
const receiptPath = 'docs/evidence/work-order-tasks-2026-11-04.json', receiptHash = '3f8e8db41b6b0876bf87719284c6dd5bb69948072a3bf4ded9c142ebef01ccef';
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function inventory(root: string) {
  const bytes = readFileSync(resolve(root, receiptPath)); expect(sha256(bytes)).toBe(receiptHash);
  const receipt = JSON.parse(bytes.toString('utf8')) as {source_files: Record<string, {sha256: string; bytes: number}>};
  return Object.fromEntries(Object.entries(receipt.source_files).map(([path, expected]) => {
    expect(path).not.toMatch(/(?:^|\/)\.\.(?:\/|$)|^[/\\]|:/);
    const raw = readFileSync(resolve(root, path)); expect(sha256(raw), path).toBe(expected.sha256); expect(raw.length).toBe(expected.bytes);
    return [path, {sha256: sha256(raw), bytes: raw.length}];
  }));
}
async function bounded<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {return await Promise.race([work, new Promise<never>((_resolve, reject) => {timer = setTimeout(() => reject(Error('Disposable fixture deadline exceeded')), milliseconds);})]);}
  finally {clearTimeout(timer);}
}
interface Ready {event: 'ready'; fixture_only: true; base_url: string; bearer_token: string; rotated_owner_token: string; read_only_token: string; other_owner_token: string; company_id: string; project_id: string; instruction_id: string; proposed_plan: WorkPlanBody; expiry_epoch_seconds: number; actual_live_employees: 0; synthetic_bindings: 3}

it.skipIf(!rootInput)('materializes the exact authorized plan and recovers a lost outcome by one explicit same-ID replay', async () => {
  const root = resolve(rootInput!), before = inventory(root);
  const output = resolve(process.env.GEN_WORK_ORDER_TASKS_EVIDENCE_DIR ?? `.harness-company-evidence/work-order-tasks-20261104/actual-${Date.now()}`);
  await mkdir(output, {recursive: false});
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[key] !== undefined) env[key] = process.env[key];
  const child = spawn(resolve(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python'), ['-I', '-B', 'tools/work_order_tasks_fixture.py', '--seconds', '45'], {cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
  child.stdin.on('error', () => {});
  const stdout: Buffer[] = [], stderr: Buffer[] = [], transcript: unknown[] = [];
  let waiting = Buffer.alloc(0), readySent = false, total = 0, forced = false;
  let acceptReady!: (raw: Buffer) => void, failReady!: (error: Error) => void;
  const firstLine = new Promise<Buffer>((accept, reject) => {acceptReady = accept; failReady = reject;});
  child.stdout.on('data', (chunk: Buffer) => {
    stdout.push(Buffer.from(chunk)); total += chunk.length;
    if (total > 131072) {forced = true; child.kill(); failReady(Error('Fixture output too large')); return;}
    if (!readySent) {waiting = Buffer.concat([waiting, chunk]); const end = waiting.indexOf(10); if (end >= 0) {readySent = true; acceptReady(waiting.subarray(0, end));}}
  });
  child.stderr.on('data', (chunk: Buffer) => {stderr.push(Buffer.from(chunk)); total += chunk.length; if (total > 131072) {forced = true; child.kill();}});
  child.once('error', () => failReady(Error('Fixture launch unavailable')));
  const closed = new Promise<{code: number | null; signal: NodeJS.Signals | null}>(accept => child.once('close', (code, signal) => {if (!readySent) failReady(Error('Fixture exited before ready')); accept({code, signal});}));
  let ready: Ready | undefined, stopped: unknown, exit: Awaited<typeof closed> | undefined, failure: unknown, pidAbsent = false;
  try {
    ready = JSON.parse(new TextDecoder('utf8', {fatal: true}).decode(await bounded(firstLine, 10000))) as Ready;
    expect(ready).toMatchObject({event: 'ready', fixture_only: true, company_id: 'leo-company', project_id: 'alpha', actual_live_employees: 0, synthetic_bindings: 3, expiry_epoch_seconds: 1793664900});
    expect(ready.base_url).toMatch(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
    const client = (token: string) => new WorkPlanClient({origin: ready!.base_url, role: 'owner', credential: () => token});
    const owner = client(ready.bearer_token);
    const proposalRequest = {project_id: 'alpha', message_id: 'gen-tasks-propose-1', instruction_id: ready.instruction_id, expected_head_ref: null, plan: structuredClone(ready.proposed_plan)} satisfies WorkPlanProposeRequest;
    const proposal = await owner.propose(proposalRequest); transcript.push({operation: 'propose', request: proposalRequest, response: proposal});
    expect(proposal.plan.owner_principal).toBe('fixture-owner');
    const authorizeRequest = {project_id: 'alpha', message_id: 'gen-tasks-authorize-1', plan_ref: workPlanRef(proposal.plan), expires_at_epoch_seconds: ready.expiry_epoch_seconds} satisfies WorkPlanAuthorizeRequest;
    const authorized = await owner.authorize(authorizeRequest); transcript.push({operation: 'authorize', request: authorizeRequest, response: authorized});
    const context = {companyId: 'leo-company', projectId: 'alpha', principalId: 'fixture-owner', proposal: {request: proposalRequest, response: proposal}, authorization: {request: authorizeRequest, response: authorized}} satisfies WorkOrderTasksContext;
    const input = {project_id: 'alpha', message_id: 'gen-tasks-materialize-1', plan_ref: workPlanRef(proposal.plan), work_order_id: authorized.authorization.work_order.id} satisfies WorkOrderTasksRequest;
    const captured = await prepareWorkOrderTasksRequest(input, context);
    const target = new URL(ready.base_url);
    const lostStatus = await new Promise<number>((accept, reject) => {
      const request = httpRequest({hostname: '127.0.0.1', port: target.port, method: 'POST', path: '/v1/owner/work-plan/materialize', agent: false, headers: {Host: target.host, Authorization: `Bearer ${ready!.bearer_token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(captured.body)}}, response => {const status = response.statusCode ?? 0; response.destroy(); request.destroy(); accept(status);});
      request.once('error', reject); request.setTimeout(3000, () => request.destroy(Error('Lost-reply request timed out'))); request.end(captured.body);
    });
    transcript.push({operation: 'materialize', request: captured.request, status: lostStatus, response: 'deliberately discarded before body validation'}); expect(lostStatus).toBe(200);
    const result = await owner.materialize(input, context); transcript.push({operation: 'explicit_same_id_replay', request: input, response: result});
    expect(result.tasks).toHaveLength(3); expect(result.receipt).toMatchObject({task_materialization: true, dispatch_authorized: false, live_ready: false});
    const rotated = await client(ready.rotated_owner_token).materialize(input, context); expect(rotated).toEqual(result); transcript.push({operation: 'rotated_principal_replay', response: rotated});
    for (const [label, token, code] of [['read_only', ready.read_only_token, 'scope_denied'], ['other_owner', ready.other_owner_token, 'scope_denied'], ['wrong_token', 'PUBLIC-wrong-token', 'authentication_required']] as const) {
      await expect(client(token).materialize(input, context)).rejects.toMatchObject({code}); transcript.push({operation: label, error: code});
    }
    await expect(owner.materialize({...input, message_id: 'gen-tasks-replacement-negative'}, context)).rejects.toMatchObject({code: 'command_conflict', status: 409});
    transcript.push({operation: 'replacement_negative', error: 'command_conflict'});
    const readRequest = {project_id: 'alpha', instruction_id: ready.instruction_id, plan_ref: input.plan_ref};
    const historical = await owner.read(readRequest); expect(historical.authorization).toEqual(authorized); expect(historical.authorization?.receipt.task_materialization).toBe(false);
    transcript.push({operation: 'historical_authorization_unchanged', request: readRequest, response: historical});
    const legacy = new CompanyClient({origin: ready.base_url, role: 'owner', credential: () => ready!.bearer_token});
    expect(await legacy.start({project_id: 'alpha', work_order_id: input.work_order_id, message_id: 'gen-tasks-legacy-start'})).toMatchObject({status: 'capability_missing', dispatch_authorized: false});
  } catch (error) {failure = error;}
  finally {
    child.stdin.end('stop\n');
    try {exit = await bounded(closed, 8000);} catch (error) {failure ??= error; forced = true; child.kill(); exit = await bounded(closed, 3000);}
    try {
      const lines = new TextDecoder('utf8', {fatal: true}).decode(Buffer.concat(stdout)).trim().split('\n'); stopped = JSON.parse(lines.at(-1)!);
      try {if (child.pid) process.kill(child.pid, 0);} catch (error) {pidAbsent = (error as NodeJS.ErrnoException).code === 'ESRCH';}
      expect(exit).toEqual({code: 0, signal: null}); expect(forced).toBe(false); expect(pidAbsent).toBe(true); expect(Buffer.concat(stderr)).toHaveLength(0);
      expect(stopped).toMatchObject({event: 'stopped', fixture_only: true, normal_stop: true, counts: {employees: 3, work_orders: 1, tasks: 3, attempts: 0, reservations: 0, outbox: 0}, beta_unchanged: true, only_alpha_tasks: true, only_synthetic_bindings: true, temporary_store_removed: true, control_thread_stopped: true, timer_stopped: true});
      expect(inventory(root)).toEqual(before);
    } catch (error) {failure ??= error;}
    await writeFile(resolve(output, 'counterpart.json'), JSON.stringify({producer_checkpoint: producerCheckpoint, source_scope: 'Only enumerated pinned receipt paths; not all Python/config/dependencies', source: before, proof_scope: 'Actual disposable loopback HTTP; synthetic task materialization only, no execution or TLS', ready, transcript, stopped, producer_pid: child.pid, producer_exit: exit, forced, pid_absent: pidAbsent, stderr: Buffer.concat(stderr).toString('utf8'), failure: failure instanceof Error ? {name: failure.name, message: failure.message} : failure ? String(failure) : null}, null, 2) + '\n', {encoding: 'utf8', flag: 'wx'});
  }
  if (failure) throw failure;
}, 35000);
