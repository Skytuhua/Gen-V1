import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {CompanyClient, CompanyError, createCompanyManagerTools} from '../packages/company-client/index.ts';
import samples from '../packages/company-contracts/company-manager.commands.v1.samples.json';
import {
  COMPANY_PLANNING_TRANSPORT, MandateSetInputSchema, IntakeRecordInputSchema, ProposalSubmitInputSchema,
  PlanningContextInputSchema, PlanningContextResponseSchema,
  type PlanningContextResponse,
} from '../packages/company-contracts/planning.ts';

const mandate = () => structuredClone(MandateSetInputSchema.parse(samples.examples[0].request));
const intake = () => structuredClone(IntakeRecordInputSchema.parse(samples.examples[1].request));
const proposal = () => structuredClone(ProposalSubmitInputSchema.parse(samples.examples[2].request));
const context = () => structuredClone(PlanningContextInputSchema.parse(samples.examples[4].request));
const contextResponse = () => structuredClone(PlanningContextResponseSchema.parse(samples.examples[4].response));
const calls = [
  (client: CompanyClient, value: unknown) => client.setMandate(value as never),
  (client: CompanyClient, value: unknown) => client.recordIntake(value as never),
  (client: CompanyClient, value: unknown) => client.submitProposal(value as never),
  (client: CompanyClient, value: unknown) => client.reviewProposal(value as never),
  (client: CompanyClient, value: unknown) => client.planningContext(value as never),
];
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {for (const cleanup of cleanups.splice(0)) await cleanup();});
async function fixture(handler: (request: IncomingMessage, response: ServerResponse, body: unknown) => void) {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    handler(request, response, JSON.parse(Buffer.concat(chunks).toString('utf8')));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => {server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();}));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture address missing.');
  return `http://127.0.0.1:${address.port}`;
}
function json(response: ServerResponse, value: unknown, status = 200) {
  const bytes = JSON.stringify(value); response.writeHead(status, {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes)}); response.end(bytes);
}
const client = (origin: string) => new CompanyClient({origin, credential: () => 'planning-owner', role: 'owner'});

