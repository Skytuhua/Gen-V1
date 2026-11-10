import * as validators from './generated/work-plan.ts';
import {decodeBoundedJson, type JsonValue} from './communications/json.ts';

export const WORK_PLAN_PIN = Object.freeze({contract: 'maritime-owner-work-plan', version: '1.0.0-candidate.1', backendCheckpoint: '9eaf24ed2f20a8cabf76d6f6e2d07a0a18923841',
  manifestSHA256: '046444e1ed6596cbb3ec23037dafdcbafe8dae6720a7605809c2419f18564742', schemaSHA256: '62d9c2a8c2c563fec056fd73aae7090c385e82bddece214400fdb989ba661e49',
  examplesSHA256: '6cb796594481989f07713cde2a60b80f796d0d6d4ad831fb39c695819a86ec64', requestBytes: 32768, responseBytes: 262144, sameHostOnly: true});
export const WORK_PLAN_ERRORS = Object.freeze({invalid_request: 400, authentication_required: 401, scope_denied: 403, not_found: 404, stale_plan: 409, stale_basis: 409, command_conflict: 409,
  already_authorized: 409, authorization_expired: 409, scoped_replanning_unavailable: 409, prerequisite_unavailable: 503, request_timeout: 408, request_too_large: 413, unsupported_media_type: 415});
export type WorkPlanErrorCode = keyof typeof WORK_PLAN_ERRORS | 'CONFIG' | 'REQUEST' | 'RESPONSE' | 'TIMEOUT' | 'ABORTED' | 'TRANSPORT';
export class WorkPlanError extends Error {constructor(readonly code: WorkPlanErrorCode, readonly status?: number) {super(code); this.name = 'WorkPlanError';}}
export type WorkPlanOperation = 'propose' | 'read' | 'authorize';
export type WorkPlanEmployee = 'E01' | 'E10' | 'E11';
export interface WorkPlanRef {kind: 'work_plan'; id: string; project_id: string; revision: number; digest: string}
export interface WorkPlanBody {summary: string; employee_ids: WorkPlanEmployee[]; budget_cents: number; steps: {key: string; employee_id: WorkPlanEmployee; instruction: string; depends_on: string[]; expected_artifact_types: ('code'|'report'|'test_evidence')[]; acceptance_checks: string[]}[]; repository_inputs: {repository: string; revision: string; paths: string[]}[]}
interface LegacyInstruction {id: string; project_id: string; instruction: string; kind: 'planning_proposal'; state: 'planning_only'; planner: 'capability_missing'; model_produced: false; dispatch_authorized: false; live_ready: false; evidence_scope: 'local_owner_instruction'; blockers: string[]}
export interface WorkPlanRecord {kind: 'work_plan'; schema_version: 1; id: string; company_id: string; project_id: string; instruction_id: string; revision: number; previous_digest: string|null; owner_principal: string; recorded_at_epoch_seconds: number; origin: 'owner_forwarded_unverified_plan';
  basis: {instruction: {id: string; project_id: string; digest: string; record: LegacyInstruction}; charter: {digest: string; spec: {id: string; name: string; purpose: string; manager: string; repositories: string[]; permitted_paths: string[]; state: 'proposed'; acceptance_checks: string[]; priority: 'high'|'normal'|'low'; budget_cents: number}}; staffing: {employee_id: WorkPlanEmployee; responsibility: string; approval_id: string; approval_digest: string; expires_at_epoch_seconds: number}[]; policy_version: 1}; plan: WorkPlanBody; digest: string}
