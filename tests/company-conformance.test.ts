import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv2020, { type AnySchemaObject } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as contracts from '../packages/company-contracts/index.ts';

const manifestBytes = readFileSync(new URL('../packages/company-contracts/company-service.v1.json', import.meta.url));
const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
  contract_id: string; contract_version: string;
  service_baseline: { commit: string };
  routes: { operation_id: string; method: string; path: string; request_schema: AnySchemaObject; read_only: boolean }[];
  transport: { max_request_bytes: number; response_size_limit_or_pagination: string };
};
const ajv = new Ajv2020({ strict: true, allErrors: true });
const project = 'alpha';
const control = { project_id: project, message_id: 'message-1' };
const examples: { operation: string; route: keyof typeof contracts.COMPANY_TRANSPORT.routes; schema: z.ZodType; valid: Record<string, unknown>[]; invalid: unknown[] }[] = [
  { operation: 'status', route: 'status', schema: contracts.StatusInputSchema,
    valid: [{ scope: { kind: 'project', id: project } }, { scope: { kind: 'company', id: 'leo-company' } }],
    invalid: [{ scope: { kind: 'company', id: project } }, { scope: { kind: 'project', id: 'company-ops' } }, { scope: { kind: 'project', id: 'Alpha' } }, { scope: { kind: 'project', id: project, authority: 'owner' } }] },
  { operation: 'owner_plan', route: 'plan', schema: contracts.OwnerPlanInputSchema,
    valid: [{ ...control, instruction: 'Plan only' }, { ...control, instruction: '😀'.repeat(16000), message_id: '😀'.repeat(128) }],
    invalid: [{ ...control, instruction: '' }, { ...control, instruction: ' \n' }, { ...control, instruction: 'nul\0text' }, { ...control, instruction: '😀'.repeat(16001) }] },
  { operation: 'owner_start', route: 'start', schema: contracts.OwnerStartInputSchema,
    valid: [{ ...control, proposal_id: 'proposal-1' }, { ...control, work_order_id: 'work-1' }],
    invalid: [control, { ...control, proposal_id: 'p1', work_order_id: 'w1' }, { ...control, proposal_id: '' }] },
  { operation: 'owner_pause', route: 'pause', schema: contracts.OwnerControlInputSchema,
    valid: [control], invalid: [{ project_id: project }, { ...control, message_id: ' \t' }] },
  { operation: 'owner_cancel', route: 'cancel', schema: contracts.OwnerControlInputSchema,
    valid: [control], invalid: [{ ...control, message_id: 'm'.repeat(129) }, { ...control, message_id: 'nul\0' }] },
  { operation: 'employee_tool', route: 'employeeTool', schema: contracts.EmployeeToolInputSchema,
    valid: [{ project_id: project, tool: 'status_scoped', arguments: {} }, { project_id: project, tool: 'read_assignment', arguments: {} }, { project_id: project, tool: 'read_artifact', arguments: { artifact_id: 'artifact-1' } }],
    invalid: [{ project_id: project, tool: 'shell', arguments: {} }, { project_id: project, tool: 'read_assignment', arguments: { task_id: 't1' } }, { project_id: project, tool: 'read_artifact', arguments: {} }] },
  { operation: 'artifact_preview', route: 'artifactPreview', schema: contracts.ArtifactPreviewInputSchema,
    valid: [{ project_id: project, artifact_id: 'artifact-1' }, { project_id: project, artifact_id: '😀'.repeat(128) }],
    invalid: [{ project_id: project, artifact_id: '' }, { project_id: project, artifact_id: 'a'.repeat(129) }, { project_id: project, artifact_id: 'a\0b' }] },
  { operation: 'review_package', route: 'reviewPackage', schema: contracts.ReviewPackageInputSchema,
    valid: [{ project_id: project, work_order_id: 'work-1' }],
    invalid: [{ project_id: project }, { project_id: project, work_order_id: '   ' }] },
];

describe('pinned Maritime candidate conformance', () => {
  it('pins exact manifest bytes and the HTTP baseline without implying final backend acceptance', () => {
    const expected = '80fcc2f4cddafaeb7811eb3d195f908ff974f06e79e3ca79d680188e4b1aad4c';
    expect(createHash('sha256').update(manifestBytes).digest('hex')).toBe(expected);
    expect(contracts).toHaveProperty('COMPANY_MANIFEST_SHA256', expected);
    expect(contracts).toHaveProperty('COMPANY_BACKEND_CHECKPOINT', 'bcb9ee7c6196243b2647e917a1ccb7b1d0793770');
    expect(manifest.contract_id).toBe('maritime-company-service');
    expect(manifest.contract_version).toBe('1.0.0-candidate.1');
    expect(manifest.service_baseline.commit).toBe(contracts.COMPANY_SERVICE_BASELINE);
    expect(manifest.transport.max_request_bytes).toBe(contracts.COMPANY_TRANSPORT.requestBytes);
    expect(manifest.transport.response_size_limit_or_pagination).toContain('not advertised');
  });
  it('matches exactly the eight POST method/path pairs', () => {
    expect(manifest.routes.map(route => `${route.method} ${route.path}`).sort()).toEqual(Object.values(contracts.COMPANY_TRANSPORT.routes).map(path => `POST ${path}`).sort());
  });
  for (const example of examples) {
    it(`conforms to the ${example.operation} JSON Schema 2020-12 request boundary`, () => {
      const route = manifest.routes.find(route => route.operation_id === example.operation)!;
      expect(route.path).toBe(contracts.COMPANY_TRANSPORT.routes[example.route]);
      expect(route.request_schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
      const validate = ajv.compile(route.request_schema);
      for (const value of example.valid) {
        expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
        expect(example.schema.safeParse(value).success).toBe(true);
        expect(validate({ ...value, unexpected: true })).toBe(false);
        expect(example.schema.safeParse({ ...value, unexpected: true }).success).toBe(false);
      }
      for (const value of example.invalid) {
        expect(validate(value)).toBe(false);
        expect(example.schema.safeParse(value).success).toBe(false);
      }
      for (const invalidId of ['Alpha', '*', 'company-ops', '-alpha', 'alpha_beta', 'a'.repeat(64)]) {
        const value = example.operation === 'status' ? { scope: { kind: 'project', id: invalidId } } : { ...example.valid[0], project_id: invalidId };
        expect(validate(value)).toBe(false);
        expect(example.schema.safeParse(value).success).toBe(false);
      }
    });
  }
  it('keeps the initial employee broker deliberately narrower than the service', () => {
    const validate = ajv.compile(manifest.routes.find(route => route.operation_id === 'employee_tool')!.request_schema);
    const finance = { project_id: project, tool: 'finance_aggregates', arguments: {} };
    const handoff = { project_id: project, tool: 'handoff', arguments: { task_id: 't1', recipient: 'E02', message_id: 'm1', text: 'result' } };
    for (const input of [finance, handoff]) {
      expect(validate(input)).toBe(true);
      expect(contracts.EmployeeToolInputSchema.safeParse(input).success).toBe(false);
    }
    expect(manifest.routes.find(route => route.operation_id === 'review_package')!.read_only).toBe(false);
  });
});
