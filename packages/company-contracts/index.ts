import { z } from 'zod';

// Existing local synthetic service, not a claim of a live company deployment.
export const COMPANY_PROTOCOL = 'company-service.v1-draft1';
export const COMPANY_SERVICE_BASELINE = '770b56620a6a8587a8c9e8e321e8c731cbb35807';
export const COMPANY_BACKEND_CHECKPOINT = 'bcb9ee7c6196243b2647e917a1ccb7b1d0793770';
export const COMPANY_MANIFEST_SHA256 = '80fcc2f4cddafaeb7811eb3d195f908ff974f06e79e3ca79d680188e4b1aad4c';
export const COMPANY_TRANSPORT = Object.freeze({
  // responseBytes is this client's local bound. The candidate service advertises
  // neither a complete-response size guarantee nor pagination.
  requestBytes: 32768, responseBytes: 8 * 1024 * 1024,
  defaultTimeoutMs: 3000, maxTimeoutMs: 10000,
  routes: Object.freeze({
    status: '/v1/status', plan: '/v1/owner/plan', start: '/v1/owner/start',
    pause: '/v1/owner/pause', cancel: '/v1/owner/cancel', employeeTool: '/v1/employee/tool',
    artifactPreview: '/v1/artifacts/preview', reviewPackage: '/v1/review/package',
  }),
});
export type CompanyRole = 'owner' | 'employee';
const text = (maximum: number) => z.string().max(maximum).refine(value => value.trim().length > 0 && !value.includes('\0'));
const id = text(128);
export const CompanyProjectIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/).refine(value => value !== 'company-ops' && value === value.trim());
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const labels = z.array(text(1024)).max(1024);
export const CompanyScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('project'), id: CompanyProjectIdSchema }).strict(),
  z.object({ kind: z.literal('company'), id: z.literal('leo-company') }).strict(),
]);
export type CompanyScope = z.infer<typeof CompanyScopeSchema>;
export const StatusInputSchema = z.object({ scope: CompanyScopeSchema }).strict();
export const OwnerPlanInputSchema = z.object({ project_id: CompanyProjectIdSchema, instruction: text(16000), message_id: id }).strict();
export const OwnerStartInputSchema = z.union([
  z.object({ project_id: CompanyProjectIdSchema, proposal_id: id, message_id: id }).strict(),
  z.object({ project_id: CompanyProjectIdSchema, work_order_id: id, message_id: id }).strict(),
]);
export const OwnerControlInputSchema = z.object({ project_id: CompanyProjectIdSchema, message_id: id }).strict();
export const ArtifactPreviewInputSchema = z.object({ project_id: CompanyProjectIdSchema, artifact_id: id }).strict();
export const ReviewPackageInputSchema = z.object({ project_id: CompanyProjectIdSchema, work_order_id: id }).strict();
// Deliberate read-only subset of the service: finance_aggregates and mutating
// handoff remain unavailable to the initial E01 manager broker.
export const EmployeeToolInputSchema = z.discriminatedUnion('tool', [
  z.object({ project_id: CompanyProjectIdSchema, tool: z.literal('status_scoped'), arguments: z.object({}).strict() }).strict(),
  z.object({ project_id: CompanyProjectIdSchema, tool: z.literal('read_assignment'), arguments: z.object({}).strict() }).strict(),
  z.object({ project_id: CompanyProjectIdSchema, tool: z.literal('read_artifact'), arguments: z.object({ artifact_id: id }).strict() }).strict(),
]);
export type OwnerPlanInput = z.infer<typeof OwnerPlanInputSchema>;
export type OwnerStartInput = z.infer<typeof OwnerStartInputSchema>;
export type OwnerControlInput = z.infer<typeof OwnerControlInputSchema>;
export type ArtifactPreviewInput = z.infer<typeof ArtifactPreviewInputSchema>;
export type ReviewPackageInput = z.infer<typeof ReviewPackageInputSchema>;
export type EmployeeToolInput = z.infer<typeof EmployeeToolInputSchema>;