export interface WorkPlanProposeRequest {project_id: string; message_id: string; instruction_id: string; expected_head_ref: WorkPlanRef|null; plan: WorkPlanBody}
export interface WorkPlanReadRequest {project_id: string; instruction_id: string; plan_ref: WorkPlanRef|null}
export interface WorkPlanAuthorizeRequest {project_id: string; message_id: string; plan_ref: WorkPlanRef; expires_at_epoch_seconds: number}
interface Receipt {kind: 'work_plan_receipt'; id: string; action: 'work_plan.propose'|'work_plan.authorize'; company_id: string; project_id: string; principal_id: string; command_id: string; request_digest: string; plan_ref: WorkPlanRef; accepted_at_epoch_seconds: number; work_order_stored: boolean; work_order_id: string|null; work_order_digest: string|null; task_materialization: false; dispatch_authorized: false; live_ready: false; digest: string}
interface WorkOrderRecord {work_order_id: string; scope: {kind: 'project'; id: string}; employee_ids: WorkPlanEmployee[]; budget_cents: number}
export interface WorkPlanAuthorization {kind: 'work_plan_authorization'; schema_version: 1; id: string; company_id: string; project_id: string; instruction_id: string; plan_ref: WorkPlanRef; owner_principal: string; request: WorkPlanAuthorizeRequest; request_digest: string; expires_at_epoch_seconds: number; recorded_at_epoch_seconds: number; policy_version: 1;
  owner_approval: {id: string; actor: 'Skytuhua'; action: 'create_work_order'; scope: WorkOrderRecord; audit_ref: string; expires_at: number; policy_version: 1}; work_order: {id: string; record: WorkOrderRecord; digest: string; approval_id: string; expires_at_epoch_seconds: number}; task_materialization: false; dispatch_authorized: false; live_ready: false; digest: string}
export interface WorkPlanProposeResponse {schema_version: 1; plan: WorkPlanRecord; receipt: Receipt & {action: 'work_plan.propose'; work_order_stored: false; work_order_id: null; work_order_digest: null}}
export interface WorkPlanAuthorizeResponse {schema_version: 1; authorization: WorkPlanAuthorization; receipt: Receipt & {action: 'work_plan.authorize'; work_order_stored: true; work_order_id: string; work_order_digest: string}}
export interface WorkPlanReadResponse {schema_version: 1; plan: WorkPlanRecord; current_head_ref: WorkPlanRef; eligibility: {is_current: boolean; basis_current: boolean; can_authorize: boolean; authorization_current: boolean; blockers: string[]; task_materialization: false; dispatch_authorized: false; live_ready: false; execution_blockers: string[]}; authorization: WorkPlanAuthorizeResponse|null}
export interface WorkPlanRequests {propose: WorkPlanProposeRequest; read: WorkPlanReadRequest; authorize: WorkPlanAuthorizeRequest}
export interface WorkPlanResponses {propose: WorkPlanProposeResponse; read: WorkPlanReadResponse; authorize: WorkPlanAuthorizeResponse}

const encoder = new TextEncoder();
const names = {propose: ['ProposeRequest', 'ProposeResponse'], read: ['ReadRequest', 'ReadResponse'], authorize: ['AuthorizeRequest', 'AuthorizeResponse']} as const;
const requireValue = (condition: unknown): void => {if (!condition) throw new WorkPlanError('RESPONSE');};
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function unicode(value: string) {for (let at = 0; at < value.length; at++) {const code = value.charCodeAt(at); if (code >= 0xd800 && code <= 0xdbff) {const low = value.charCodeAt(++at); requireValue(low >= 0xdc00 && low <= 0xdfff);} else requireValue(code < 0xdc00 || code > 0xdfff);}}
function wire(value: unknown, depth = 0): void {
  requireValue(depth <= 64);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {requireValue(Number.isSafeInteger(value)); return;}
  if (typeof value === 'string') {unicode(value); return;}
  requireValue(Array.isArray(value) || object(value));
  if (Array.isArray(value)) for (const child of value) wire(child, depth + 1);
  else for (const [key, child] of Object.entries(value as object)) {unicode(key); wire(child, depth + 1);}
}
function pointOrder(left: string, right: string) {const a = Array.from(left, c => c.codePointAt(0)!), b = Array.from(right, c => c.codePointAt(0)!); for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length;}
function encode(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(encode).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort(pointOrder).map(key => JSON.stringify(key) + ':' + encode(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export function workPlanCanonicalBytes(value: unknown): Uint8Array {wire(value); return encoder.encode(encode(value));}
export async function workPlanDigest(value: unknown): Promise<string> {const bytes = workPlanCanonicalBytes(value); return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)), byte => byte.toString(16).padStart(2, '0')).join('');}
const same = (left: unknown, right: unknown) => encode(left) === encode(right);
function freeze<T>(value: T): T {if (value && typeof value === 'object') {for (const child of Object.values(value)) freeze(child); Object.freeze(value);} return value;}
/** The new paths preserve the legacy -0→0 rule while all other C01 lexical
 * rejection remains reused unchanged. No frozen codec or contract is modified. */
