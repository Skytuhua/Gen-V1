import Ajv2020, {type AnySchemaObject} from 'ajv/dist/2020.js';
import {z} from 'zod';
import baseManifest from './company-manager.v1.json';
import manifest from './company-manager.commands.v1.json';
import type {CompanyManagerDraft, CompanyManagerProposal} from '../company-manager/contracts.ts';

// Pinned contract candidate only; these exports do not enable backend ingress.
export const COMPANY_PLANNING_CONTRACT_ID = 'maritime-company-manager-commands';
export const COMPANY_PLANNING_CONTRACT_VERSION = '1.0.0-candidate.1';
export const COMPANY_PLANNING_BACKEND_CHECKPOINT = 'b4317f308ca84a26de5cd647706b3f9997cddfd3';
export const COMPANY_PLANNING_MANIFEST_SHA256 = '8ae1a4821077c457173c1231c739df595ffdacc27a75c06e73de66afe0f52bfc';
export const COMPANY_PLANNING_SAMPLES_SHA256 = 'de3a037d21211d19802d6c852f984b654029204801a3eb630944397630248efd';
export const COMPANY_PLANNING_TRANSPORT = Object.freeze({
  requestBytes: manifest.transport.max_request_bytes,
  responseBytes: manifest.transport.max_response_bytes,
  routes: Object.freeze({
    setMandate: '/company-manager/v1/mandate/set',
    recordIntake: '/company-manager/v1/intake/record',
    submitProposal: '/company-manager/v1/proposal/submit',
    reviewProposal: '/company-manager/v1/proposal/review',
    planningContext: '/company-manager/v1/planning-context',
  }),
});

