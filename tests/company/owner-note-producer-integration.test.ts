import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {expect, it} from 'vitest';
import {canonicalBytes, decodeJson} from '../../packages/company-contracts/communications/index.ts';
import {validateReadOutput} from '../../packages/company-contracts/communications/reads.ts';

const fixtureRoot = process.env.GEN_COMPANY_OWNER_NOTE_FIXTURE_ROOT;
const checkpoint = 'e27f9443bfcac1fdf92b0d70dfab261a7fb7953b';
const sourcePins = {
  'src/company/comms/owner_notes.py': '3afbb82552cbe93b69458fe9d7f05ae913c1150f8c869fb55a32c800a02f8888',
  'src/company/service.py': '3b80e97664fe61366821ed764f40a36a15eb8be8b69af879d6a36a08d191b670',
  'src/company/store.py': 'e2e02c8f1afe9d211e043de10ec7dce9be0779fd24b330bbda6fc6229ab10975',
  'src/company/migrations/007_communications_records.sql': '74bbc84918e8b058f1f741361c1a5bb019a126b16d3da68a94617540c1961ded',
  'tools/export_owner_note_fixture.py': '31b1a494d7d14c28dafd53f8305a680488b0612d72f52ff1b8c0f9f962792567',
  'tests/communications/test_owner_notes.py': '05866fc838d81016e8074c893271b25fa62013a3a5d70e0c649e55c0a9066097',
};
const evidencePins = {
  'docs/evidence/owner-notes-2026-11-02.json': '82751b55dd51e60f2fa97330766da16b62817fc1ef3085604fb8b64242972f48',
  'docs/evidence/owner-notes-fixture-2026-11-02.json': '4d65868717fad2c11dd3f8a40f7a0c3173dade21517a3e21817c3e67a7acd0bd',
  'docs/communications/owner-notes.md': '1bbde77e6ce26efc37b4963eb843c9fda7c70c18f94af24e40f199e5c236b0f9',
};
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
interface Fixture {
  contract: string; version: number; proof: string; company_id: string; scope: {kind: 'project'; id: string};
  pairs: {conversation: unknown; message: unknown}[];
  receipts: {receipt_type: string; action: string; outcome: string; conversation_ref: unknown; message_ref: unknown}[];
  checks: Record<string, boolean>; producer_sources: Record<string, string>;
}

it.skipIf(!fixtureRoot)('consumes actual temporary-Store owner notes as separate historical records', async () => {
  const root = resolve(fixtureRoot!);
  const gitHead = () => execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {encoding: 'utf8', windowsHide: true, timeout: 5000}).trim();
  const checkPins = () => {
    expect(gitHead()).toBe(checkpoint);
    for (const [path, digest] of Object.entries({...sourcePins, ...evidencePins})) expect(hash(readFileSync(join(root, path))), path).toBe(digest);
  };
  checkPins();
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) if (process.env[key] !== undefined) environment[key] = process.env[key];
  const python = join(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  const raw = execFileSync(python, ['-I', '-B', join(root, 'tools/export_owner_note_fixture.py')], {
    cwd: root, env: environment, windowsHide: true, timeout: 15000, maxBuffer: 32768,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const evidenceRoot = resolve(import.meta.dirname, '../../.harness-company-evidence');
  mkdirSync(evidenceRoot, {recursive: true});
  const evidence = mkdtempSync(join(evidenceRoot, 'owner-note-consumer-'));
  writeFileSync(join(evidence, 'fixture.stdout.json'), raw, {flag: 'wx'});
  // Strictly decode the whole small fixture first, preserving lexical checks before
  // canonicalizing individual documents. This wrapper is not a company wire API.
  const value = decodeJson(raw) as unknown as Fixture;
  expect(value).toMatchObject({contract: 'maritime-owner-note-fixture', version: 1, proof: 'synthetic_local_store', company_id: 'leo-company', scope: {kind: 'project', id: 'alpha'}});
  expect(value.checks).toEqual({changed_arguments_conflict: true, cross_project_not_found: true, read_rows_unchanged: true, same_command_same_receipt: true, temporary_store_removed: true, wrong_token_denied: true});
  expect(value.producer_sources).toEqual(Object.fromEntries(Object.entries(sourcePins).filter(([path]) => !path.startsWith('tests/'))));
  expect(value.pairs).toHaveLength(2); expect(value.receipts).toHaveLength(2);
  const context = {company_id: 'leo-company', scope: {kind: 'project' as const, id: 'alpha'}};
  const validated = [];
  for (const [index, pair] of value.pairs.entries()) {
    const conversation = await validateReadOutput('Conversation', canonicalBytes(pair.conversation), context);
    const message = await validateReadOutput('Message', canonicalBytes(pair.message), context);
    expect(conversation).toMatchObject({kind: 'project_room', revision: index + 1, task_ref: null, work_order_ref: null, observation: {source: 'stored_record', evidence_scope: 'stored_record', live_verified: false}});
    expect(message).toMatchObject({kind: 'note', revision: 1, conversation_sequence: index + 1, effective_priority: 'normal', artifact_refs: [], observation: {source: 'stored_record', evidence_scope: 'stored_record', live_verified: false}});
    expect(message.conversation_ref).toMatchObject({availability: 'available', id: conversation.id, revision: conversation.revision, digest: conversation.digest, company_id: context.company_id, scope: context.scope});
    expect(value.receipts[index]).toMatchObject({receipt_type: 'owner_note_receipt', action: 'owner_note.append', outcome: 'stored', conversation_ref: message.conversation_ref, message_ref: {id: message.id, revision: message.revision, digest: message.digest}});
    await expect(validateReadOutput('Message', canonicalBytes(pair.message), {...context, scope: {kind: 'project', id: 'beta'}})).rejects.toMatchObject({code: 'scope_mismatch'});
    validated.push({conversation, message});
  }
  expect(validated[0].conversation.id).toBe(validated[1].conversation.id);
  expect(validated[0].conversation.digest).not.toBe(validated[1].conversation.digest);
  expect(validated[0].message.conversation_ref.revision).toBe(1);
  expect(validated[1].message.conversation_ref.revision).toBe(2);
  checkPins();
  writeFileSync(join(evidence, 'consumer.json'), JSON.stringify({checkpoint, proof: value.proof, rawSHA256: hash(raw), recordsValidated: 4, historicalRevisions: [1, 2], producerChecks: value.checks, liveVerified: false, routesAdded: false, companyAccepted: false}, null, 2) + '\n', {flag: 'wx'});
  console.info(`Owner-note consumer evidence: ${evidence}`);
}, 30000);
