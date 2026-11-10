import {afterEach, expect, it, vi} from 'vitest';
import type {RuntimeAdapter, RuntimeCallbacks, StartRun} from '../packages/contracts/index.ts';
import type {RuntimeAccountResolver} from '../packages/contracts/accounts.ts';
import type {HermesEngine, HermesEngineOptions, HermesRuntimeDependencies} from '../packages/runtime-hermes/index.ts';
import type {createCompanyManagerTools} from '../packages/company-client/index.ts';
import {createCompanyManagerRuntime} from '../packages/company-manager/runtime.ts';
import type {CompanyManagerBootstrap, CompanyManagerPermit} from '../packages/company-manager/contracts.ts';
import type {CompanyContextPacket} from '../packages/company-manager/context.ts';

const accountId = '11111111-1111-4111-8111-111111111111';
const input = {requestId: 'request-one', projectId: 'project-one', instruction: 'Prepare a bounded implementation proposal.'};
const proposal = {summary: 'Implement the request', interpretation: 'Prepare one change', assumptions: [], blockers: [], tasks: [{id: 'task-one', title: 'Implement', instructions: 'Make the bounded change', dependsOn: [], proposedEmployeeId: null, sourceRefs: [], deliverable: 'code', requiredEvidence: ['Passing relevant tests']}]};
const permit = (extra: Partial<CompanyManagerPermit> = {}): CompanyManagerPermit => ({id: 'permit-one', projectId: 'project-one', employeeId: 'E01', machineId: 'machine-one', machineGeneration: 1, accountId, modelId: 'openai-codex/gpt-6.1-sol', thinkingLevel: 'max', policyRevision: 'policy-one', receiptDigest: 'a'.repeat(64), issuedAt: 900, expiresAt: 100000, maxModelRequests: 2, maxToolCalls: 2, maxDurationMs: 30000, ...extra});
function deferred<T = void>() {let resolve!: (value: T) => void; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};}
type EngineEntry = {engine: HermesEngine; options: HermesEngineOptions; deps: HermesRuntimeDependencies; callbacks: RuntimeCallbacks; input: StartRun; catalog: RuntimeAdapter};
type FixtureOptions = {bootstrap?: CompanyManagerBootstrap | null; permit?: CompanyManagerPermit; models?: {id: string; provider: string; name: string; thinkingLevels?: string[]}[]; enabled?: boolean; perform?: (entry: EngineEntry, run: StartRun) => Promise<void>; cleanup?: () => Promise<void>; output?: string; now?: () => number; contextSource?: {capture(permit: CompanyManagerPermit, signal: AbortSignal): Promise<CompanyContextPacket>}};
const runtimes: ReturnType<typeof createCompanyManagerRuntime>[] = [];
afterEach(async () => {for (const runtime of runtimes.splice(0)) await runtime.dispose().catch(() => {}); vi.useRealTimers();});
function fixture(extra: FixtureOptions = {}) {
  const entries: EngineEntry[] = [], nativeStarts: StartRun[] = [], nativeDisposes: RuntimeAdapter[] = [];
  const bootstrap: CompanyManagerBootstrap = extra.bootstrap ?? {authorize: vi.fn(async () => extra.permit ?? permit()), assertCurrent: vi.fn(async () => {})};
  const accounts: RuntimeAccountResolver = {get: vi.fn((id: string) => ({id, providerId: 'openai-codex' as const, label: 'Company account', enabled: extra.enabled ?? true, createdAt: '', updatedAt: ''}))};
  const invoke = vi.fn(async (_value: unknown) => ({project_id: 'project-one', employee_id: 'E01', evidence_scope: 'synthetic_only' as const, live_ready: false as const, assignments: []}));
  const tools: ReturnType<typeof createCompanyManagerTools> = {names: ['status_scoped', 'read_assignment', 'read_artifact'], invoke};
  const createNativeRuntime = vi.fn((): RuntimeAdapter => {
    const native: RuntimeAdapter = {configure() {}, models: vi.fn(async () => extra.models ?? [{id: 'openai-codex/gpt-6.1-sol', provider: 'openai-codex', name: 'Exact model', thinkingLevels: ['max']}]), start: async value => {nativeStarts.push(value);}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {nativeDisposes.push(native);}};
    return native;
  });
  const createEngine = vi.fn((options: HermesEngineOptions, deps: HermesRuntimeDependencies = {}): HermesEngine => {
    const entry = {options, deps} as EngineEntry;
    entry.catalog = deps.createNativeRuntime!({dataDir: options.dataDir, accounts: options.accounts, modelOnly: true});
    entry.engine = {configure(callbacks) {entry.callbacks = callbacks;}, models: value => entry.catalog.models(value), async start(value) {entry.input = value; if (extra.perform) await extra.perform(entry, value); else {entry.callbacks.onEvent({...value, type: 'assistant.message', content: extra.output ?? JSON.stringify(proposal)}); entry.callbacks.onEvent({...value, type: 'settled', aborted: false});}}, followUp: vi.fn(async () => {}), cancel: vi.fn(async () => {}), compact: vi.fn(async () => {}), history: vi.fn(async () => []), dispose: vi.fn(async () => {await extra.cleanup?.(); await entry.catalog.dispose();}), cancelBackground: vi.fn(async () => {}), sourceRequest: vi.fn(async () => ({} as never)), sourceTool: vi.fn(async () => ({})), refreshIntegrations: vi.fn(async () => {}), sourceBusy: false, reviewBusy: false};
    entries.push(entry); return entry.engine;
  });
  const runtime = createCompanyManagerRuntime({dataDir: 'C:/company-manager-test', home: 'C:/company-manager-test/hermes', accounts, tools, bootstrap: extra.bootstrap === null ? undefined : bootstrap, contextSource: extra.contextSource}, {createEngine, createNativeRuntime, now: extra.now ?? (() => 1000)});
  runtimes.push(runtime);
  return {runtime, entries, createEngine, createNativeRuntime, accounts, bootstrap, invoke, nativeStarts, nativeDisposes};
}
const modelInput = (run: StartRun, extra: Partial<StartRun> = {}): StartRun => ({...run, threadId: 'hermes-model-native', runId: 'native-one', inputId: 'native-input', ...extra});
function complete(entry: EngineEntry, content = JSON.stringify(proposal)) {entry.callbacks.onEvent({...entry.input, type: 'assistant.message', content}); entry.callbacks.onEvent({...entry.input, type: 'settled', aborted: false});}

