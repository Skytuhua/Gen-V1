import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {CompanyClient, createCompanyManagerTools} from '../packages/company-client/index.ts';
import {COMPANY_MANAGER_MODEL, CompanyManagerError, type CompanyManagerPermit} from '../packages/company-manager/contracts.ts';
import {createCompanyContextSource} from '../packages/company-manager/context.ts';

const permit = (changes: Partial<CompanyManagerPermit> = {}): CompanyManagerPermit => ({id: 'permit-1', projectId: 'alpha', employeeId: 'E01', machineId: 'manager-machine', machineGeneration: 1, accountId: '79d2709a-c00c-4aa7-99aa-3a87c4da33df', modelId: COMPANY_MANAGER_MODEL, thinkingLevel: 'max', policyRevision: 'mandate-1', receiptDigest: 'a'.repeat(64), issuedAt: 100, expiresAt: 1000, maxModelRequests: 4, maxToolCalls: 12, maxDurationMs: 5000, ...changes});
const observation = () => ({project_id: 'alpha', employee_id: 'E01', evidence_scope: 'synthetic_only' as const, live_ready: false as const, assignments: [{task_id: 'task-1', state: 'planned', work_order_id: 'work-1'}]});
function source(result: unknown = observation(), now = () => 200) {
  const client = new CompanyClient({origin: 'http://127.0.0.1:1', credential: () => 'fixture-employee', role: 'employee'});
  const invoke = vi.spyOn(client, 'employeeTool').mockResolvedValue(result as never);
  return {context: createCompanyContextSource(createCompanyManagerTools(client), {now}), invoke};
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {for (const cleanup of cleanups.splice(0)) await cleanup();});