export type PlanningRecordType = 'mandate' | 'intake' | 'proposal' | 'proposal_review';
export interface PlanningRecordRef<Type extends PlanningRecordType = PlanningRecordType> {
  type: Type; id: string; scope: {kind: 'project'; id: string}; revision: number; digest: string;
}
export interface PlanningMandate {goals: string[]; non_goals: string[]; constraints: string[]; prohibitions: string[]}
export interface PlanningIntake {client_request_id: string; instruction: string; success_criteria: string[]; constraints: string[]}
export type PlanningLocalDraft = CompanyManagerDraft;
export type PlanningProposalContent = CompanyManagerProposal;
export type PlanningDecision = 'reviewed' | 'changes_requested' | 'rejected';
export interface PlanningIntakeBody {mandate_ref: PlanningRecordRef<'mandate'>; intake: PlanningIntake}
export interface PlanningProposalBody {
  mandate_ref: PlanningRecordRef<'mandate'>; intake_ref: PlanningRecordRef<'intake'>; local_draft: PlanningLocalDraft;
}
export interface PlanningReviewBody {
  proposal_ref: PlanningRecordRef<'proposal'>; mandate_ref: PlanningRecordRef<'mandate'>;
  intake_ref: PlanningRecordRef<'intake'>; decision: PlanningDecision; feedback: string;
}
interface RecordBase<Type extends PlanningRecordType, Body, Origin extends string> {
  ref: PlanningRecordRef<Type>; previous_digest: string | null; body: Body;
  recorded_by: string; recorded_at: number; origin: Origin; authority: 'planning_only';
  execution_authorized: false; dispatch_authorized: false; work_order_id: null;
  native_provenance: {employee_id: null; machine_id: null; model_id: null; native_admission: 'unavailable'};
}
export type PlanningMandateRecord = RecordBase<'mandate', PlanningMandate, 'authenticated_owner_input'>;
export type PlanningIntakeRecord = RecordBase<'intake', PlanningIntakeBody, 'authenticated_owner_input'>;
export type PlanningProposalRecord = RecordBase<'proposal', PlanningProposalBody, 'owner_forwarded_unverified_local_draft'>;
export type PlanningReviewRecord = RecordBase<'proposal_review', PlanningReviewBody, 'authenticated_owner_review'>;
export type PlanningRecord = PlanningMandateRecord | PlanningIntakeRecord | PlanningProposalRecord | PlanningReviewRecord;
interface MutationInput {project_id: string; message_id: string}
export interface MandateSetInput extends MutationInput {expected_head_digest: string | null; mandate: PlanningMandate}
export interface IntakeRecordInput extends MutationInput {
  intake_id: string | null; expected_head_digest: string | null; mandate_ref: PlanningRecordRef<'mandate'>; intake: PlanningIntake;
}
export interface ProposalSubmitInput extends MutationInput {
  proposal_id: string | null; expected_head_digest: string | null; mandate_ref: PlanningRecordRef<'mandate'>;
  intake_ref: PlanningRecordRef<'intake'>; local_draft: PlanningLocalDraft;
}
export interface ProposalReviewInput extends MutationInput, PlanningReviewBody {expected_review_digest: string | null}
export interface PlanningContextInput {project_id: string; record_ref: PlanningRecordRef | null}
export type PlanningOperation = 'mandate_set' | 'intake_record' | 'proposal_submit' | 'proposal_review';
export interface PlanningStorageReceipt<Operation extends PlanningOperation = PlanningOperation, Type extends PlanningRecordType = PlanningRecordType> {
  type: 'planning_storage_receipt'; id: string; scope: {kind: 'project'; id: string}; operation: Operation;
  record_ref: PlanningRecordRef<Type>; request_digest: string; committed_at: number;
  evidence_scope: 'authenticated_service_storage'; authority: 'planning_only';
  execution_authorized: false; dispatch_authorized: false; work_order_id: null;
}
interface PlanningEnvelope {contract_id: typeof COMPANY_PLANNING_CONTRACT_ID; contract_version: typeof COMPANY_PLANNING_CONTRACT_VERSION}
interface MutationResponse<Operation extends PlanningOperation, Type extends PlanningRecordType> extends PlanningEnvelope {
  receipt: PlanningStorageReceipt<Operation, Type>;
}
export type MandateSetResponse = MutationResponse<'mandate_set', 'mandate'>;
export type IntakeRecordResponse = MutationResponse<'intake_record', 'intake'>;
export type ProposalSubmitResponse = MutationResponse<'proposal_submit', 'proposal'>;
export type ProposalReviewResponse = MutationResponse<'proposal_review', 'proposal_review'>;
export interface PlanningLinkedRefs {
  mandate_ref: PlanningRecordRef<'mandate'> | null; intake_ref: PlanningRecordRef<'intake'> | null; proposal_ref: PlanningRecordRef<'proposal'> | null;
}
export interface PlanningLatestReview {
  ref: PlanningRecordRef<'proposal_review'>; proposal_ref: PlanningRecordRef<'proposal'>;
  mandate_ref: PlanningRecordRef<'mandate'>; intake_ref: PlanningRecordRef<'intake'>;
  decision: PlanningDecision; recorded_at: number;
}
export interface PlanningRecordView {
  record: PlanningRecord; current_head_ref: PlanningRecordRef; currentness: 'current' | 'superseded' | 'stale';
  state: 'recorded' | 'submitted' | PlanningDecision; linked_refs: PlanningLinkedRefs;
  basis_current: boolean; latest_review: PlanningLatestReview | null;
}
export interface PlanningContextResponse extends PlanningEnvelope {
  project_id: string; status: 'recorded' | 'not_recorded'; view: PlanningRecordView | null;
  unavailable: ['company_wide_mandates', 'unregistered_project_intake', 'work_order_admission', 'history_listing', 'native_admission_provenance'];
}
export type PlanningWireErrorCode = keyof typeof manifest.http_errors;
export interface PlanningErrorResponse {error: {code: PlanningWireErrorCode}}
export const COMPANY_PLANNING_HTTP_ERRORS: Readonly<Record<PlanningWireErrorCode, number>> = Object.freeze({...manifest.http_errors});

