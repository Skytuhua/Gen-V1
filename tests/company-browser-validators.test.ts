import {expect, it} from 'vitest';
import Ajv2020, {type AnySchemaObject, type ValidateFunction} from 'ajv/dist/2020.js';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import information from '../packages/company-contracts/communications/v1/employee-information.schema.json';
import received from '../packages/company-contracts/communications/v1/employee-received.schema.json';
import records from '../packages/company-contracts/communications/reads-candidate.1/records.schema.json';
import command from '../packages/company-contracts/communications/v1/discussion-command.schema.json';
import workPlan from '../packages/company-contracts/owner-work-plan-candidate.1/work-plan.schema.json';
import informationGolden from '../packages/company-contracts/communications/v1/golden/employee-information.json';
import receivedGolden from '../packages/company-contracts/communications/v1/golden/employee-received.json';
import planGolden from '../packages/company-contracts/owner-work-plan-candidate.1/examples.json';
import * as Information from '../packages/company-contracts/generated/employee-information';
import * as Received from '../packages/company-contracts/generated/employee-received';
import * as WorkPlan from '../packages/company-contracts/generated/work-plan';

const ajv = new Ajv2020({strict: true, allErrors: false});
for (const schema of [records, command, information, received]) ajv.addSchema(schema as AnySchemaObject);
const planAjv = new Ajv2020({strict: true, allErrors: false, validateFormats: false});
planAjv.addSchema(workPlan as AnySchemaObject);
const check = (compiled: (value: unknown) => boolean, original: ValidateFunction, value: unknown, expected?: boolean) => {
  const left = compiled(structuredClone(value)), right = original(structuredClone(value));
  expect(left).toBe(right); if (expected !== undefined) expect(left).toBe(expected);
};
it('committed standalone code exactly matches the pinned schema inputs and installed generator dependencies', () => {
  const run = spawnSync(process.execPath, ['scripts/generate-company-browser-validators.mjs', '--check'], {encoding: 'utf8', windowsHide: true});
  expect(run.status, run.stderr + run.stdout).toBe(0);
});
it('contains static functions without runtime compilation, imports or require fallbacks', () => {
  for (const name of ['employee-information', 'employee-received', 'work-plan']) {
    const source = readFileSync(`packages/company-contracts/generated/${name}.ts`, 'utf8');
    // Runtime helper metadata contains inert "require(...)" strings. Inspect
    // executable syntax, rather than confusing those strings with code calls.
    const tree = ts.createSourceFile(name + '.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), forbidden: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) forbidden.push('runtime import');
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') forbidden.push('Function constructor');
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && ['require', 'eval', 'Function'].includes(node.expression.text))) forbidden.push(node.expression.getText(tree));
      ts.forEachChild(node, visit);
    };
    visit(tree); expect(forbidden).toEqual([]);
    expect(source).toContain('Generated');
  }
});
it('preserves information shapes for all actual golden commands, receipts and scoped inbox pages', () => {
  for (const item of informationGolden.examples) {
    check(Information.Command, ajv.getSchema(`${information.$id}#/$defs/Command`)!, item.command, true);
    check(Information.Receipt, ajv.getSchema(`${information.$id}#/$defs/Receipt`)!, item.receipt, true);
    check(Information.Command, ajv.getSchema(`${information.$id}#/$defs/Command`)!, {...item.command, extra: true}, false);
  }
  for (const page of [informationGolden.inbox, informationGolden.empty_inbox]) check(Information.Inbox, ajv.getSchema(`${information.$id}#/$defs/Inbox`)!, page, true);
  for (const name of ['CompanyId', 'ProjectScope'] as const) for (const value of [null, 1, {}, 'leo-company', {kind: 'project', id: 'alpha'}, {kind: 'company', id: 'leo-company'}, {kind: 'project', id: 'alpha', permission: '*'}]) {
    check(Information[name], ajv.getSchema(`${information.$id}#/$defs/${name}`)!, value);
  }
});
it('preserves received records and the exact closed protected context shape', () => {
  const original = receivedGolden.example;
  for (const [name, value] of [['Command', original.command], ['LocalReceipt', original.local_receipt], ['Receipt', original.receipt]] as const) {
    check(Received[name], ajv.getSchema(`${received.$id}#/$defs/${name}`)!, value, true);
    check(Received[name], ajv.getSchema(`${received.$id}#/$defs/${name}`)!, {...value, extra: true}, false);
  }
  check(Received.InformationItem, ajv.getSchema(`${information.$id}#/$defs/InformationItem`)!, original.envelope, true);
  const contextSchema = {type: 'object', additionalProperties: false,
    properties: {company_id: {$ref: `${information.$id}#/$defs/CompanyId`}, scope: {$ref: `${information.$id}#/$defs/ProjectScope`},
      machine_principal_id: {$ref: `${information.$id}#/$defs/OpaqueExistingId`}, journal_owner_id: {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$'}, recipient: {$ref: `${information.$id}#/$defs/Actor`}},
    required: ['company_id', 'scope', 'machine_principal_id', 'journal_owner_id', 'recipient']};
  const originalContext = ajv.compile(contextSchema), context = {company_id: 'leo-company', scope: {kind: 'project', id: 'alpha'}, machine_principal_id: 'machine:E11', journal_owner_id: 'supervisor-E11', recipient: original.envelope.delivery.recipient};
  check(Received.Context, originalContext, context, true);
  for (const value of [{...context, grant: '*'}, {...context, journal_owner_id: '../escape'}, {...context, recipient: {...context.recipient, generation: 1.5}}, {...context, scope: {kind: 'company', id: 'leo-company'}}]) check(Received.Context, originalContext, value, false);
});
it('preserves all six work-plan request/response samples and boundary schema rejections', () => {
  const validators = WorkPlan as unknown as Record<string, ValidateFunction>;
  for (const example of planGolden.cases) for (const [name, value] of [[example.request_schema, example.request], [example.response_schema, example.response]] as const) {
    check(validators[name], planAjv.getSchema(`${workPlan.$id}#/$defs/${name}`)!, value, true);
    check(validators[name], planAjv.getSchema(`${workPlan.$id}#/$defs/${name}`)!, {...value, extra: true}, false);
  }
  const plan = structuredClone(planGolden.cases[0].request.plan)!;
  for (const value of [{...plan, budget_cents: 1.5}, {...plan, budget_cents: true}, {...plan, summary: ''}, {...plan, employee_ids: ['E32']}, {...plan, summary: 'é'.repeat(2048)}, {...plan, summary: '😀'.repeat(2048)}]) {
    check(WorkPlan.PlanBody, planAjv.getSchema(`${workPlan.$id}#/$defs/PlanBody`)!, value);
  }
});
