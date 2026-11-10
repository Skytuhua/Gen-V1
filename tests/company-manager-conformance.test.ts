import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv2020, { type AnySchemaObject } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import manifest from '../packages/company-contracts/company-manager.v1.json';
import samples from '../packages/company-contracts/company-manager.v1.samples.json';
import {
  COMPANY_MANAGER_CONTRACT_ID, COMPANY_MANAGER_CONTRACT_VERSION, COMPANY_MANAGER_BACKEND_CHECKPOINT,
  COMPANY_MANAGER_MANIFEST_SHA256, COMPANY_MANAGER_SAMPLES_SHA256, COMPANY_MANAGER_TRANSPORT,
  ProjectContextInputSchema, TaskContextInputSchema, ProjectContextResponseSchema, TaskContextResponseSchema,
  ContextArtifactSchema, ContextErrorResponseSchema,
} from '../packages/company-contracts/manager.ts';
import { COMPANY_TRANSPORT } from '../packages/company-contracts/index.ts';

const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(manifest.json_schema as AnySchemaObject);
const validate = (name: string, value: unknown) => ajv.getSchema(`${manifest.json_schema.$id}#/$defs/${name}`)!(value);

describe('separately pinned company-manager candidate', () => {
  it('pins raw LF manifest/sample bytes and the external candidate checkpoint', () => {
    for (const [file, hash] of [
      ['company-manager.v1.json', COMPANY_MANAGER_MANIFEST_SHA256],
      ['company-manager.v1.samples.json', COMPANY_MANAGER_SAMPLES_SHA256],
    ]) {
      const bytes = readFileSync(new URL(`../packages/company-contracts/${file}`, import.meta.url));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash);
      expect(bytes.includes(13)).toBe(false);
    }
    expect(COMPANY_MANAGER_MANIFEST_SHA256).toBe('fb4e7d2eba19275c5d4013576a01d90984c9f716ce9f0d6e1d1b31a15d46a033');
    expect(COMPANY_MANAGER_SAMPLES_SHA256).toBe('9402e4279e3f0772d5c3eee22e9dddc4f495d4fb30e2506bf90a738070fff9bd');
    expect(COMPANY_MANAGER_BACKEND_CHECKPOINT).toBe('aca8ec09de5cda73b014a348a05a8f05b43f465b');
    expect(manifest).toMatchObject({ contract_id: COMPANY_MANAGER_CONTRACT_ID, contract_version: COMPANY_MANAGER_CONTRACT_VERSION, implemented: false, stability: 'joint_review_candidate' });
    expect(manifest.transport.remote_ingress_available).toBe(false);
    expect(samples).toMatchObject({ fixture_only: true, actual_company_records: false });
  });
  it('registers all 29 draft-2020-12 definitions under their single bundled ID', () => {
    expect(manifest.json_schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(manifest.json_schema.$id).toBe('urn:maritime:company-manager:1.0.0-candidate.1');
    expect(Object.keys(manifest.json_schema.$defs)).toHaveLength(29);
    for (const name of Object.keys(manifest.json_schema.$defs)) expect(ajv.getSchema(`${manifest.json_schema.$id}#/$defs/${name}`)).toBeTypeOf('function');
  });
  it('adds exactly two owner POST reads while leaving the frozen eight routes separate', () => {
    expect(Object.keys(COMPANY_TRANSPORT.routes)).toHaveLength(8);
    expect(Object.values(COMPANY_MANAGER_TRANSPORT.routes)).toEqual(manifest.routes.map(route => route.path));
    expect(manifest.routes).toHaveLength(2);
    for (const route of manifest.routes) expect(route).toMatchObject({ method: 'POST', read_only: true, principal_kind: 'owner', permission: 'status' });
    expect(COMPANY_MANAGER_TRANSPORT).toMatchObject({ requestBytes: 32768, responseBytes: 262144 });
  });
  for (const example of samples.examples) {
    it(`preserves the exact synthetic ${example.name} request and response`, () => {
      expect(validate(example.request_schema, example.request)).toBe(true);
      expect(validate(example.response_schema, example.response)).toBe(true);
      const requestSchema = example.request_schema === 'ProjectContextRequest' ? ProjectContextInputSchema : TaskContextInputSchema;
      const responseSchema = example.response_schema === 'ProjectContextResponse' ? ProjectContextResponseSchema : TaskContextResponseSchema;
      expect(requestSchema.parse(example.request)).toEqual(example.request);
      expect(responseSchema.parse(example.response)).toEqual(example.response);
      expect(requestSchema.safeParse({ ...example.request, authority: 'owner' }).success).toBe(false);
      expect(responseSchema.safeParse({ ...example.response, total_count: 123 }).success).toBe(false);
    });
  }
  it('validates first-page and bounded continuation inputs without coercion or defaults', () => {
    const request = samples.examples[0].request;
    expect(ProjectContextInputSchema.parse({ ...request, limit: 50, cursor: 'opaque_A-9' })).toEqual({ ...request, limit: 50, cursor: 'opaque_A-9' });
    for (const invalid of [
      { ...request, limit: 0 }, { ...request, limit: 51 }, { ...request, limit: 1.5 }, { ...request, limit: '20' },
      { project_id: 'alpha', limit: 20 }, { ...request, project_id: 'company-ops' }, { ...request, project_id: 'Alpha' },
      { ...request, cursor: '' }, { ...request, cursor: 'opaque/private' }, { ...request, cursor: 'x'.repeat(4097) },
    ]) expect(ProjectContextInputSchema.safeParse(invalid).success).toBe(false);
    for (const section of ['dependencies', 'attempts', 'artifacts', 'reviews']) expect(TaskContextInputSchema.safeParse({ ...request, task_id: 'task-demo', section }).success).toBe(true);
    expect(TaskContextInputSchema.safeParse({ ...request, task_id: 'task-demo', section: 'sql' }).success).toBe(false);
  });
  it('retains standalone controller provenance without creating a task, employee or generated receipt', () => {
    const artifact = samples.standalone_artifact_metadata.dto;
    expect(validate('Artifact', artifact)).toBe(true);
    expect(ContextArtifactSchema.parse(artifact)).toEqual(artifact);
    expect(artifact).toMatchObject({ origin: 'control_service', task: null, attempt: null, employee: null, machine: null, generation: null, producer: { type: 'principal', id: 'control' } });
    expect(artifact.entity.digests.input).toEqual({ status: 'unavailable', value: null });
    expect(artifact.entity.digests.binding).toEqual({ status: 'unavailable', value: null });
    expect(artifact.entity.digests.content.status).toBe('available');
    expect(JSON.stringify(artifact)).not.toContain('E29');
    expect(ContextArtifactSchema.safeParse({ ...artifact, employee: { ...artifact.producer, type: 'employee', id: 'E29' } }).success).toBe(false);
  });
  it('requires snapshot restart flags and preserves unavailable historical digests', () => {
    expect(ContextErrorResponseSchema.parse(samples.changed_snapshot_error)).toEqual(samples.changed_snapshot_error);
    for (const code of ['snapshot_changed', 'continuation_invalid']) {
      const correct = { error: { code, restart_required: true, changed_snapshot: code === 'snapshot_changed' } };
      expect(ContextErrorResponseSchema.safeParse(correct).success).toBe(true);
      expect(ContextErrorResponseSchema.safeParse({ error: { ...correct.error, restart_required: false } }).success).toBe(false);
    }
    const project = samples.examples[0].response;
    expect(ProjectContextResponseSchema.safeParse({ ...project, project: { ...project.project, entity: { ...project.project!.entity, digests: { ...project.project!.entity.digests, input: { status: 'available', value: null } } } } }).success).toBe(false);
  });
});