describe('five fixed owner planning client operations', () => {
  samples.examples.forEach((example, index) => it(`sends exactly one ${example.operation} request`, async () => {
    let count = 0;
    const origin = await fixture((request, response, body) => {
      count++; expect(request.url).toBe(Object.values(COMPANY_PLANNING_TRANSPORT.routes)[index]);
      expect(request.method).toBe('POST'); expect(request.headers.authorization).toBe('Bearer planning-owner');
      expect(request.headers.host).toBe(origin.slice(7)); expect(Number(request.headers['content-length'])).toBe(Buffer.byteLength(JSON.stringify(body)));
      expect(body).toEqual(example.request); json(response, example.response);
    });
    expect(await calls[index](client(origin), example.request)).toEqual(example.response); expect(count).toBe(1);
  }));
  it('requires owner role before touching input, credentials or network and adds no engine tool', async () => {
    const credential = vi.fn(() => 'private'); const employee = new CompanyClient({origin: 'http://127.0.0.1:1', role: 'employee', credential});
    const hostile = {get project_id() {throw new Error('private');}};
    for (const call of calls) await expect(call(employee as unknown as CompanyClient, hostile)).rejects.toMatchObject({code: 'COMPANY_FORBIDDEN'});
    expect(credential).not.toHaveBeenCalled(); expect(createCompanyManagerTools(employee).names).toEqual(['status_scoped', 'read_assignment', 'read_artifact']);
  });
  it('rejects malformed, extra, cross-project and attested requests before credential access', async () => {
    const credential = vi.fn(() => 'private'); const owner = new CompanyClient({origin: 'http://127.0.0.1:1', role: 'owner', credential});
    for (let i = 0; i < calls.length; i++) {
      await expect(calls[i](owner, {...samples.examples[i].request, authenticated_author: 'owner'})).rejects.toMatchObject({code: 'COMPANY_REQUEST'});
      await expect(calls[i](owner, {get project_id() {throw new Error('private');}})).rejects.toMatchObject({code: 'COMPANY_REQUEST'});
    }
    const p = proposal();
    for (const input of [{...p, intake_ref: {...p.intake_ref, scope: {kind: 'project', id: 'beta'}}}, {...p, local_draft: {...p.local_draft, companyReceipt: {}}}]) await expect(owner.submitProposal(input as never)).rejects.toMatchObject({code: 'COMPANY_REQUEST'});
    expect(credential).not.toHaveBeenCalled();
  });
  it('snapshots every exact nested input before asynchronous credential access', async () => {
    for (let i = 0; i < calls.length; i++) {
      const expected = structuredClone(samples.examples[i].request), input = structuredClone(expected);
      const origin = await fixture((_request, response, body) => {expect(body).toEqual(expected); json(response, samples.examples[i].response);});
      let resolveCredential!: (token: string) => void;
      const owner = new CompanyClient({origin, role: 'owner', credential: () => new Promise<string>(resolve => {resolveCredential = resolve;})});
      const pending = calls[i](owner, input);
      input.project_id = 'beta';
      if ('mandate' in input && input.mandate) input.mandate.goals[0] = 'Mutated';
      if ('local_draft' in input && input.local_draft) input.local_draft.content.summary = 'Mutated';
      if ('mandate_ref' in input && input.mandate_ref) input.mandate_ref.digest = 'b'.repeat(64);
      if ('record_ref' in input && input.record_ref) input.record_ref.digest = 'b'.repeat(64);
      if ('feedback' in input) input.feedback = 'Mutated';
      await Promise.resolve(); resolveCredential('planning-owner'); await expect(pending).resolves.toEqual(samples.examples[i].response);
    }
  });
  it('accepts the new 128 KiB framing including a 16000 character unicode owner instruction', async () => {
    const input = intake(); input.intake.instruction = '界'.repeat(16000);
    expect(Buffer.byteLength(JSON.stringify(input))).toBeGreaterThan(32768);
    const origin = await fixture((_request, response, body) => {expect(body).toEqual(input); json(response, samples.examples[1].response);});
    await expect(client(origin).recordIntake(input)).resolves.toEqual(samples.examples[1].response);
  });
  it.each(['declared', 'streamed'])('bounds %s success and error responses at 128 KiB', async framing => {
    for (const status of [200, 409]) {
      const origin = await fixture((_request, response) => {
        const headers: Record<string, string | number> = {'Content-Type': 'application/json'};
        if (framing === 'declared') headers['Content-Length'] = COMPANY_PLANNING_TRANSPORT.responseBytes + 1;
        response.writeHead(status, headers); response.end(Buffer.alloc(COMPANY_PLANNING_TRANSPORT.responseBytes + 1, 32));
      });
      await expect(client(origin).setMandate(mandate())).rejects.toMatchObject({code: 'COMPANY_RESPONSE'});
    }
  });
  const wireErrors = [
    ['invalid_request', 400, 'COMPANY_REQUEST'], ['authentication_required', 401, 'COMPANY_AUTH'], ['scope_denied', 403, 'COMPANY_FORBIDDEN'],
    ['not_found', 404, 'COMPANY_NOT_FOUND'], ['message_conflict', 409, 'COMPANY_MESSAGE_CONFLICT'], ['revision_conflict', 409, 'COMPANY_REVISION_CONFLICT'],
    ['stale_basis', 409, 'COMPANY_STALE_BASIS'], ['reference_mismatch', 409, 'COMPANY_REFERENCE_MISMATCH'],
    ['planning_record_too_large', 413, 'COMPANY_RECORD_TOO_LARGE'], ['planning_storage_unavailable', 503, 'COMPANY_STORAGE_UNAVAILABLE'], ['capability_unavailable', 503, 'COMPANY_CAPABILITY_UNAVAILABLE'],
  ] as const;
  it.each(wireErrors)('maps only the exact %s HTTP %s pair without retry or new message identity', async (wire, status, code) => {
    const bodies: unknown[] = [];
    const origin = await fixture((_request, response, body) => {bodies.push(body); json(response, {error: {code: wire}}, status);});
    const input = mandate(); const error = await client(origin).setMandate(input).catch(value => value);
    expect(error).toBeInstanceOf(CompanyError); expect(error.code).toBe(code); expect(error.restartRequired).toBe(false);
    expect(bodies).toEqual([input]); expect(input.message_id).toBe(mandate().message_id);
  });
  it('rejects unknown, malformed, extra, reflected and wrong-status error JSON without diagnostics', async () => {
    for (const [status, value] of [[409, {error: {code: 'snapshot_changed'}}], [500, {error: {code: 'stale_basis'}}], [409, {error: {code: 'stale_basis', detail: 'private'}}], [409, '{'], [409, {error: {code: 'planning-owner'}}]] as const) {
      const origin = await fixture((_request, response) => {if (typeof value === 'string') {response.writeHead(status, {'Content-Type': 'application/json'}); response.end(value);} else json(response, value, status);});
      const error = await client(origin).setMandate(mandate()).catch(value => value);
      expect(error.code).toBe('COMPANY_RESPONSE'); expect(String(error) + JSON.stringify(error)).not.toMatch(/planning-owner|private|stale_basis/);
    }
    for (const status of [401, 403]) {
      const origin = await fixture((_request, response) => {response.writeHead(status, {'Content-Type': 'text/html'}); response.end('private planning-owner');});
      await expect(client(origin).setMandate(mandate())).rejects.toMatchObject({code: status === 401 ? 'COMPANY_AUTH' : 'COMPANY_FORBIDDEN'});
    }
  });
  it('rejects escaped token reflections, redirects, non-JSON replies and preserves the total deadline', async () => {
    for (const mode of ['reflection', 'html', 'redirect', 'slow']) {
      const origin = await fixture((_request, response) => {
        if (mode === 'redirect') {response.writeHead(302, {Location: '/company-manager/v1/mandate/set'}); response.end(); return;}
        response.writeHead(200, {'Content-Type': mode === 'html' ? 'text/html' : 'application/json'});
        if (mode === 'slow') {const timer = setInterval(() => response.write(' '), 8); response.on('close', () => clearInterval(timer)); return;}
        response.end(JSON.stringify(samples.examples[0].response).replace('storage-receipt-fixture-1', '\\u0070lanning-owner'));
      });
      await expect(new CompanyClient({origin, role: 'owner', credential: () => 'planning-owner', timeoutMs: 50}).setMandate(mandate())).rejects.toMatchObject({code: mode === 'slow' ? 'COMPANY_TIMEOUT' : 'COMPANY_RESPONSE'});
    }
    await expect(new CompanyClient({origin: 'http://127.0.0.1:1', role: 'owner', credential: () => new Promise(() => {}), timeoutMs: 20}).setMandate(mandate())).rejects.toMatchObject({code: 'COMPANY_TIMEOUT'});
  });
  it('checks decoded credential reflections even inside otherwise valid error enums', async () => {
    const origin = await fixture((_request, response) => {
      response.writeHead(409, {'Content-Type': 'application/json'}); response.end('{"error":{"code":"\\u0073tale_basis"}}');
    });
    await expect(new CompanyClient({origin, role: 'owner', credential: () => 'stale'}).setMandate(mandate())).rejects.toMatchObject({code: 'COMPANY_RESPONSE'});
  });
  it('checks receipt project, operation, record identity and creation revision', async () => {
    const base = samples.examples[1].response;
    if (!('receipt' in base) || !base.receipt) throw new Error('Fixture receipt missing.');
    for (const receipt of [
      {...base.receipt, scope: {kind: 'project', id: 'beta'}}, {...base.receipt, operation: 'mandate_set'},
      {...base.receipt, record_ref: {...base.receipt.record_ref, scope: {kind: 'project', id: 'beta'}}},
      {...base.receipt, record_ref: {...base.receipt.record_ref, revision: 2}},
    ]) {
      const origin = await fixture((_request, response) => json(response, {...base, receipt}));
      await expect(client(origin).recordIntake(intake())).rejects.toMatchObject({code: 'COMPANY_RESPONSE'});
    }
    const input = intake(); input.intake_id = 'exact-id'; input.expected_head_digest = 'a'.repeat(64);
    const origin = await fixture((_request, response) => json(response, base));
    await expect(client(origin).recordIntake(input)).rejects.toMatchObject({code: 'COMPANY_RESPONSE'});
  });
  it('requires a distinct successor digest when the exact amendment head is known', async () => {
    const base = samples.examples[1].response;
    if (!('receipt' in base) || !base.receipt) throw new Error('Fixture receipt missing.');
    const input = intake(); input.intake_id = base.receipt.record_ref.id; input.expected_head_digest = base.receipt.record_ref.digest;
    const origin = await fixture((_request, response) => json(response, {...base, receipt: {...base.receipt, record_ref: {...base.receipt.record_ref, revision: 2}}}));
    await expect(client(origin).recordIntake(input)).rejects.toMatchObject({code: 'COMPANY_RESPONSE'});
  });
  const mismatches: [string, (value: PlanningContextResponse) => void][] = [
    ['project', value => {value.project_id = 'beta';}],
    ['record scope', value => {value.view!.record.ref.scope.id = 'beta';}],
    ['selected digest', value => {value.view!.record.ref.digest = 'b'.repeat(64);}],
    ['head ID', value => {value.view!.current_head_ref.id = 'different';}],
    ['head digest', value => {value.view!.current_head_ref.digest = 'b'.repeat(64);}],
    ['currentness', value => {value.view!.currentness = 'stale';}],
    ['basis', value => {value.view!.basis_current = false;}],
    ['linked mandate', value => {value.view!.linked_refs.mandate_ref!.digest = 'b'.repeat(64);}],
    ['latest review proposal', value => {value.view!.latest_review!.proposal_ref.digest = 'b'.repeat(64);}],
    ['latest review mandate', value => {value.view!.latest_review!.mandate_ref.digest = 'b'.repeat(64);}],
    ['latest review decision', value => {value.view!.latest_review!.decision = 'rejected';}],
  ];
  it.each(mismatches)('rejects mismatched planning context %s', async (_name, mutate) => {
    const value = contextResponse(); mutate(value);
    const origin = await fixture((_request, response) => json(response, value));
    await expect(client(origin).planningContext(context())).rejects.toMatchObject({code: 'COMPANY_RESPONSE'});
  });
  it('compares reference fields independently of object property order', async () => {
    const value = contextResponse(); const ref = value.view!.linked_refs.mandate_ref!;
    value.view!.linked_refs.mandate_ref = {digest: ref.digest, revision: ref.revision, scope: {id: ref.scope.id, kind: 'project'}, id: ref.id, type: ref.type};
    const origin = await fixture((_request, response) => json(response, value));
    await expect(client(origin).planningContext(context())).resolves.toEqual(value);
  });
  it('rejects malformed UTF-8 bytes instead of altering immutable planning text during decoding', async () => {
    const value=contextResponse();
    if(!value.view||!('local_draft' in value.view.record.body))throw new Error('Expected proposal fixture');
    value.view.record.body.local_draft.content.summary='Unique UTF8 marker';
    const bytes=Buffer.from(JSON.stringify(value)),index=bytes.indexOf('Unique UTF8 marker');
    expect(index).toBeGreaterThanOrEqual(0);bytes[index]=0xff;
    const origin=await fixture((_request,response)=>{response.writeHead(200,{'Content-Type':'application/json','Content-Length':bytes.length});response.end(bytes);});
    await expect(client(origin).planningContext(context())).rejects.toMatchObject({code:'COMPANY_RESPONSE'});
  });
  it('permits absence only for a current mandate lookup, preserving explicit historical selection', async () => {
    const absent = await fixture((_request, response) => json(response, samples.absent_mandate_example.response));
    await expect(client(absent).planningContext({project_id: 'alpha', record_ref: null})).resolves.toEqual(samples.absent_mandate_example.response);
    await expect(client(absent).planningContext(context())).rejects.toMatchObject({code: 'COMPANY_RESPONSE'});
    const historical = contextResponse(); historical.view!.current_head_ref.revision++; historical.view!.current_head_ref.digest = 'b'.repeat(64); historical.view!.currentness = 'superseded';
    const origin = await fixture((_request, response) => json(response, historical));
    await expect(client(origin).planningContext(context())).resolves.toEqual(historical);
    await expect(client(origin).planningContext({project_id: 'alpha', record_ref: null})).rejects.toMatchObject({code: 'COMPANY_RESPONSE'});
  });
});