export const CompanyObservationSchema = z.object({
  status: z.enum(['unavailable', 'observed', 'blocked', 'stale']),
  observed_at: z.number().finite().nullable(), expires_at: z.number().finite().nullable(), evidence_scope: text(1024),
});
export type CompanyObservation = z.infer<typeof CompanyObservationSchema>;
export const CompanyProjectSchema = z.object({
  id: CompanyProjectIdSchema, name: text(1024), state: text(128), scheduler_paused: z.boolean(),
  task_counts: z.record(z.string(), count), occupied_synthetic_slots: count,
  // Additive read-only marketing records are data, never executable operations.
  marketing: z.json().optional(),
});
export type CompanyProject = z.infer<typeof CompanyProjectSchema>;
export const CompanyEmployeeSchema = z.object({
  id, department: id, state: z.literal('planned_unverified'), target_runtime: z.enum(['hermes', 'codex']),
  effective_runtime: z.null(), required_model: text(128), required_reasoning: z.enum(['max', 'xhigh']),
  effective_model: z.null(), effective_reasoning: z.null(),
  required_route: z.object({ provider: z.literal('openai-codex'), billing_route: z.literal('subscription'), fallbacks: z.array(z.never()).length(0) }),
  effective_route: z.null(), required_mode: z.literal('native'), effective_mode: z.null(), effective_config_digest: z.null(),
  configured_profile_version: count, configured_profile_digest: digest,
  synthetic_admission: z.object({ present: z.boolean(), expired: z.boolean(), evidence_scope: z.enum(['synthetic_only', 'unavailable']) }),
  playbooks: z.object({ configured: z.array(text(1024)).max(32), active: z.literal(false), state: z.literal('inactive_pending_evaluation') }),
});
export type CompanyEmployee = z.infer<typeof CompanyEmployeeSchema>;
const runtimeValue = z.json();
export const CompanyStatusSchema = z.object({
  evidence_scope: z.literal('synthetic_only'), live_ready: z.literal(false), company_accepted: z.literal(false),
  planning_mode: z.literal('planning_only'), native_chat_planner: z.literal('capability_missing'),
  targets: z.object({ employees: z.literal(32), departments: z.literal(16), hermes: z.literal(18), codex: z.literal(14) }),
  actual_live: z.object({ employees: z.literal(0), hermes: z.literal(0), codex: z.literal(0) }),
  employees: z.array(CompanyEmployeeSchema).max(32),
  runtime_requirements: z.object({
    source: text(1024),
    hermes: z.object({ mode: runtimeValue, repository: runtimeValue, commit: runtimeValue, compatibility_evidence: runtimeValue, image_digest: runtimeValue }),
    codex: z.object({ mode: runtimeValue, package: runtimeValue, version: runtimeValue, external_auth_candidate_status: runtimeValue, image_digest: runtimeValue }),
  }),
  configured_requirements_digest: digest, configured_company_digest: digest,
  native_limits: z.object({ task_timeout_seconds: count, hermes_iteration_cap: count, codex_turn_cap: count.nullable(), max_child_processes_per_attempt: count, effective_limits: z.null() }),
  auth: CompanyObservationSchema, budget: CompanyObservationSchema,
  projects: z.array(CompanyProjectSchema).max(1024), project: CompanyProjectSchema.optional(), blockers: labels,
});
export type CompanyStatus = z.infer<typeof CompanyStatusSchema>;
export const PlanningProposalSchema = z.object({
  id, project_id: CompanyProjectIdSchema, instruction: text(16000), kind: z.literal('planning_proposal'), state: z.literal('planning_only'),
  planner: z.literal('capability_missing'), model_produced: z.literal(false), dispatch_authorized: z.literal(false),
  live_ready: z.literal(false), evidence_scope: z.literal('local_owner_instruction'), blockers: labels,
});
export const StartResultSchema = z.union([
  z.object({ status: z.literal('capability_missing'), live_ready: z.literal(false), dispatch_authorized: z.literal(false), proposal_id: id, blockers: labels }),
  z.object({ status: z.literal('capability_missing'), live_ready: z.literal(false), dispatch_authorized: z.literal(false), work_order_id: id, blockers: labels }),
]);
export const PauseResultSchema = z.object({ status: z.literal('paused'), project_id: CompanyProjectIdSchema, occupancy_released: z.literal(false) });
export const CancelResultSchema = z.object({
  status: z.enum(['cancelling', 'cancelled']), project_id: CompanyProjectIdSchema, occupied_synthetic_slots: count,
  occupancy_released: z.literal(false), blockers: labels, evidence_scope: z.literal('synthetic_only'),
});
export const ArtifactPreviewSchema = z.object({ artifact_id: id, html: z.string().max(COMPANY_TRANSPORT.responseBytes), evidence_scope: text(1024) });
export const ReviewPackageSchema = z.object({
  synthetic_package_ready: z.boolean(), evidence_scope: z.literal('synthetic_contract'), live_ready: z.literal(false), company_accepted: z.literal(false),
});
export const EmployeeAssignmentSchema = z.object({
  project_id: CompanyProjectIdSchema, employee_id: id, evidence_scope: z.literal('synthetic_only'), live_ready: z.literal(false),
  assignments: z.array(z.object({ task_id: id, state: text(128), work_order_id: id })).max(10000),
});
export const EmployeeFinanceSchema = z.object({ project_id: CompanyProjectIdSchema, approved_budget_cents: count, reserved_cents: count, evidence_scope: z.literal('synthetic_only') });
export const EmployeeStatusSchema = z.union([EmployeeAssignmentSchema, EmployeeFinanceSchema]);
export type EmployeeStatus = z.infer<typeof EmployeeStatusSchema>;