// One draft-2020-12 bundle per AJV instance, including its exact dependency.
// Runtime invariants only tighten these schemas; no alternate shape is maintained.
const ajv = new Ajv2020({strict: true, allErrors: true});
ajv.addSchema(baseManifest.json_schema as AnySchemaObject);
ajv.addSchema(manifest.json_schema as AnySchemaObject);
const bodyBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8') <= 65536;
function strictUnicode(value: unknown): boolean {
  // Python's ensure_ascii=False with strict UTF-8 rejects isolated surrogates.
  const invalid = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  const pending: unknown[] = [value];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === 'string' && invalid.test(item)) return false;
    if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {if (invalid.test(key)) return false; pending.push(child);}
    }
  }
  return true;
}
function schema<T>(definition: keyof typeof manifest.json_schema.$defs, invariant: (value: T) => boolean = () => true): z.ZodType<T> {
  const validate = ajv.getSchema(`${manifest.json_schema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error('Company planning candidate schema is missing.');
  return z.custom<T>((value: unknown) => {try {return validate(value) === true && strictUnicode(value) && invariant(value as T);} catch {return false;}});
}
function refsInProject(value: unknown, project: string): boolean {
  const pending: unknown[] = [value];
  while (pending.length) {
    const item = pending.pop();
    if (item && typeof item === 'object') {
      if ('scope' in item && (item as PlanningRecordRef).scope.id !== project) return false;
      pending.push(...Object.values(item));
    }
  }
  return true;
}
function validDraft(draft: PlanningLocalDraft): boolean {
  if (!bodyBytes(draft.content)) return false;
  const tasks = new Map(draft.content.tasks.map(task => [task.id, task]));
  if (tasks.size !== draft.content.tasks.length) return false;
  const sources = new Set(draft.sourceRefs), complete = new Set<string>(), active = new Set<string>();
  const visit = (id: string): boolean => {
    if (complete.has(id)) return true;
    const task = tasks.get(id);
    if (!task || active.has(id) || task.sourceRefs.some(ref => !sources.has(ref))) return false;
    active.add(id);
    if (!task.dependsOn.every(visit)) return false;
    active.delete(id); complete.add(id); return true;
  };
  return [...tasks.keys()].every(visit);
}
function validRecord(record: PlanningRecord): boolean {
  if (!refsInProject(record, record.ref.scope.id)) return false;
  if ('local_draft' in record.body) return record.body.local_draft.projectId === record.ref.scope.id && validDraft(record.body.local_draft);
  if ('intake' in record.body) return bodyBytes(record.body.intake);
  if ('goals' in record.body) return bodyBytes(record.body);
  return true;
}
export function planningRefsEqual(left: PlanningRecordRef | null, right: PlanningRecordRef | null): boolean {
  return left === null || right === null ? left === right : left.type === right.type && left.id === right.id &&
    left.scope.kind === right.scope.kind && left.scope.id === right.scope.id && left.revision === right.revision && left.digest === right.digest;
}
function validView(view: PlanningRecordView): boolean {
  const {record, current_head_ref: head, latest_review: review} = view, ref = record.ref;
  if (!validRecord(record) || !refsInProject(view, ref.scope.id) || head.type !== ref.type || head.id !== ref.id || head.revision < ref.revision) return false;
  const same = planningRefsEqual(ref, head);
  if (same ? view.currentness !== (view.basis_current ? 'current' : 'stale') : view.currentness !== 'superseded' || head.revision <= ref.revision || head.digest === ref.digest) return false;
  const expected: PlanningLinkedRefs = {
    mandate_ref: 'mandate_ref' in record.body ? record.body.mandate_ref : record.ref as PlanningRecordRef<'mandate'>,
    intake_ref: 'intake_ref' in record.body ? record.body.intake_ref : ref.type === 'intake' ? ref as PlanningRecordRef<'intake'> : null,
    proposal_ref: 'proposal_ref' in record.body ? record.body.proposal_ref : ref.type === 'proposal' ? ref as PlanningRecordRef<'proposal'> : null,
  };
  if (!planningRefsEqual(expected.mandate_ref, view.linked_refs.mandate_ref) || !planningRefsEqual(expected.intake_ref, view.linked_refs.intake_ref) || !planningRefsEqual(expected.proposal_ref, view.linked_refs.proposal_ref)) return false;
  if (review && (!planningRefsEqual(review.proposal_ref, expected.proposal_ref) || !planningRefsEqual(review.mandate_ref, expected.mandate_ref) || !planningRefsEqual(review.intake_ref, expected.intake_ref))) return false;
  return true;
}

export const LocalDraftSchema = schema<PlanningLocalDraft>('LocalDraft', validDraft);
export const PlanningRecordSchema = schema<PlanningRecord>('TypedRecord', validRecord);
export const MandateSetInputSchema = schema<MandateSetInput>('MandateSetRequest', value => bodyBytes(value.mandate));
export const IntakeRecordInputSchema = schema<IntakeRecordInput>('IntakeRecordRequest', value => refsInProject(value, value.project_id) && bodyBytes(value.intake));
export const ProposalSubmitInputSchema = schema<ProposalSubmitInput>('ProposalSubmitRequest', value => refsInProject(value, value.project_id) && value.local_draft.projectId === value.project_id && validDraft(value.local_draft));
export const ProposalReviewInputSchema = schema<ProposalReviewInput>('ProposalReviewRequest', value => refsInProject(value, value.project_id));
export const PlanningContextInputSchema = schema<PlanningContextInput>('PlanningContextRequest', value => refsInProject(value, value.project_id));
export const MandateSetResponseSchema = schema<MandateSetResponse>('MandateSetResponse');
export const IntakeRecordResponseSchema = schema<IntakeRecordResponse>('IntakeRecordResponse');
export const ProposalSubmitResponseSchema = schema<ProposalSubmitResponse>('ProposalSubmitResponse');
export const ProposalReviewResponseSchema = schema<ProposalReviewResponse>('ProposalReviewResponse');
export const PlanningContextResponseSchema = schema<PlanningContextResponse>('PlanningContextResponse', value => value.view === null || refsInProject(value.view, value.project_id) && validView(value.view));
export const PlanningErrorResponseSchema = schema<PlanningErrorResponse>('Error');

// Receipts establish historical storage only. The server request digest is opaque;
// a local draft digest never substitutes for that or the canonical record digest.
export function planningReceiptMatchesRequest(
  input: MandateSetInput | IntakeRecordInput | ProposalSubmitInput | ProposalReviewInput,
  value: MandateSetResponse | IntakeRecordResponse | ProposalSubmitResponse | ProposalReviewResponse,
): boolean {
  const {receipt} = value;
  if (receipt.scope.id !== input.project_id || receipt.record_ref.scope.id !== input.project_id) return false;
  const previous = 'expected_review_digest' in input ? input.expected_review_digest : input.expected_head_digest;
  if (receipt.record_ref.digest === previous) return false;
  if ('mandate' in input) return receipt.operation === 'mandate_set' && receipt.record_ref.type === 'mandate' && (input.expected_head_digest === null ? receipt.record_ref.revision === 1 : receipt.record_ref.revision > 1);
  if ('intake' in input) return receipt.operation === 'intake_record' && receipt.record_ref.type === 'intake' && (input.intake_id === null ? receipt.record_ref.revision === 1 : receipt.record_ref.id === input.intake_id && receipt.record_ref.revision > 1);
  if ('local_draft' in input) return receipt.operation === 'proposal_submit' && receipt.record_ref.type === 'proposal' && (input.proposal_id === null ? receipt.record_ref.revision === 1 : receipt.record_ref.id === input.proposal_id && receipt.record_ref.revision > 1);
  return receipt.operation === 'proposal_review' && receipt.record_ref.type === 'proposal_review' && (input.expected_review_digest === null ? receipt.record_ref.revision === 1 : receipt.record_ref.revision > 1);
}
export function planningContextMatchesRequest(input: PlanningContextInput, value: PlanningContextResponse): boolean {
  if (value.project_id !== input.project_id) return false;
  if (value.view === null) return input.record_ref === null && value.status === 'not_recorded';
  if (input.record_ref) return planningRefsEqual(input.record_ref, value.view.record.ref);
  return value.view.record.ref.type === 'mandate' && value.view.currentness === 'current';
}
