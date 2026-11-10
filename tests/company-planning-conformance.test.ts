import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import Ajv2020, {type AnySchemaObject} from 'ajv/dist/2020.js';
import {describe, expect, it} from 'vitest';
import base from '../packages/company-contracts/company-manager.v1.json';
import manifest from '../packages/company-contracts/company-manager.commands.v1.json';
import samples from '../packages/company-contracts/company-manager.commands.v1.samples.json';
import {
  COMPANY_PLANNING_BACKEND_CHECKPOINT, COMPANY_PLANNING_MANIFEST_SHA256, COMPANY_PLANNING_SAMPLES_SHA256,
  COMPANY_PLANNING_TRANSPORT, MandateSetInputSchema, MandateSetResponseSchema, IntakeRecordInputSchema,
  IntakeRecordResponseSchema, ProposalSubmitInputSchema, ProposalSubmitResponseSchema, ProposalReviewInputSchema,
  ProposalReviewResponseSchema, PlanningContextInputSchema, PlanningContextResponseSchema, LocalDraftSchema,
  PlanningRecordSchema, PlanningErrorResponseSchema,
} from '../packages/company-contracts/planning.ts';
import {createManagerDraft} from '../packages/company-manager/proposals.ts';
import {COMPANY_TRANSPORT} from '../packages/company-contracts/index.ts';
import {COMPANY_MANAGER_TRANSPORT} from '../packages/company-contracts/manager.ts';

const ajv = new Ajv2020({strict: true, allErrors: true});
ajv.addSchema(base.json_schema as AnySchemaObject);
ajv.addSchema(manifest.json_schema as AnySchemaObject);
const pairs = [
  [MandateSetInputSchema, MandateSetResponseSchema], [IntakeRecordInputSchema, IntakeRecordResponseSchema],
  [ProposalSubmitInputSchema, ProposalSubmitResponseSchema], [ProposalReviewInputSchema, ProposalReviewResponseSchema],
  [PlanningContextInputSchema, PlanningContextResponseSchema],
] as const;

