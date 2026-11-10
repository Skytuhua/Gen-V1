// Company-only build-time generation. Browser code imports the committed static
// functions; it never compiles a schema or falls back to runtime code generation.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import {build} from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(value => value !== '--check')) throw new Error('Only --check is supported.');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = {
  records: 'packages/company-contracts/communications/reads-candidate.1/records.schema.json',
  command: 'packages/company-contracts/communications/v1/discussion-command.schema.json',
  information: 'packages/company-contracts/communications/v1/employee-information.schema.json',
  received: 'packages/company-contracts/communications/v1/employee-received.schema.json',
  workPlan: 'packages/company-contracts/owner-work-plan-candidate.1/work-plan.schema.json',
};
const bytes = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, path]) => [key, await readFile(resolve(root, path))])));
const schemas = Object.fromEntries(Object.entries(bytes).map(([key, value]) => [key, JSON.parse(value.toString('utf8'))]));
const context = {type: 'object', additionalProperties: false,
  properties: {company_id: {$ref: `${schemas.information.$id}#/$defs/CompanyId`},
    scope: {$ref: `${schemas.information.$id}#/$defs/ProjectScope`},
    machine_principal_id: {$ref: `${schemas.information.$id}#/$defs/OpaqueExistingId`},
    journal_owner_id: {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$'},
    recipient: {$ref: `${schemas.information.$id}#/$defs/Actor`}},
  required: ['company_id', 'scope', 'machine_principal_id', 'journal_owner_id', 'recipient']};
const dependencyPaths = ['node_modules/ajv/package.json', 'node_modules/ajv/dist/2020.js', 'node_modules/ajv/dist/standalone/index.js', 'node_modules/esbuild/package.json'];
const dependencyHashes = Object.fromEntries(await Promise.all(dependencyPaths.map(async path => [path, hash(await readFile(resolve(root, path)))])));
const versions = {ajv: JSON.parse(await readFile(resolve(root, dependencyPaths[0]), 'utf8')).version,
  esbuild: JSON.parse(await readFile(resolve(root, dependencyPaths[3]), 'utf8')).version};
const generatorHash = hash(await readFile(fileURLToPath(import.meta.url)));

// These lists match only the current browser-reachable compilation blocks.
const groups = [
  {name: 'employee-information', inputs: ['records', 'command', 'information'], options: {strict: true, allErrors: false},
    refs: Object.fromEntries(['Command', 'Receipt', 'Inbox', 'CompanyId', 'ProjectScope'].map(name => [name, `${schemas.information.$id}#/$defs/${name}`]))},
  {name: 'employee-received', inputs: ['records', 'command', 'information', 'received'], options: {strict: true, allErrors: false},
    refs: {...Object.fromEntries(['Command', 'LocalReceipt', 'Receipt'].map(name => [name, `${schemas.received.$id}#/$defs/${name}`])),
      InformationItem: `${schemas.information.$id}#/$defs/InformationItem`, Context: 'urn:gen:private:employee-received-context'}},
  {name: 'work-plan', inputs: ['workPlan'], options: {allErrors: false, strict: true, validateFormats: false},
    refs: Object.fromEntries(['PlanBody', 'ProjectId', 'Error', 'ProposeRequest', 'ReadRequest', 'AuthorizeRequest', 'ProposeResponse', 'ReadResponse', 'AuthorizeResponse'].map(name => [name, `${schemas.workPlan.$id}#/$defs/${name}`]))},
];
const results = [];
for (const group of groups) {
  // Share referenced validator functions instead of duplicating their bodies.
  // This changes emitted code layout only; parity tests compare acceptance to
  // the original compiler's default inlineRefs setting and validation options.
  const ajv = new Ajv2020({...group.options, inlineRefs: false, code: {source: true, esm: true}});
  for (const input of group.inputs) ajv.addSchema(schemas[input]);
  if (group.name === 'employee-received') ajv.addSchema(context, group.refs.Context);
  const standalone = standaloneCode(ajv, group.refs);
  // Ajv emits literal imports of its tiny runtime helpers. Bundle those now,
  // so the browser needs neither CommonJS require nor the Ajv compiler.
  const bundled = await build({absWorkingDir: root, stdin: {contents: standalone, loader: 'js', sourcefile: `company-${group.name}-standalone.js`, resolveDir: root},
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2023', legalComments: 'none', metafile: true});
  if (Object.values(bundled.metafile.outputs).some(output => output.imports.length) || bundled.outputFiles.length !== 1) throw new Error('Standalone output has unresolved imports.');
  const code = bundled.outputFiles[0].text;
  if (code.includes('Dynamic require of') || /\bnew\s+Function\s*\(/.test(code)) throw new Error('Standalone output contains a runtime compiler.');
  const metadata = {generatorSHA256: generatorHash, options: group.options, codeGeneration: {inlineRefs: false, source: true, esm: true, helpers: 'statically_bundled'}, versions,
    schemas: Object.fromEntries(group.inputs.map(input => [files[input], hash(bytes[input])])),
    ...(group.name === 'employee-received' ? {receivedContextSHA256: hash(JSON.stringify(context))} : {}), dependencies: dependencyHashes};
  const output = `// @ts-nocheck\n// Generated by node scripts/generate-company-browser-validators.mjs; do not edit.\n// Schema shape validation only. Existing supplemental checks remain mandatory.\n// Inputs ${JSON.stringify(metadata)}\n${code}`;
  const path = resolve(root, `packages/company-contracts/generated/${group.name}.ts`);
  if (check) {
    let existing; try {existing = await readFile(path, 'utf8');} catch {throw new Error(`Missing generated company validators: ${group.name}`);}
    if (existing !== output) throw new Error(`Stale generated company validators: ${group.name}`);
  } else {await mkdir(dirname(path), {recursive: true}); await writeFile(path, output, 'utf8');}
  results.push({name: group.name, bytes: Buffer.byteLength(output), sha256: hash(output)});
}
process.stdout.write(JSON.stringify({mode: check ? 'check' : 'generate', outputs: results}) + '\n');
