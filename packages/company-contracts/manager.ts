import Ajv2020, { type AnySchemaObject } from 'ajv/dist/2020.js';
import { z } from 'zod';
import manifest from './company-manager.v1.json';

// Reviewed candidate files only. These constants do not enable backend ingress.
export const COMPANY_MANAGER_CONTRACT_ID = 'maritime-company-manager';
export const COMPANY_MANAGER_CONTRACT_VERSION = '1.0.0-candidate.1';
export const COMPANY_MANAGER_BACKEND_CHECKPOINT = 'aca8ec09de5cda73b014a348a05a8f05b43f465b';
export const COMPANY_MANAGER_MANIFEST_SHA256 = 'fb4e7d2eba19275c5d4013576a01d90984c9f716ce9f0d6e1d1b31a15d46a033';
export const COMPANY_MANAGER_SAMPLES_SHA256 = '9402e4279e3f0772d5c3eee22e9dddc4f495d4fb30e2506bf90a738070fff9bd';
export const COMPANY_MANAGER_TRANSPORT = Object.freeze({
  requestBytes: manifest.transport.max_request_bytes,
  responseBytes: manifest.transport.max_response_bytes,
  routes: Object.freeze({
    projectContext: '/company-manager/v1/project-context',
    taskContext: '/company-manager/v1/task-context',
  }),
});

export interface ProjectContextInput { project_id: string; limit: number; cursor: string | null }
export type TaskContextSection = 'dependencies' | 'attempts' | 'artifacts' | 'reviews';
export interface TaskContextInput extends ProjectContextInput { task_id: string; section: TaskContextSection }
export type ContextDigest = { status: 'available'; value: string } | { status: 'unavailable'; value: null };
export interface ContextObservation {
  status: 'recorded' | 'stale' | 'unavailable'; observed_at: number | null;
  source: 'stored_record' | 'synthetic_fixture' | 'unavailable'; evidence_scope: string; live_verified: false;
}
export type ContextEntityType = 'project' | 'task' | 'work_order' | 'employee' | 'attempt' | 'machine' | 'artifact' | 'review_receipt' | 'principal' | 'context_page';
export interface ContextRef<Type extends ContextEntityType = ContextEntityType> {
  type: Type; id: string; scope: { kind: 'project'; id: string };
  digests: { revision: ContextDigest; input: ContextDigest; binding: ContextDigest; content: ContextDigest };
  observation: ContextObservation;
}
export interface ContextProject {
  entity: ContextRef<'project'>; name: string; purpose: string; state: string; manager: ContextRef<'employee'>;
  repositories: { repository: string; relative_paths: string[] }[];
  staffing: { employee: ContextRef<'employee'>; responsibility: string }[];
}
export interface ContextTask { entity: ContextRef<'task'>; work_order: ContextRef<'work_order'>; employee: ContextRef<'employee'>; state: string }
export interface ContextDependency { entity: ContextRef<'task'>; expected_target_digest: ContextDigest; state: string }
export interface ContextAttempt {
  entity: ContextRef<'attempt'>; task: ContextRef<'task'>; employee: ContextRef<'employee'>;
  machine: ContextRef<'machine'>; generation: number; state: string;
}
interface ArtifactMetadata {
  entity: ContextRef<'artifact'>; filename: string; media_type: string; size_bytes: number;
  classification: 'private'; media_verification: 'unavailable';
}
export type ContextArtifact = ArtifactMetadata & ({
  origin: 'employee_attempt'; task: ContextRef<'task'>; attempt: ContextRef<'attempt'>;
  employee: ContextRef<'employee'>; machine: ContextRef<'machine'>; generation: number;
  producer: null; derivation_digest: { status: 'unavailable'; value: null };
} | {
  origin: 'control_service'; task: null; attempt: null; employee: null; machine: null; generation: null;
  producer: ContextRef<'principal'>; derivation_digest: { status: 'available'; value: string };
});
export interface ContextReview {
  entity: ContextRef<'review_receipt'>; task: ContextRef<'task'>; target_digest: string;
  target_status: 'current' | 'stale' | 'unavailable'; review_attempt: ContextRef<'attempt'>;
  checks: { check_id: string; outcome: 'pass' | 'fail' | 'blocked'; artifact: ContextRef<'artifact'> }[];
  acceptance: 'not_inferred';
}
export interface ContextPage {
  entity: ContextRef<'context_page'>; limit: number; returned_count: number; truncated: boolean;
  next_cursor: string | null; boundary: 'end' | 'continuation' | 'response_size_limit';
  snapshot_digest: string; snapshot_status: 'consistent_at_observation';
}
interface ContextResponse {
  contract_id: typeof COMPANY_MANAGER_CONTRACT_ID; contract_version: typeof COMPANY_MANAGER_CONTRACT_VERSION;
  project_id: string; unavailable: ['mandate', 'knowledge', 'canonical_dossier']; page: ContextPage;
}
export interface ProjectContextResponse extends ContextResponse { project: ContextProject; tasks: ContextTask[] }
interface TaskContextBase extends ContextResponse { task_id: string; task: ContextTask }
export type TaskContextResponse = TaskContextBase & (
  { section: 'dependencies'; items: ContextDependency[] } | { section: 'attempts'; items: ContextAttempt[] } |
  { section: 'artifacts'; items: ContextArtifact[] } | { section: 'reviews'; items: ContextReview[] }
);
export interface ContextErrorResponse {
  error: {
    code: 'authentication_required' | 'scope_denied' | 'not_found' | 'invalid_request' | 'continuation_invalid' | 'snapshot_changed' | 'context_page_too_large' | 'context_unavailable';
    restart_required: boolean; changed_snapshot: boolean;
  };
}