it.each(['status_scoped', 'read_assignment'])('rejects a later %s result for another employee before the model receives it', async name => {
  let delivered = false, reads = 0;
  const f = fixture({perform: async (entry, run) => {await entry.callbacks.onTool({name, args: {}}, run); delivered = true; complete(entry);}});
  f.invoke.mockImplementation(async () => ({project_id: 'project-one', employee_id: ++reads === 1 ? 'E01' : 'E02', evidence_scope: 'synthetic_only', live_ready: false, assignments: []}));
  await expect(f.runtime.propose(input)).rejects.toMatchObject({code: 'COMPANY_MANAGER_BLOCKED'});
  expect(delivered).toBe(false);
});

it('blocks absent admission before constructing an engine or looking up an account', async () => {
  const f = fixture({bootstrap: null}); await expect(f.runtime.propose(input)).rejects.toMatchObject({code: 'COMPANY_MANAGER_BLOCKED'});
  expect(f.createEngine).not.toHaveBeenCalled(); expect(f.accounts.get).not.toHaveBeenCalled(); expect(f.createNativeRuntime).not.toHaveBeenCalled();
});
it.each([{expiresAt: 950}, {projectId: 'wrong-project'}, {employeeId: 'E02'}])('blocks an unusable permit before factories: %j', async extra => {
  const f = fixture({permit: permit(extra as Partial<CompanyManagerPermit>)}); await expect(f.runtime.propose(input)).rejects.toMatchObject({code: 'COMPANY_MANAGER_BLOCKED'});
  expect(f.createEngine).not.toHaveBeenCalled(); expect(f.accounts.get).not.toHaveBeenCalled();
});
it('sanitizes rejected admission and validates input before admission', async () => {
  const bootstrap = {authorize: vi.fn(async () => {throw Error('secret credential');}), assertCurrent: vi.fn(async () => {})}; const f = fixture({bootstrap});
  await expect(f.runtime.propose({...input, projectId: 'company-ops'})).rejects.toMatchObject({code: 'COMPANY_MANAGER_INPUT'}); expect(bootstrap.authorize).not.toHaveBeenCalled();
  await expect(f.runtime.propose(input)).rejects.toMatchObject({code: 'COMPANY_MANAGER_BLOCKED', message: 'Company manager admission is unavailable or no longer current.'}); expect(f.createEngine).not.toHaveBeenCalled();
});
it.each([{enabled: false}, {models: [{id: 'openai-codex/other', provider: 'openai-codex', name: 'Other', thinkingLevels: ['max']}]}, {models: [{id: 'openai-codex/gpt-6.1-sol', provider: 'openai-codex', name: 'Exact', thinkingLevels: ['high']}]}])('requires an enabled explicit account and exact max-capable catalog: %j', async extra => {
  const f = fixture(extra); await expect(f.runtime.propose(input)).rejects.toMatchObject({code: 'COMPANY_MANAGER_MODEL'}); expect(f.entries.every(entry => !entry.input)).toBe(true);
});
it('creates an unsubmitted draft after foreground settlement and actual cleanup with no helper capability', async () => {
  const gate = deferred(), f = fixture({cleanup: () => gate.promise}); let returned = false;
  const pending = f.runtime.propose(input).then(value => {returned = true; return value;}); void pending.catch(() => {}); await vi.waitFor(() => expect(f.entries[0]?.engine.dispose).toHaveBeenCalled()); expect(returned).toBe(false);
  const entry = f.entries[0]; expect(entry.input).toMatchObject({modelId: 'openai-codex/gpt-6.1-sol', accountId, thinkingLevel: 'max', resources: [], sessionPath: null}); expect(entry.input.threadId).not.toBe(input.requestId); expect(entry.input.memory).toBeUndefined();
  expect(entry.options).toMatchObject({readOnly: true, skillPolicy: {enabled: false, allowWrites: false, backgroundReview: false}, integrations: {enabled: [], ponytailMode: 'off'}, config: {skills: {creation_nudge_interval: 0}, memory: {memory_enabled: false, user_profile_enabled: false}, auxiliary: {background_review: {enabled: false}}, compression: {enabled: false, micro_compact: false, idle_compact_after_seconds: 0}}});
  expect(entry.options.settings).toBeUndefined(); expect(entry.options.sharedLibrary).toBeUndefined(); expect(entry.options.projectRoot).toBeUndefined(); expect(entry.options.initialHistory).toBeUndefined();
  expect(entry.options.hostTools?.map(tool => tool.name)).toEqual(['status_scoped', 'read_assignment', 'read_artifact']); gate.resolve();
  expect(await pending).toMatchObject({kind: 'local_manager_draft', state: 'unsubmitted', dispatchAuthorized: false, companyReceipt: null, content: proposal}); expect(f.entries[0].engine.followUp).not.toHaveBeenCalled();
});
it('injects the captured project and rejects model-chosen project, unknown tools and stale owners before requests', async () => {
  const seen: unknown[] = [], f = fixture({perform: async (entry, run) => {
    for (const call of [{name: 'start', args: {}}, {name: 'status_scoped', args: {project_id: 'wrong-project'}}, {name: 'read_artifact', args: {artifact_id: 'artifact', extra: true}}]) await expect(entry.callbacks.onTool(call, run)).rejects.toMatchObject({code: 'COMPANY_MANAGER_INPUT'});
    await expect(entry.callbacks.onTool({name: 'status_scoped', args: {}}, {...run, epoch: run.epoch + 1})).rejects.toMatchObject({code: 'COMPANY_MANAGER_BLOCKED'});
    seen.push(await entry.callbacks.onTool({name: 'status_scoped', args: {}}, run)); complete(entry);
  }}); await f.runtime.propose(input); expect(seen).toEqual([{project_id: 'project-one', employee_id: 'E01', evidence_scope: 'synthetic_only', live_ready: false, assignments: []}]); expect(f.invoke).toHaveBeenLastCalledWith({project_id: 'project-one', tool: 'status_scoped', arguments: {}});
});
it('rechecks admission after a tool read and revokes its returned data when ownership changes', async () => {
  let current = true; const bootstrap = {authorize: async () => permit(), assertCurrent: async () => {if (!current) throw Error('revoked');}};
  const f = fixture({bootstrap, perform: async (entry, run) => {await entry.callbacks.onTool({name: 'status_scoped', args: {}}, run); complete(entry);}}); f.invoke.mockImplementation(async value => {if ((value as {tool: string}).tool === 'status_scoped') current = false; return {project_id: 'project-one', employee_id: 'E01', evidence_scope: 'synthetic_only', live_ready: false, assignments: []};});
  await expect(f.runtime.propose(input)).rejects.toMatchObject({code: 'COMPANY_MANAGER_BLOCKED'}); expect(f.entries[0].engine.dispose).toHaveBeenCalledOnce();
});
it('checks every actual native start and enforces the model-request budget without a repair turn', async () => {
  const f = fixture({permit: permit({maxModelRequests: 1}), perform: async (entry, run) => {const native = entry.deps.createNativeRuntime!({dataDir: entry.options.dataDir, modelOnly: true}); await native.start(modelInput(run)); await native.start(modelInput(run, {runId: 'native-two'}));}});
  await expect(f.runtime.propose(input)).rejects.toMatchObject({code: 'COMPANY_MANAGER_LIMIT'}); expect(f.nativeStarts).toHaveLength(1); expect(f.entries[0].engine.followUp).not.toHaveBeenCalled();
});
it.each([{modelId: 'openai-codex/other'}, {accountId: null}, {thinkingLevel: 'high'}, {memory: 'private memory'}, {sessionPath: 'old-session'}, {resources: [{id: 'resource'}]}])('blocks a native model start outside its exact role: %j', async extra => {
  const f = fixture({perform: async (entry, run) => {const native = entry.deps.createNativeRuntime!({dataDir: entry.options.dataDir, modelOnly: true}); await native.start(modelInput(run, extra as Partial<StartRun>));}});
  await expect(f.runtime.propose(input)).rejects.toMatchObject({code: 'COMPANY_MANAGER_MODEL'}); expect(f.nativeStarts).toHaveLength(0);
});
it('rechecks admission immediately before a native model start', async () => {
  let current = true; const f = fixture({bootstrap: {authorize: async () => permit(), assertCurrent: async () => {if (!current) throw Error('revoked');}}, perform: async (entry, run) => {current = false; await entry.catalog.start(modelInput(run));}});
  await expect(f.runtime.propose(input)).rejects.toMatchObject({code: 'COMPANY_MANAGER_BLOCKED'}); expect(f.nativeStarts).toHaveLength(0);
});
it('bounds tool calls and revokes the request before the excess call can reach the employee client', async () => {
  const f = fixture({permit: permit({maxToolCalls: 2}), perform: async (entry, run) => {await entry.callbacks.onTool({name: 'status_scoped', args: {}}, run); await entry.callbacks.onTool({name: 'read_assignment', args: {}}, run);}});
  await expect(f.runtime.propose(input)).rejects.toMatchObject({code: 'COMPANY_MANAGER_LIMIT'}); expect(f.invoke).toHaveBeenCalledTimes(2);
});
it('ignores stale output and settlement and waits for the matching foreground owner', async () => {
  const f = fixture({perform: async (entry, run) => {entry.callbacks.onEvent({...run, runId: 'stale', type: 'assistant.message', content: 'bad'}); entry.callbacks.onEvent({...run, epoch: 999, type: 'settled'});}}); let returned = false;
  const pending = f.runtime.propose(input).then(value => {returned = true; return value;}); void pending.catch(() => {}); await vi.waitFor(() => expect(f.entries[0]?.input).toBeDefined()); await Promise.resolve(); expect(returned).toBe(false); complete(f.entries[0]); expect((await pending).content).toEqual(proposal);
});
it.each(['not-json', JSON.stringify({...proposal, tasks: []}), 'x'.repeat(65537)])('rejects malformed or oversized output without repair', async output => {
  const f = fixture({output}); await expect(f.runtime.propose(input)).rejects.toMatchObject({code: output.length > 65536 ? 'COMPANY_MANAGER_LIMIT' : 'COMPANY_MANAGER_INPUT'}); expect(f.entries[0].engine.followUp).not.toHaveBeenCalled(); expect(f.entries[0].engine.dispose).toHaveBeenCalledOnce();
});
it('retains busy ownership until cancellation actually cleans the isolated engine', async () => {
  const gate = deferred(), f = fixture({perform: async () => {}, cleanup: () => gate.promise}); const pending = f.runtime.propose(input).catch(error => error); await vi.waitFor(() => expect(f.entries[0]?.input).toBeDefined());
  let cancelled = false; const cancelling = f.runtime.cancel().then(() => {cancelled = true;}); await vi.waitFor(() => expect(f.entries[0].engine.dispose).toHaveBeenCalled()); await expect(f.runtime.propose({...input, requestId: 'successor'})).rejects.toMatchObject({code: 'COMPANY_MANAGER_BUSY'}); expect(cancelled).toBe(false); gate.resolve(); await cancelling; expect(await pending).toMatchObject({code: 'COMPANY_MANAGER_CANCELLED'});
});
it('retains uncertain cleanup ownership and sanitizes the failure', async () => {
  const f = fixture({cleanup: async () => {throw Error('secret cleanup details');}}); await expect(f.runtime.propose(input)).rejects.toMatchObject({code: 'COMPANY_MANAGER_CLEANUP'});
  await expect(f.runtime.propose({...input, requestId: 'successor'})).rejects.toMatchObject({code: 'COMPANY_MANAGER_BUSY'});
});
it('cancels external signals during admission before any runtime construction', async () => {
  const gate = deferred<CompanyManagerPermit>(), controller = new AbortController(), f = fixture({bootstrap: {authorize: () => gate.promise, assertCurrent: async () => {}}});
  const pending = f.runtime.propose(input, controller.signal); controller.abort(); await expect(pending).rejects.toMatchObject({code: 'COMPANY_MANAGER_CANCELLED'}); expect(f.createEngine).not.toHaveBeenCalled(); gate.resolve(permit());
});
it('revokes the whole engine when its absolute duration bound expires', async () => {
  vi.useFakeTimers(); const f = fixture({permit: permit({maxDurationMs: 10}), perform: async () => {}}), pending = f.runtime.propose(input).catch(error => error);
  await vi.waitFor(() => expect(f.entries[0]?.input).toBeDefined()); await vi.advanceTimersByTimeAsync(10); expect(await pending).toMatchObject({code: 'COMPANY_MANAGER_LIMIT'}); expect(f.entries[0].engine.cancel).toHaveBeenCalledOnce(); expect(f.entries[0].engine.dispose).toHaveBeenCalledOnce();
});
it('captures scoped assignment context before engine construction and permits only its receipt as a source', async () => {
  const f = fixture({perform: async entry => {
    const prompt = JSON.parse(entry.input.prompt), receipt = prompt.context.receipt.id;
    expect(prompt.context).toMatchObject({projectId: 'project-one', employeeId: 'E01', knowledgeAvailability: 'unavailable', liveReady: false});
    complete(entry, JSON.stringify({...proposal, tasks: [{...proposal.tasks[0], sourceRefs: [receipt]}]}));
  }});
  const draft = await f.runtime.propose(input); expect(draft.sourceRefs).toHaveLength(1); expect(draft.content.tasks[0].sourceRefs).toEqual(draft.sourceRefs);
  expect(f.invoke).toHaveBeenCalledExactlyOnceWith({project_id: 'project-one', tool: 'read_assignment', arguments: {}});
  expect(f.invoke.mock.invocationCallOrder[0]).toBeLessThan(f.createEngine.mock.invocationCallOrder[0]);
});
it('rejects model invented source references without a repair call', async () => {
  const f = fixture({output: JSON.stringify({...proposal, tasks: [{...proposal.tasks[0], sourceRefs: ['invented-receipt']}]})});
  await expect(f.runtime.propose(input)).rejects.toMatchObject({code: 'COMPANY_MANAGER_INPUT'}); expect(f.entries[0].engine.followUp).not.toHaveBeenCalled();
});
it('rechecks admission after scoped context capture before constructing an engine', async () => {
  let current = true; const f = fixture({bootstrap: {authorize: async () => permit(), assertCurrent: async () => {if (!current) throw Error('revoked');}}});
  f.invoke.mockImplementation(async () => {current = false; return {project_id: 'project-one', employee_id: 'E01', evidence_scope: 'synthetic_only', live_ready: false, assignments: []};});
  await expect(f.runtime.propose(input)).rejects.toMatchObject({code: 'COMPANY_MANAGER_BLOCKED'}); expect(f.createEngine).not.toHaveBeenCalled();
});
it('revokes oversized employee tool data before exposing it to the model', async () => {
  const f = fixture({perform: async (entry, run) => {await entry.callbacks.onTool({name: 'status_scoped', args: {}}, run); complete(entry);}});
  f.invoke.mockImplementation(async value => (value as {tool: string}).tool === 'status_scoped' ? {project_id: 'project-one', employee_id: 'E01', evidence_scope: 'synthetic_only', live_ready: false, assignments: [], extra: 'x'.repeat(65537)} : {project_id: 'project-one', employee_id: 'E01', evidence_scope: 'synthetic_only', live_ready: false, assignments: []});
  await expect(f.runtime.propose(input)).rejects.toMatchObject({code: 'COMPANY_MANAGER_LIMIT'});
});
it('rejects an owner-shaped tool client before any company request or engine factory', async () => {
  const f = fixture(), ownerClient = {role: 'owner', invoke: vi.fn(async () => ({}))};
  const runtime = createCompanyManagerRuntime({dataDir: 'C:/company-manager-test', home: 'C:/company-manager-test/hermes', accounts: f.accounts, tools: ownerClient as never, bootstrap: f.bootstrap}, {createEngine: f.createEngine, now: () => 1000}); runtimes.push(runtime);
  await expect(runtime.propose(input)).rejects.toMatchObject({code: 'COMPANY_MANAGER_BLOCKED'}); expect(ownerClient.invoke).not.toHaveBeenCalled(); expect(f.createEngine).not.toHaveBeenCalled();
});
it.each(['followUp', 'compact', 'history'] as const)('denies native %s helper paths without starting a model', async method => {
  const f = fixture({perform: async (entry, run) => {
    const native = entry.catalog;
    if (method === 'followUp') await native.followUp(modelInput(run));
    else if (method === 'compact') await native.compact(run, 'session', run.modelId, accountId);
    else await native.history('session', accountId);
  }}); await expect(f.runtime.propose(input)).rejects.toMatchObject({code: 'COMPANY_MANAGER_MODEL'}); expect(f.nativeStarts).toHaveLength(0);
});
it('retains ownership when a synchronous engine cleanup failure prevents teardown', async () => {
  const f = fixture({perform: async entry => {entry.engine.dispose = (() => {throw Error('secret');}) as typeof entry.engine.dispose; complete(entry);}});
  await expect(f.runtime.propose(input)).rejects.toMatchObject({code: 'COMPANY_MANAGER_CLEANUP'}); await expect(f.runtime.propose(input)).rejects.toMatchObject({code: 'COMPANY_MANAGER_BUSY'});
});
it('rejects background review source events before they can start another native request', async () => {
  const f = fixture({perform: async (entry, run) => {entry.options.onSourceEvent?.({event: 'review_started', ctx: {...run, phase: 'background_review'}}); await entry.catalog.start(modelInput(run)); complete(entry);}});
  await expect(f.runtime.propose(input)).rejects.toMatchObject({code: 'COMPANY_MANAGER_MODEL'}); expect(f.nativeStarts).toHaveLength(0);
});
it('captures native input before awaiting admission so a caller cannot change the actual model during the check', async () => {
  const gate = deferred(), entered = deferred(); let block = false;
  const f = fixture({bootstrap: {authorize: async () => permit(), assertCurrent: async () => {if (block) {entered.resolve(); await gate.promise;}}}, perform: async (entry, run) => {
    const value = modelInput(run); block = true; const starting = entry.catalog.start(value); await entered.promise;
    value.modelId = 'openai-codex/other'; value.thinkingLevel = 'high'; value.accountId = null; gate.resolve(); await starting; complete(entry);
  }});
  await f.runtime.propose(input); expect(f.nativeStarts[0]).toMatchObject({modelId: 'openai-codex/gpt-6.1-sol', accountId, thinkingLevel: 'max'});
});