describe('pinned fixed planning commands candidate', () => {
  it('preserves raw candidate bytes, dependency and unavailable backend status', () => {
    for (const [file, hash] of [['company-manager.commands.v1.json', COMPANY_PLANNING_MANIFEST_SHA256], ['company-manager.commands.v1.samples.json', COMPANY_PLANNING_SAMPLES_SHA256]]) {
      const bytes = readFileSync(new URL(`../packages/company-contracts/${file}`, import.meta.url));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash); expect(bytes.includes(13)).toBe(false);
    }
    expect(COMPANY_PLANNING_MANIFEST_SHA256).toBe('8ae1a4821077c457173c1231c739df595ffdacc27a75c06e73de66afe0f52bfc');
    expect(COMPANY_PLANNING_SAMPLES_SHA256).toBe('de3a037d21211d19802d6c852f984b654029204801a3eb630944397630248efd');
    expect(COMPANY_PLANNING_BACKEND_CHECKPOINT).toBe('b4317f308ca84a26de5cd647706b3f9997cddfd3');
    expect(manifest).toMatchObject({implemented: false, stability: 'joint_review_candidate'});
    expect(manifest.transport).toMatchObject({remote_ingress_available: false, employee_credentials_supported: false});
    expect(samples).toMatchObject({fixture_only: true, actual_company_records: false, actual_storage_receipts: false});
    expect(manifest.schema_dependencies[0].schema_id).toBe(base.json_schema.$id);
  });
  it('registers all 35 definitions once with the pinned base dependency', () => {
    expect(Object.keys(manifest.json_schema.$defs)).toHaveLength(35);
    for (const name of Object.keys(manifest.json_schema.$defs)) expect(ajv.getSchema(`${manifest.json_schema.$id}#/$defs/${name}`)).toBeTypeOf('function');
    expect(Object.values(COMPANY_PLANNING_TRANSPORT.routes)).toEqual(manifest.routes.map(route => route.path));
    expect(COMPANY_PLANNING_TRANSPORT).toMatchObject({requestBytes: 131072, responseBytes: 131072});
    expect(Object.keys(COMPANY_TRANSPORT.routes)).toHaveLength(8);
    expect(COMPANY_TRANSPORT).toMatchObject({requestBytes: 32768, responseBytes: 8388608});
    expect(COMPANY_MANAGER_TRANSPORT).toMatchObject({requestBytes: 32768, responseBytes: 262144});
  });
  it('rejects isolated surrogates that Python strict UTF-8 cannot encode without normalizing valid text', () => {
    const request=IntakeRecordInputSchema.parse(samples.examples[1].request);
    for(const instruction of ['bad\ud800','bad\udfff'])expect(IntakeRecordInputSchema.safeParse({...request,intake:{...request.intake,instruction}}).success).toBe(false);
    for(const instruction of ['界'.repeat(16000),'Valid \ud83d\ude80','e\u0301'])expect(IntakeRecordInputSchema.parse({...request,intake:{...request.intake,instruction}}).intake.instruction).toBe(instruction);
    const proposal=ProposalSubmitInputSchema.parse(samples.examples[2].request);
    expect(ProposalSubmitInputSchema.safeParse({...proposal,local_draft:{...proposal.local_draft,policyRevision:'bad\ud800'}}).success).toBe(false);
  });
  samples.examples.forEach((example, index) => it(`validates the exact ${example.operation} sample pair`, () => {
    const [input, output] = pairs[index];
    expect(input.parse(example.request)).toEqual(example.request); expect(output.parse(example.response)).toEqual(example.response);
    expect(ajv.getSchema(`${manifest.json_schema.$id}#/$defs/${example.request_schema}`)!(example.request)).toBe(true);
    expect(ajv.getSchema(`${manifest.json_schema.$id}#/$defs/${example.response_schema}`)!(example.response)).toBe(true);
    expect(input.safeParse({...example.request, authenticated_author: 'owner'}).success).toBe(false);
    expect(output.safeParse({...example.response, execution_authorized: true}).success).toBe(false);
  }));
  it('accepts an actual immutable Gen draft without changing the local digest or provenance', () => {
    const request = ProposalSubmitInputSchema.parse(samples.examples[2].request);
    const draft = createManagerDraft({requestId: request.local_draft.requestId, projectId: 'alpha', instruction: 'Plan only.'}, request.local_draft.content, {permitId: 'permit-local', policyRevision: 'policy-local', sourceRefs: request.local_draft.sourceRefs, createdAt: 100});
    expect(LocalDraftSchema.parse(draft)).toEqual(draft);
    expect(ProposalSubmitInputSchema.parse({...request, local_draft: draft}).local_draft).toEqual(draft);
    expect(LocalDraftSchema.parse({...draft, digest: 'a'.repeat(64)}).digest).toBe('a'.repeat(64));
    for (const change of [{dispatchAuthorized: true}, {state: 'submitted'}, {companyReceipt: {}}, {employeeId: 'E01'}]) expect(LocalDraftSchema.safeParse({...draft, ...change}).success).toBe(false);
  });
  it('enforces bounded bodies, unique acyclic tasks and source membership', () => {
    const draft = LocalDraftSchema.parse(samples.examples[2].request.local_draft);
    const task = draft.content.tasks[0];
    for (const tasks of [
      [task, task], [{...task, dependsOn: [task.id]}], [{...task, dependsOn: ['missing']}],
      [{...task, sourceRefs: ['unobserved']}], [{...task, proposedEmployeeId: 'E01'}],
      [{...task, id: 'a', dependsOn: ['b']}, {...task, id: 'b', dependsOn: ['a']}],
    ]) expect(LocalDraftSchema.safeParse({...draft, content: {...draft.content, tasks}}).success).toBe(false);
    expect(LocalDraftSchema.safeParse({...draft, content: {...draft.content, interpretation: '界'.repeat(16000), summary: '界'.repeat(5000), assumptions: ['界'.repeat(2000)]}}).success).toBe(false);
    const intake = IntakeRecordInputSchema.parse(samples.examples[1].request);
    expect(IntakeRecordInputSchema.safeParse({...intake, intake: {...intake.intake, instruction: '界'.repeat(16000)}}).success).toBe(true);
    expect(IntakeRecordInputSchema.safeParse({...intake, mandate_ref: {...intake.mandate_ref, scope: {kind: 'project', id: 'beta'}}}).success).toBe(false);
    const proposal = ProposalSubmitInputSchema.parse(samples.examples[2].request);
    expect(ProposalSubmitInputSchema.safeParse({...proposal, local_draft: {...draft, projectId: 'beta'}}).success).toBe(false);
  });
  it('retains immutable records and unavailable native provenance', () => {
    for (const example of samples.immutable_record_examples) {
      expect(PlanningRecordSchema.parse(example.dto)).toEqual(example.dto);
      expect(PlanningRecordSchema.safeParse({...example.dto, native_provenance: {employee_id: 'E01', machine_id: null, model_id: null, native_admission: 'unavailable'}}).success).toBe(false);
    }
    expect(PlanningContextResponseSchema.parse(samples.absent_mandate_example.response)).toEqual(samples.absent_mandate_example.response);
    for (const example of samples.error_examples) expect(PlanningErrorResponseSchema.parse(example)).toEqual(example);
    expect(PlanningErrorResponseSchema.safeParse({error: {code: 'snapshot_changed'}}).success).toBe(false);
    expect(PlanningErrorResponseSchema.safeParse({error: {code: 'stale_basis', detail: 'private'}}).success).toBe(false);
  });
});