// Register the complete draft-2020-12 bundle once. No stripping, coercion,
// defaults, or separately maintained Zod interpretation of its JSON Schemas.
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(manifest.json_schema as AnySchemaObject);
function schema<T>(definition: keyof typeof manifest.json_schema.$defs): z.ZodType<T> {
  const validate = ajv.getSchema(`${manifest.json_schema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error('Company manager candidate schema is missing.');
  return z.custom<T>((value: unknown) => validate(value) === true);
}
export const ProjectContextInputSchema = schema<ProjectContextInput>('ProjectContextRequest');
export const TaskContextInputSchema = schema<TaskContextInput>('TaskContextRequest');
export const ProjectContextResponseSchema = schema<ProjectContextResponse>('ProjectContextResponse');
export const TaskContextResponseSchema = schema<TaskContextResponse>('TaskContextResponse');
export const ContextArtifactSchema = schema<ContextArtifact>('Artifact');
export const ContextErrorResponseSchema = schema<ContextErrorResponse>('Error');

// Cross-field runtime invariants supplement (and never loosen) the manifest.
// Snapshot/cursor integrity, stored associations and mutation freedom require
// backend evidence; a typed DTO cannot establish those facts.
export function contextResponseMatchesRequest(
  input: ProjectContextInput | TaskContextInput, value: ProjectContextResponse | TaskContextResponse,
): boolean {
  const items = 'tasks' in value ? value.tasks : value.items;
  if (value.project_id !== input.project_id || value.page.limit !== input.limit ||
      value.page.returned_count !== items.length || items.length > input.limit) return false;
  if ('tasks' in value) {
    if ('task_id' in input || value.project.entity.id !== input.project_id) return false;
  } else {
    if (!('task_id' in input) || value.task_id !== input.task_id || value.task.entity.id !== input.task_id || value.section !== input.section) return false;
    if (value.section === 'attempts' || value.section === 'reviews') {
      if (value.items.some(item => item.task.id !== input.task_id)) return false;
    }
    if (value.section === 'artifacts' && value.items.some(item => item.task !== null && item.task.id !== input.task_id)) return false;
  }
  const pending: unknown[] = [value];
  while (pending.length) {
    const item = pending.pop();
    if (item && typeof item === 'object') {
      if ('scope' in item && (item as ContextRef).scope.id !== input.project_id) return false;
      pending.push(...Object.values(item));
    }
  }
  return true;
}
