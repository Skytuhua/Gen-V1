import {describe, expect, it} from 'vitest';
import {CompanyManagerInputSchema, CompanyManagerPermitSchema, COMPANY_MANAGER_MODEL} from '../packages/company-manager/contracts.ts';
import {createManagerDraft, validateManagerProposal} from '../packages/company-manager/proposals.ts';

const proposal = () => ({summary: 'Propose a bounded fix', interpretation: 'Inspect the approved behavior before changing it.', assumptions: ['Repository access is not established.'], blockers: [{kind: 'authorization', detail: 'The company must approve an executable work order.'}], tasks: [{id: 'inspect', title: 'Inspect behavior', instructions: 'Read the approved inputs and report evidence.', dependsOn: [], proposedEmployeeId: null, sourceRefs: ['source-1'], deliverable: 'research', requiredEvidence: ['Requirement-derived check results']} ]});
describe('company manager proposals remain drafts rather than operational authority', () => {
  it('captures company input without accepting model-selected credentials, mode or identity', () => {
    const input = {requestId: 'request-1', projectId: 'alpha', instruction: 'Fix the approved bug, publish nothing.'};
    expect(CompanyManagerInputSchema.parse(input)).toEqual(input);
    for (const extra of [{employeeId: 'E01'}, {accountId: 'other'}, {dispatchAuthorized: true}, {mode: 'execute'}]) expect(CompanyManagerInputSchema.safeParse({...input, ...extra}).success).toBe(false);
    expect(CompanyManagerInputSchema.safeParse({...input, projectId: 'company-ops'}).success).toBe(false);
  });
  it('pins the exact native route, reasoning, account and expiring trusted permit shape', () => {
    const permit = {id: 'permit-1', projectId: 'alpha', employeeId: 'E01', machineId: 'manager-machine', machineGeneration: 1, accountId: '79d2709a-c00c-4aa7-99aa-3a87c4da33df', modelId: COMPANY_MANAGER_MODEL, thinkingLevel: 'max', policyRevision: 'mandate-1', receiptDigest: 'a'.repeat(64), issuedAt: 100, expiresAt: 1000, maxModelRequests: 4, maxToolCalls: 12, maxDurationMs: 5000};
    expect(CompanyManagerPermitSchema.parse(permit)).toEqual(permit);
    for (const changed of [{modelId: 'openai/gpt-6.1-sol'}, {thinkingLevel: 'xhigh'}, {accountId: null}, {employeeId: 'E02'}, {machineGeneration: 0}, {expiresAt: 100}, {maxModelRequests: 0}]) expect(CompanyManagerPermitSchema.safeParse({...permit, ...changed}).success).toBe(false);
  });
  it('rejects cycles, missing dependencies, duplicate tasks and unobserved evidence references', () => {
    expect(validateManagerProposal(JSON.stringify(proposal()), ['source-1']).tasks).toHaveLength(1);
    const cases = [
      {...proposal(), tasks: [{...proposal().tasks[0], dependsOn: ['missing']}]},
      {...proposal(), tasks: [{...proposal().tasks[0], dependsOn: ['inspect']}]},
      {...proposal(), tasks: [proposal().tasks[0], proposal().tasks[0]]},
      {...proposal(), tasks: [{...proposal().tasks[0], sourceRefs: ['private-beta-reference']}]},
      {...proposal(), tasks: [{...proposal().tasks[0], proposedEmployeeId: 'E01'}]},
      {...proposal(), tasks: Array.from({length: 13}, (_, i) => ({...proposal().tasks[0], id: `task-${i}`}))},
      {...proposal(), dispatchAuthorized: true},
    ];
    for (const value of cases) expect(() => validateManagerProposal(JSON.stringify(value), ['source-1'])).toThrow();
    const cycle = {...proposal(), tasks: [{...proposal().tasks[0], id: 'a', dependsOn: ['b']}, {...proposal().tasks[0], id: 'b', dependsOn: ['a']}]};
    expect(() => validateManagerProposal(JSON.stringify(cycle), ['source-1'])).toThrow();
  });
  it('seals project/request/provenance outside model output and never manufactures a company receipt', () => {
    const input = CompanyManagerInputSchema.parse({requestId: 'request-1', projectId: 'alpha', instruction: 'Plan the fix.'});
    const draft = createManagerDraft(input, validateManagerProposal(JSON.stringify(proposal()), ['source-1']), {permitId: 'permit-1', policyRevision: 'mandate-1', sourceRefs: ['source-1'], createdAt: 100});
    expect(draft).toMatchObject({kind: 'local_manager_draft', state: 'unsubmitted', projectId: 'alpha', requestId: 'request-1', dispatchAuthorized: false, companyReceipt: null, authority: 'proposal_only', evidenceScope: 'local_manager_output'});
    expect(draft.id).toBeTruthy(); expect(draft.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(draft)).toBe(true);
  });
  it('rejects malformed, fenced and oversized output without issuing any repair request', () => {
    for (const value of ['not-json', '```json\n{}\n```', ' '.repeat(65537), JSON.stringify({...proposal(), summary: 'x'.repeat(5001)})]) expect(() => validateManagerProposal(value, ['source-1'])).toThrow();
  });
});