export function decodeWorkPlanJson(raw: Uint8Array, maximum: 32768|262144): JsonValue {
  requireValue(raw instanceof Uint8Array && raw.byteLength <= maximum);
  let source: string; try {source = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(raw);} catch {throw new WorkPlanError('RESPONSE');}
  let normalized = '', quoted = false, escaped = false;
  for (let at = 0; at < source.length; at++) {
    const char = source[at];
    if (quoted) {normalized += char; if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue;}
    if (char === '"') {quoted = true; normalized += char; continue;}
    if (char === '-' && source[at + 1] === '0' && (at === 0 || /[\s[:,]/.test(source[at - 1])) && (at + 2 === source.length || /[\s,}\]]/.test(source[at + 2]))) {normalized += '0'; at++;} else normalized += char;
  }
  return decodeBoundedJson(encoder.encode(normalized), maximum);
}
const text = (value: string, bytes?: number) => {unicode(value); requireValue(value.trim().length > 0 && !value.includes('\0') && (bytes === undefined || encoder.encode(value).length <= bytes));};
function path(value: string) {text(value, 256); requireValue(!value.startsWith('/') && !value.includes('\\') && !value.includes(':') && value.replace(/\/+$/, '').split('/').every(part => part !== '' && part !== '.' && part !== '..'));}
export function validateWorkPlanBody(input: unknown, charter?: WorkPlanRecord['basis']['charter']['spec']): WorkPlanBody {
  try {
    const plan = structuredClone(input) as WorkPlanBody; wire(plan); requireValue(validators.PlanBody(plan)); text(plan.summary, 2048);
    const keys = new Set<string>(); const dependencies = new Map<string, string[]>();
    for (const step of plan.steps) {requireValue(!keys.has(step.key) && plan.employee_ids.includes(step.employee_id)); keys.add(step.key); dependencies.set(step.key, step.depends_on); text(step.instruction, 2048); step.acceptance_checks.forEach(check => text(check, 1024));}
    const visited = new Set<string>(), visiting = new Set<string>();
    function visit(key: string) {requireValue(keys.has(key) && !visiting.has(key)); if (visited.has(key)) return; visiting.add(key); for (const dependency of dependencies.get(key)!) visit(dependency); visiting.delete(key); visited.add(key);}
    keys.forEach(visit);
    const repositories = new Set<string>();
    for (const repository of plan.repository_inputs) {
      text(repository.repository); requireValue(!repositories.has(repository.repository)); repositories.add(repository.repository);
      if (charter) requireValue(charter.repositories.includes(repository.repository));
      for (const value of repository.paths) {path(value); if (charter) requireValue(charter.permitted_paths.some(allowed => value.replace(/\/+$/, '') === allowed.replace(/\/+$/, '') || value.startsWith(allowed.replace(/\/+$/, '') + '/')));}
    }
    return freeze(plan);
  } catch {throw new WorkPlanError('REQUEST');}
}
export function captureWorkPlanRequest<K extends WorkPlanOperation>(operation: K, input: unknown): {request: WorkPlanRequests[K]; body: string} {
  try {
    requireValue(Object.hasOwn(names, operation));
    const request = (input instanceof Uint8Array ? decodeWorkPlanJson(input, 32768) : structuredClone(input)) as unknown as WorkPlanRequests[K];
    wire(request); requireValue(validators[names[operation][0]](request));
    const ref = operation === 'propose' ? (request as WorkPlanProposeRequest).expected_head_ref : (request as WorkPlanReadRequest | WorkPlanAuthorizeRequest).plan_ref;
    if (ref) requireValue(ref.project_id === request.project_id);
    if (operation === 'propose') validateWorkPlanBody((request as WorkPlanProposeRequest).plan);
    const body = encode(request); requireValue(encoder.encode(body).length <= WORK_PLAN_PIN.requestBytes);
    return freeze({request, body});
  } catch {throw new WorkPlanError('REQUEST');}
}
export const workPlanRef = (record: WorkPlanRecord): WorkPlanRef => ({kind: 'work_plan', id: record.id, project_id: record.project_id, revision: record.revision, digest: record.digest});
async function signed(record: {digest: string}) {const {digest, ...body} = record; requireValue(await workPlanDigest(body) === digest);}
async function planRecord(record: WorkPlanRecord, company: string) {
  await signed(record); requireValue(record.company_id === company);
  requireValue(record.id === 'work-plan-' + await workPlanDigest([record.owner_principal, record.instruction_id]));
  requireValue(record.revision === 1 ? record.previous_digest === null : record.previous_digest !== null);
  const {instruction, charter, staffing} = record.basis;
  requireValue(instruction.id === record.instruction_id && instruction.project_id === record.project_id && instruction.record.id === instruction.id && instruction.record.project_id === record.project_id);
  requireValue(await workPlanDigest(instruction.record) === instruction.digest && await workPlanDigest(charter.spec) === charter.digest && charter.spec.id === record.project_id);
  requireValue(same(staffing.map(item => item.employee_id), record.plan.employee_ids));
  for (const item of staffing) {text(item.responsibility); text(item.approval_id); requireValue(item.expires_at_epoch_seconds > record.recorded_at_epoch_seconds);}
  validateWorkPlanBody(record.plan, charter.spec);
}
async function receipt(value: Receipt, principal: string, project: string, company: string, request: WorkPlanProposeRequest | WorkPlanAuthorizeRequest, action: Receipt['action'], ref: WorkPlanRef, accepted: number) {
  await signed(value); requireValue(value.company_id === company && value.project_id === project && value.principal_id === principal && value.action === action && value.command_id === request.message_id && same(value.plan_ref, ref) && value.accepted_at_epoch_seconds === accepted);
  requireValue(value.request_digest === await workPlanDigest([action, request]) && value.id === 'work-plan-receipt-' + await workPlanDigest([principal, request.message_id]));
}
async function authorize(value: WorkPlanAuthorizeResponse, expected: WorkPlanAuthorizeRequest, company: string, plan?: WorkPlanRecord) {
  const auth = value.authorization, order = auth.work_order, approval = auth.owner_approval;
  await signed(auth); requireValue(auth.company_id === company && auth.project_id === expected.project_id && same(auth.request, expected) && same(auth.plan_ref, expected.plan_ref));
  requireValue(auth.plan_ref.id === 'work-plan-' + await workPlanDigest([auth.owner_principal, auth.instruction_id]));
  const identity = await workPlanDigest([auth.owner_principal, expected.message_id]);
  requireValue(auth.id === 'work-plan-authorization-' + identity && approval.id === 'work-plan-approval-' + identity && order.id === 'work-plan-order-' + await workPlanDigest([auth.owner_principal, expected.message_id, 'work_plan.authorize']));
  requireValue(auth.request_digest === await workPlanDigest(['work_plan.authorize', expected]));
  requireValue(auth.expires_at_epoch_seconds === expected.expires_at_epoch_seconds && auth.recorded_at_epoch_seconds < auth.expires_at_epoch_seconds && auth.expires_at_epoch_seconds <= auth.recorded_at_epoch_seconds + 3600);
  requireValue(order.record.work_order_id === order.id && order.record.scope.id === auth.project_id && order.approval_id === approval.id && order.expires_at_epoch_seconds === auth.expires_at_epoch_seconds);
  requireValue(order.digest === await workPlanDigest(order.record) && same(approval.scope, order.record) && approval.expires_at === auth.expires_at_epoch_seconds && approval.audit_ref === `work-plan:${auth.plan_ref.id}:${auth.plan_ref.revision}:${auth.plan_ref.digest}`);
  await receipt(value.receipt, auth.owner_principal, auth.project_id, company, expected, 'work_plan.authorize', auth.plan_ref, auth.recorded_at_epoch_seconds);
  requireValue(value.receipt.work_order_id === order.id && value.receipt.work_order_digest === order.digest);
  if (plan) requireValue(auth.instruction_id === plan.instruction_id && auth.owner_principal === plan.owner_principal && same(auth.plan_ref, workPlanRef(plan)) && same(order.record.employee_ids, plan.plan.employee_ids) && order.record.budget_cents === plan.plan.budget_cents && auth.recorded_at_epoch_seconds >= plan.recorded_at_epoch_seconds && plan.basis.staffing.every(item => auth.expires_at_epoch_seconds <= item.expires_at_epoch_seconds));
}
export async function validateWorkPlanResponse<K extends WorkPlanOperation>(operation: K, raw: Uint8Array, expectedRequest: unknown, expectedCompanyId = 'leo-company'): Promise<WorkPlanResponses[K]> {
  try {
    const {request} = captureWorkPlanRequest(operation, expectedRequest); requireValue(validators.ProjectId(expectedCompanyId));
    const value = decodeWorkPlanJson(raw, 262144) as unknown as WorkPlanResponses[K]; wire(value); requireValue(validators[names[operation][1]](value));
    requireValue(workPlanCanonicalBytes(value).length <= WORK_PLAN_PIN.responseBytes);
    if (operation === 'authorize') await authorize(value as WorkPlanAuthorizeResponse, request as WorkPlanAuthorizeRequest, expectedCompanyId);
    else {
      const result = value as WorkPlanProposeResponse | WorkPlanReadResponse, wanted = request as WorkPlanProposeRequest | WorkPlanReadRequest;
      await planRecord(result.plan, expectedCompanyId); requireValue(result.plan.project_id === wanted.project_id && result.plan.instruction_id === wanted.instruction_id);
      if (operation === 'propose') {
        const proposal = value as WorkPlanProposeResponse, input = request as WorkPlanProposeRequest, prior = input.expected_head_ref;
        requireValue(same(proposal.plan.plan, input.plan));
        requireValue(prior ? proposal.plan.id === prior.id && proposal.plan.revision === prior.revision + 1 && proposal.plan.previous_digest === prior.digest : proposal.plan.revision === 1 && proposal.plan.previous_digest === null);
        await receipt(proposal.receipt, proposal.plan.owner_principal, input.project_id, expectedCompanyId, input, 'work_plan.propose', workPlanRef(proposal.plan), proposal.plan.recorded_at_epoch_seconds);
      } else {
        const read = value as WorkPlanReadResponse, input = request as WorkPlanReadRequest, current = same(read.current_head_ref, workPlanRef(read.plan)), eligible = read.eligibility;
        if (input.plan_ref) requireValue(same(input.plan_ref, workPlanRef(read.plan))); else requireValue(current);
        requireValue(read.current_head_ref.project_id === input.project_id && read.current_head_ref.id === read.plan.id && read.current_head_ref.revision >= read.plan.revision && (read.current_head_ref.revision !== read.plan.revision || current));
        requireValue(eligible.is_current === current && eligible.blockers.includes('stale_plan') === !current && eligible.blockers.includes('stale_basis') === !eligible.basis_current);
        if (read.authorization) {await authorize(read.authorization, read.authorization.authorization.request, expectedCompanyId, read.plan); requireValue(eligible.blockers.includes('already_authorized'));}
        else requireValue(!eligible.authorization_current && !eligible.blockers.includes('already_authorized') && !eligible.blockers.includes('authorization_expired'));
        requireValue(eligible.can_authorize === (current && eligible.basis_current && !read.authorization && eligible.blockers.length === 0));
        if (eligible.authorization_current) requireValue(read.authorization && current && eligible.basis_current && !eligible.blockers.includes('authorization_expired') && !eligible.blockers.includes('prerequisite_unavailable'));
      }
    }
    return freeze(value);
  } catch {throw new WorkPlanError('RESPONSE');}
}
export function validateWorkPlanError(raw: Uint8Array, status: number): WorkPlanError {
  try {const value = decodeWorkPlanJson(raw, 262144) as unknown as {schema_version: 1; error: {code: keyof typeof WORK_PLAN_ERRORS}}; requireValue(validators.Error(value) && WORK_PLAN_ERRORS[value.error.code] === status); return new WorkPlanError(value.error.code, status);}
  catch {return new WorkPlanError('RESPONSE');}
}
