import {expect, it} from 'vitest';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCompanyManagerRuntime} from '../packages/company-manager/runtime.ts';
import {COMPANY_MANAGER_MODEL, type CompanyManagerPermit} from '../packages/company-manager/contracts.ts';
import type {RuntimeAdapter, RuntimeCallbacks, StartRun} from '../packages/contracts/index.ts';
import type {RuntimeAccountResolver} from '../packages/contracts/accounts.ts';
import type {createCompanyManagerTools} from '../packages/company-client/index.ts';
import {createHermesEngine} from '../packages/runtime-hermes/index.ts';

// Original embedded Python/Hermes with a SCRIPTED native text adapter. This does
// not authenticate a subscription, admit a live E01, or prove OS containment.
it('composes the actual retained Hermes engine with only the scoped company tool catalog and no helper turns', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'company-original-engine-'));
  const accountId = '79d2709a-c00c-4aa7-99aa-3a87c4da33df';
  const calls: StartRun[] = [];
  const started: {engineClass: unknown; tools: unknown}[] = [];
  const catalogCompletions: unknown[][] = [];
  const content = {summary: 'Synthetic proposal from original Hermes', interpretation: 'Prepare a proposal, without dispatch.', assumptions: ['Native admission is synthetic in this test.'], blockers: [{kind: 'runtime', detail: 'Live company acceptance is unavailable.'}], tasks: [{id: 'inspect', title: 'Inspect approved behavior', instructions: 'Read only approved evidence.', dependsOn: [], proposedEmployeeId: null, sourceRefs: [], deliverable: 'research', requiredEvidence: ['Independent requirement-derived checks']}]};
  const tools = {names: ['status_scoped', 'read_assignment', 'read_artifact'], invoke: async () => ({project_id: 'alpha', employee_id: 'E01', evidence_scope: 'synthetic_only', live_ready: false, assignments: []})} as unknown as ReturnType<typeof createCompanyManagerTools>;
  const accounts: RuntimeAccountResolver = {get: id => id === accountId ? {id, providerId: 'openai-codex', enabled: true, label: 'Synthetic company account', createdAt: '', updatedAt: ''} : null};
  const native = (): RuntimeAdapter => {
    let callbacks!: RuntimeCallbacks;
    return {
      configure: value => {callbacks = value;}, models: async () => [{id: COMPANY_MANAGER_MODEL, provider: 'openai-codex', name: 'SCRIPTED company text adapter', thinkingLevels: ['max']}],
      start: async input => {
        calls.push(structuredClone(input));
        const response = calls.length === 1
          ? '<tool_call>' + JSON.stringify({id: 'company-catalog', type: 'function', function: {name: 'tool_search', arguments: JSON.stringify({queries: ['harness'], limit: 25})}}) + '</tool_call>'
          : JSON.stringify(content);
        callbacks.onEvent({...input, type: 'input.processing', inputIds: [input.inputId]});
        callbacks.onEvent({...input, type: 'assistant.message', content: response});
        callbacks.onEvent({...input, type: 'settled'});
      },
      followUp: async () => {throw new Error('No helper follow-up permitted');}, compact: async () => {throw new Error('No compaction permitted');},
      history: async () => [], cancel: async () => {}, dispose: async () => {},
    };
  };
  const runtime = createCompanyManagerRuntime({dataDir, home: join(dataDir, 'manager-hermes'), accounts, tools, bootstrap: {
    authorize: async () => ({id: 'synthetic-permit', projectId: 'alpha', employeeId: 'E01', machineId: 'synthetic-manager-machine', machineGeneration: 1, accountId, modelId: COMPANY_MANAGER_MODEL, thinkingLevel: 'max', policyRevision: 'synthetic-mandate', receiptDigest: 'a'.repeat(64), issuedAt: Date.now() - 1000, expiresAt: Date.now() + 60000, maxModelRequests: 2, maxToolCalls: 3, maxDurationMs: 60000} satisfies CompanyManagerPermit),
    assertCurrent: async () => {},
  }}, {
    createNativeRuntime: native,
    createEngine: (options, dependencies) => createHermesEngine({...options, onSourceEvent(event) {
      const data = event.data as {engineClass?: unknown; tools?: unknown; args?: unknown} | undefined;
      if (event.event === 'started') started.push({engineClass: data?.engineClass, tools: structuredClone(data?.tools)});
      const args = data?.args;
      if (event.event === 'tool_complete' && Array.isArray(args) && args[1] === 'tool_search') catalogCompletions.push(structuredClone(args));
      options.onSourceEvent?.(event);
    }}, dependencies),
  });
  try {
    const draft = await runtime.propose({requestId: 'synthetic-owner-input', projectId: 'alpha', instruction: 'Prepare a bounded plan. Publish nothing.'});
    expect(draft).toMatchObject({kind: 'local_manager_draft', state: 'unsubmitted', dispatchAuthorized: false, companyReceipt: null, content: {summary: content.summary}});
    // One foreground catalog read, then the proposal; no helper model request.
    expect(calls).toHaveLength(2);
    expect(started).toHaveLength(1);
    expect(started[0].engineClass).toBe('run_agent.AIAgent');
    expect(started[0].tools).toEqual(['tool_call', 'tool_describe', 'tool_search']);
    expect(catalogCompletions).toHaveLength(1);
    expect(catalogCompletions[0][2]).toEqual({queries: ['harness'], limit: 25});
    expect(typeof catalogCompletions[0][3]).toBe('string');
    const catalog = JSON.parse(catalogCompletions[0][3] as string);
    const allowed = ['read_artifact', 'read_assignment', 'status_scoped'];
    expect(catalog.queries).toEqual(['harness']);
    expect(catalog.total_available).toBe(3);
    expect(Object.keys(catalog.tools).sort()).toEqual(allowed);
    expect(catalog.results).toHaveLength(1);
    expect(catalog.results[0].query).toBe('harness');
    expect([...catalog.results[0].matches].sort()).toEqual(allowed);
    for (const name of allowed) expect(catalog.tools[name].source_name).toBe('harness');
    expect(catalog.tools.read_artifact.required).toEqual(['artifact_id']);
    for (const call of calls) expect(call).toMatchObject({modelId: COMPANY_MANAGER_MODEL, thinkingLevel: 'max', accountId, resources: []});
    expect(calls[0].prompt).toContain('knowledgeAvailability');
    expect(calls[0].prompt).not.toContain('skill_manage');
    expect(calls[0].prompt).not.toContain('delegate_task');
  } finally {await runtime.dispose(); await rm(dataDir, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});}
}, 90000);