describe('bounded authorized company context observations', () => {
  it('uses the real employee adapter and only the permit project in a fixture transport', async () => {
    const seen: unknown[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      seen.push({path: request.url, authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString())});
      response.writeHead(200, {'Content-Type': 'application/json'}); response.end(JSON.stringify(observation()));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>(resolve => {server.close(() => resolve()); server.closeAllConnections();}));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture address');
    const client = new CompanyClient({origin: `http://127.0.0.1:${address.port}`, credential: () => 'fixture-employee', role: 'employee'});
    const context = createCompanyContextSource(createCompanyManagerTools(client), {now: () => 200});
    const packet = await context.capture(permit(), new AbortController().signal);
    expect(seen).toEqual([{path: '/v1/employee/tool', authorization: 'Bearer fixture-employee', body: {project_id: 'alpha', tool: 'read_assignment', arguments: {}}}]);
    expect(packet).toMatchObject({projectId: 'alpha', employeeId: 'E01', capturedAt: 200, complete: true, truncated: false, liveReady: false, knowledgeAvailability: 'unavailable', assignments: [{taskId: 'task-1', state: 'planned', workOrderId: 'work-1'}]});
    expect(packet.receipt).toMatchObject({kind: 'client_observation', source: 'company_service', operation: 'read_assignment', projectId: 'alpha', employeeId: 'E01', receivedAt: 200, sourceRevision: null, evidenceScope: 'synthetic_only', bodyDigest: createHash('sha256').update(JSON.stringify(observation())).digest('hex')});
    expect(packet.receipt.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(Object.isFrozen(packet)).toBe(true); expect(Object.isFrozen(packet.assignments[0])).toBe(true);
  });
  it.each([{project_id: 'beta'}, {employee_id: 'E02'}])('denies scope mismatch before accessing assignment content: %j', async changes => {
    const content = vi.fn(() => {throw new Error('private assignment content');});
    const result = {...observation(), ...changes}; Object.defineProperty(result, 'assignments', {get: content});
    const {context} = source(result);
    await expect(context.capture(permit(), new AbortController().signal)).rejects.toMatchObject({code: 'COMPANY_MANAGER_BLOCKED'});
    expect(content).not.toHaveBeenCalled();
  });
  it.each([{projectId: 'company-ops'}, {projectId: ''}, {employeeId: 'E02'}, {expiresAt: 200}, {issuedAt: 201}])('rejects invalid or expired permits before a read: %j', async changes => {
    const {context, invoke} = source();
    await expect(context.capture(permit(changes as never), new AbortController().signal)).rejects.toMatchObject({code: 'COMPANY_MANAGER_BLOCKED'});
    expect(invoke).not.toHaveBeenCalled();
  });
  it('rejects cancelled requests before and after a pending read', async () => {
    const before = new AbortController(); before.abort('private reason'); const {context, invoke} = source();
    await expect(context.capture(permit(), before.signal)).rejects.toMatchObject({code: 'COMPANY_MANAGER_CANCELLED'}); expect(invoke).not.toHaveBeenCalled();
    let finish!: (result: ReturnType<typeof observation>) => void;
    invoke.mockImplementation(() => new Promise(resolve => {finish = resolve;}));
    const after = new AbortController(), pending = context.capture(permit(), after.signal);
    after.abort('private reason'); finish(observation());
    await expect(pending).rejects.toMatchObject({code: 'COMPANY_MANAGER_CANCELLED'});
  });
  it('discards a late response whose permit expires during the read', async () => {
    let now = 200; const {context, invoke} = source(observation(), () => now);
    invoke.mockImplementation(async () => {now = 1000; return observation();});
    await expect(context.capture(permit(), new AbortController().signal)).rejects.toMatchObject({code: 'COMPANY_MANAGER_BLOCKED'});
  });
  it('sanitizes an invalid cancellation signal before invoking the adapter', async () => {
    const {context, invoke} = source();
    await expect(context.capture(permit(), null as never)).rejects.toEqual(new CompanyManagerError('COMPANY_MANAGER_INPUT'));
    expect(invoke).not.toHaveBeenCalled();
  });
  it('does not grant an unknown project the previously observed project context', async () => {
    const {context, invoke} = source();
    await expect(context.capture(permit({projectId: 'unknown-project'}), new AbortController().signal)).rejects.toMatchObject({code: 'COMPANY_MANAGER_BLOCKED'});
    expect(invoke).toHaveBeenCalledExactlyOnceWith({project_id: 'unknown-project', tool: 'read_assignment', arguments: {}});
  });
  it('caps metadata at 20 records and 16KiB, declaring any omitted records', async () => {
    for (const value of [observation(), {...observation(), assignments: Array.from({length: 200}, (_, i) => ({task_id: `task-${i}`, state: 'planned', work_order_id: `work-${i}`}))}, {...observation(), assignments: Array.from({length: 20}, () => ({task_id: '\u0001'.repeat(128), state: '\u0001'.repeat(128), work_order_id: '\u0001'.repeat(128)}))}]) {
      const {context} = source(value), packet = await context.capture(permit(), new AbortController().signal);
      expect(Buffer.byteLength(JSON.stringify(packet))).toBeLessThanOrEqual(16 * 1024); expect(packet.assignments.length).toBeLessThanOrEqual(20);
      const omitted = packet.assignments.length < value.assignments.length;
      expect(packet.truncated).toBe(omitted); expect(packet.complete).toBe(!omitted);
      expect(packet.receipt.bodyDigest).toBe(createHash('sha256').update(JSON.stringify(value)).digest('hex'));
    }
  });
  it('keeps empty assignment observations synthetic and knowledge unavailable without cached defaults', async () => {
    const {context, invoke} = source({...observation(), assignments: []});
    const first = await context.capture(permit(), new AbortController().signal);
    expect(first).toMatchObject({assignments: [], liveReady: false, knowledgeAvailability: 'unavailable', receipt: {sourceRevision: null, evidenceScope: 'synthetic_only'}});
    invoke.mockResolvedValueOnce({...observation(), project_id: 'beta'});
    await expect(context.capture(permit(), new AbortController().signal)).rejects.toBeInstanceOf(CompanyManagerError);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it.each(['{bad json', null, {...observation(), evidence_scope: 'native_verified'}, {...observation(), assignments: [{task_id: 'a', state: 'x'.repeat(129), work_order_id: 'w'}]}])('sanitizes malformed responses without reflecting content: %j', async result => {
    const {context} = source(result);
    await expect(context.capture(permit(), new AbortController().signal)).rejects.toEqual(new CompanyManagerError('COMPANY_MANAGER_INPUT'));
  });
  it('sanitizes transport errors and refuses owner or expanded tool adapters without fallback', async () => {
    const {context, invoke} = source(); invoke.mockRejectedValue(new Error('private credential and transport details'));
    await expect(context.capture(permit(), new AbortController().signal)).rejects.toEqual(new CompanyManagerError('COMPANY_MANAGER_FAILED'));
    const credential = vi.fn(() => 'fixture-owner'), owner = new CompanyClient({origin: 'http://127.0.0.1:1', credential, role: 'owner'});
    expect(() => createCompanyContextSource(owner as never)).toThrowError(CompanyManagerError);
    expect(() => createCompanyContextSource({names: ['read_assignment', 'start'], invoke: vi.fn()} as never)).toThrowError(CompanyManagerError);
    expect(credential).not.toHaveBeenCalled();
  });
});
