import {afterEach, expect, it} from 'vitest';
import {randomBytes} from 'node:crypto';
import {mkdtemp, mkdir, writeFile, realpath, lstat, rm, rename, link, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve, sep} from 'node:path';
import {PersonalSkillInvocations, harnessVersionReader} from '../packages/skill-invocation/index.ts';
import {bindSkillReference, boundSkillReferenceSchema, skillInvocationSendPayloadSchema} from '../packages/contracts/skill-invocation.ts';
import {build} from 'esbuild';
import {SkillCatalogRepository, catalogHash} from '../packages/skill-catalog/repository.ts';
import {directoryCatalog} from '../packages/skill-catalog/filesystem.ts';
import {harnessCatalog, installedAppCatalog, bundledCatalog, projectCatalog} from '../packages/skill-catalog/adapters.ts';
import {integrationIds} from '../packages/integrations/manifest.ts';
import {Store} from '../packages/storage/store.ts';
import {applySkillOperations} from '../packages/core/skills.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const document = '---\nname: Procedure\ndescription: A procedure\n---\nRead support.txt. Tool permission still comes from the host.\n';
const authority = () => ({kind: 'personal' as const, authorityId: 'local-owner', threadId: 'thread', projectId: null as string | null, workspaceId: null as string | null, accountId: 'account' as string | null, authorityRevision: 'a'.repeat(64)});
async function fixture() {
  const base = await realpath(tmpdir()), root = await mkdtemp(join(base, 'gen-sksend-')), folder = join(root, 'skills', 'procedure');
  cleanups.push(async () => {
    if (await realpath(root) !== resolve(root) || !root.startsWith(base + sep) || (await lstat(root)).isSymbolicLink()) throw Error('Unsafe fixture cleanup');
    await rm(root, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
  });
  await mkdir(folder, {recursive: true});
  await writeFile(join(folder, 'SKILL.md'), document); await writeFile(join(folder, 'support.txt'), 'first');
  const catalog = new SkillCatalogRepository([directoryCatalog({id: 'personal:controlled', kind: 'personal', label: 'Controlled', root: join(root, 'skills')})]);
  const ref = (await catalog.list()).skills[0].ref!;
  let current = authority();
  const records = new Map<string, unknown>(), key = randomBytes(32), signal = new AbortController().signal;
  const options = {catalog, expectedAuthority: current, currentAuthority: () => current, replayKey: key, findReplay: (id: string) => records.get(id) ?? null};
  const host = new PersonalSkillInvocations(options);
  const request = {commandId: 'command', payload: {content: 'Use this procedure', modelId: 'provider/model', skills: [ref]}};
  const runtime = {threadId: 'thread', runId: 'run', epoch: 1, accountId: 'account', inputId: 'command', prompt: 'original', modelId: 'provider/model', sessionPath: null, resources: []};
  return {root, folder, catalog, request, signal, host, options, records, runtime, setAuthority: (next: typeof current) => {current = next;}};
}

it('materializes exact entry bytes and captured support without changing prompt or resources', async () => {
  const f = await fixture(), admitted = await f.host.prepare(f.request, f.signal);
  const input = f.host.runtimeInput(f.runtime, [admitted], f.signal);
  expect(input.prompt).toBe('original'); expect(input.resources).toEqual([]);
  expect(input.admittedSkillGuidance[0]).toMatchObject({inputId: 'command', trust: 'untrusted-guidance', reference: f.request.payload.skills[0], entry: {text: document, bytes: Buffer.byteLength(document)}});
  expect(f.host.readSupportingFile(admitted, admitted.guidance[0].supportingFiles[0].handle, f.signal).toString()).toBe('first');
  await writeFile(join(f.folder, 'support.txt'), 'other');
  expect(f.host.readSupportingFile(admitted, admitted.guidance[0].supportingFiles[0].handle, f.signal).toString()).toBe('first');
  expect(JSON.stringify(admitted.record)).not.toContain(f.root);
});

it('denies stale support, forged identity, cross-source and private-provider references', async () => {
  const f = await fixture();
  for (const patch of [{digest: 'b'.repeat(64)}, {sourceBinding: 'b'.repeat(64)}, {revision: 'b'.repeat(64)}, {sourceId: 'app:other'}, {scope: {kind: 'provider', providerId: 'company', scopeId: 'private'}}]) {
    const request = structuredClone(f.request); Object.assign(request.payload.skills[0], patch);
    await expect(f.host.prepare(request, f.signal)).rejects.toMatchObject({code: 'SKILL_RESELECT'});
  }
  await writeFile(join(f.folder, 'support.txt'), 'other');
  await expect(f.host.prepare(f.request, f.signal)).rejects.toMatchObject({code: 'SKILL_RESELECT'});
});

it('rejects every changed authority dimension before admission', async () => {
  const f = await fixture();
  for (const patch of [{authorityId: 'other'}, {threadId: 'other'}, {projectId: 'project'}, {workspaceId: 'worktree'}, {accountId: 'other'}, {authorityRevision: 'b'.repeat(64)}]) {
    f.setAuthority({...authority(), ...patch});
    await expect(f.host.prepare(f.request, f.signal)).rejects.toMatchObject({code: 'SKILL_RESELECT'});
  }
});

it('fences authority changes during catalog awaits and again before commit/runtime/support reads', async () => {
  const f = await fixture(), check = f.catalog.checkReference.bind(f.catalog);
  const racing = new PersonalSkillInvocations({...f.options, catalog: {async checkReference(...args: Parameters<typeof check>) {const value = await check(...args); f.setAuthority({...authority(), accountId: 'swapped'}); return value;}}});
  await expect(racing.prepare(f.request, f.signal)).rejects.toMatchObject({code: 'SKILL_RESELECT'});
  f.setAuthority(authority()); const admitted = await f.host.prepare(f.request, f.signal);
  f.setAuthority({...authority(), projectId: 'other'});
  expect(() => f.host.assertCurrent(admitted, f.signal)).toThrowError(expect.objectContaining({code: 'SKILL_RESELECT'}));
  expect(() => f.host.runtimeInput(f.runtime, [admitted], f.signal)).toThrow();
  expect(() => f.host.readSupportingFile(admitted, admitted.guidance[0].supportingFiles[0].handle, f.signal)).toThrow();
});

it('honors pre-abort and an abort that wins a catalog await without producing an admission', async () => {
  const f = await fixture(), controller = new AbortController(); controller.abort();
  await expect(f.host.prepare(f.request, controller.signal)).rejects.toMatchObject({code: 'CANCELLED'});
  const racingAbort = new AbortController(), check = f.catalog.checkReference.bind(f.catalog);
  const racing = new PersonalSkillInvocations({...f.options, catalog: {async checkReference(...args: Parameters<typeof check>) {const value = await check(...args); racingAbort.abort(); return value;}}});
  await expect(racing.prepare(f.request, racingAbort.signal)).rejects.toMatchObject({code: 'CANCELLED'});
});

it.each(['support-bytes', 'entry-bytes', 'file-swap', 'directory-swap', 'hardlink', 'junction', 'extra-file'] as const)('denies %s between fresh catalog custody and materialization', async attack => {
  const f = await fixture(), check = f.catalog.checkReference.bind(f.catalog); let fired = false;
  const racing = new PersonalSkillInvocations({...f.options, catalog: {async checkReference(...args: Parameters<typeof check>) {
    const value = await check(...args);
    if (!fired) {
      fired = true;
      if (attack === 'support-bytes') await writeFile(join(f.folder, 'support.txt'), 'other');
      if (attack === 'entry-bytes') await writeFile(join(f.folder, 'SKILL.md'), document.replace('Read', 'Burn'));
      if (attack === 'file-swap') {await rename(join(f.folder, 'support.txt'), join(f.root, 'old')); await writeFile(join(f.folder, 'support.txt'), 'first');}
      if (attack === 'directory-swap' || attack === 'junction') {
        await rename(f.folder, join(f.root, 'old'));
        if (attack === 'junction') await symlink(join(f.root, 'old'), f.folder, process.platform === 'win32' ? 'junction' : 'dir');
        else {await mkdir(f.folder); await writeFile(join(f.folder, 'SKILL.md'), document); await writeFile(join(f.folder, 'support.txt'), 'first');}
      }
      if (attack === 'hardlink') await link(join(f.folder, 'support.txt'), join(f.root, 'alias'));
      if (attack === 'extra-file') await writeFile(join(f.folder, 'unlisted'), 'extra');
    }
    return value;
  }}});
  await expect(racing.prepare(f.request, f.signal)).rejects.toMatchObject({code: 'SKILL_RESELECT'});
});

it('revalidates the canonical source after capture rather than accepting its earlier index', async () => {
  const f = await fixture(), check = f.catalog.checkReference.bind(f.catalog); let calls = 0;
  const host = new PersonalSkillInvocations({...f.options, catalog: {async checkReference(...args: Parameters<typeof check>) {if (++calls === 2) throw Error('registry revoked'); return check(...args);}}});
  await expect(host.prepare(f.request, f.signal)).rejects.toMatchObject({code: 'SKILL_RESELECT'});
});

it('restores authenticated exact bytes across host restart without rediscovering changed skills', async () => {
  const f = await fixture(), admitted = await f.host.prepare(f.request, f.signal);
  f.records.set('command', JSON.parse(JSON.stringify(admitted.record)));
  await writeFile(join(f.folder, 'SKILL.md'), 'changed source');
  const restarted = new PersonalSkillInvocations({...f.options, catalog: {async checkReference() {throw Error('Replay must not rediscover');}}});
  const replay = await restarted.prepare(f.request, f.signal);
  expect(replay.record).toEqual(admitted.record);
  expect(restarted.runtimeInput(f.runtime, [replay], f.signal).admittedSkillGuidance[0].entry.text).toBe(document);
  expect(restarted.readSupportingFile(replay, replay.guidance[0].supportingFiles[0].handle, f.signal).toString()).toBe('first');
});

it('rejects command-ID reuse with changed content, model, thinking, reference or authority', async () => {
  const f = await fixture(), admitted = await f.host.prepare(f.request, f.signal); f.records.set('command', admitted.record);
  for (const patch of [{content: 'different'}, {modelId: 'other'}, {thinkingLevel: 'high'}, {skills: [{...f.request.payload.skills[0], revision: 'b'.repeat(64)}]}]) {
    await expect(f.host.prepare({...f.request, payload: {...f.request.payload, ...patch}}, f.signal)).rejects.toMatchObject({code: 'SKILL_REPLAY_CONFLICT'});
  }
  f.setAuthority({...authority(), accountId: 'other'});
  await expect(f.host.prepare(f.request, f.signal)).rejects.toMatchObject({code: 'SKILL_RESELECT'});
});

it('denies replay tampering and key loss instead of falling back to rediscovery', async () => {
  const f = await fixture(), admitted = await f.host.prepare(f.request, f.signal);
  const tampered = JSON.parse(JSON.stringify(admitted.record)); tampered.captures[0].files[0].data = Buffer.from('forged').toString('base64');
  f.records.set('command', tampered);
  await expect(f.host.prepare(f.request, f.signal)).rejects.toMatchObject({code: 'SKILL_RESELECT'});
  f.records.set('command', admitted.record);
  const wrongKey = new PersonalSkillInvocations({...f.options, replayKey: randomBytes(32)});
  await expect(wrongKey.prepare(f.request, f.signal)).rejects.toMatchObject({code: 'SKILL_RESELECT'});
});

it('denies forged admissions, mismatched runtime owners and arbitrary support paths', async () => {
  const f = await fixture(), admitted = await f.host.prepare(f.request, f.signal);
  for (const patch of [{threadId: 'other'}, {accountId: 'other'}, {modelId: 'other'}, {inputId: 'other'}]) expect(() => f.host.runtimeInput({...f.runtime, ...patch}, [admitted], f.signal)).toThrow();
  expect(() => f.host.runtimeInput(f.runtime, [structuredClone(admitted)], f.signal)).toThrow();
  for (const path of ['../support.txt', 'SKILL.md', '/support.txt', 'support.txt:stream', 'missing', 'support.txt\\..\\SKILL.md']) expect(() => f.host.readSupportingFile(admitted, path, f.signal)).toThrow();
  const controller = new AbortController(); controller.abort();
  expect(() => f.host.runtimeInput(f.runtime, [admitted], controller.signal)).toThrowError(expect.objectContaining({code: 'CANCELLED'}));
});

it('reads the exact Harness version/document with no latest-name or ambient projection fallback', async () => {
  const f = await fixture(), store = new Store(join(f.root, 'data')); cleanups.push(async () => store.close());
  store.internal('test.seed', null, () => applySkillOperations(store, [{action: 'create', name: 'learned', baseRevision: 0, description: 'Learned procedure', content: 'Version one'}], {kind: 'user'}));
  const catalog = new SkillCatalogRepository([harnessCatalog(store)]), ref = (await catalog.list()).skills[0].ref!;
  const request = {...f.request, payload: {...f.request.payload, skills: [ref]}};
  const host = new PersonalSkillInvocations({...f.options, catalog, readHarnessVersion: harnessVersionReader(store)});
  const admitted = await host.prepare(request, f.signal);
  expect(host.runtimeInput(f.runtime, [admitted], f.signal).admittedSkillGuidance[0].entry.text).toContain('Version one');
  store.internal('test.patch', null, () => applySkillOperations(store, [{action: 'patch', name: 'learned', baseRevision: 1, oldText: 'one', newText: 'two'}], {kind: 'user'}));
  await expect(host.prepare(request, f.signal)).rejects.toMatchObject({code: 'SKILL_RESELECT'});
  const wrong = new PersonalSkillInvocations({...f.options, catalog, readHarnessVersion: () => ({'SKILL.md': 'Version two'})});
  const current = (await catalog.list()).skills[0].ref!;
  await expect(wrong.prepare({...request, payload: {...request.payload, skills: [current]}}, f.signal)).rejects.toMatchObject({code: 'SKILL_RESELECT'});
});

it.each(['files', 'fileBytes', 'packageBytes'] as const)('denies a package exceeding %s instead of silently truncating it', async limit => {
  const f = await fixture();
  if (limit === 'files') for (let i = 0; i < 128; i++) await writeFile(join(f.folder, `file-${i}`), 'x');
  if (limit === 'fileBytes') await writeFile(join(f.folder, 'support.txt'), Buffer.alloc(1024 * 1024 + 1));
  if (limit === 'packageBytes') for (let i = 0; i < 5; i++) await writeFile(join(f.folder, `file-${i}`), Buffer.alloc(1024 * 1024));
  const ref = (await f.catalog.list()).skills[0].ref;
  expect(ref).toBeTruthy();
  const request = {...f.request, payload: {...f.request.payload, skills: [ref]}};
  await expect(f.host.prepare(request, f.signal)).rejects.toMatchObject({code: 'SKILL_RESELECT'});
});

it('rejects malformed payloads rather than accepting browser supplied text, paths or authority grants', async () => {
  const f = await fixture();
  for (const patch of [{guidance: 'cached'}, {path: f.folder}, {resources: []}, {content: ''}, {content: 'x'.repeat(65537)}]) await expect(f.host.prepare({...f.request, payload: {...f.request.payload, ...patch}}, f.signal)).rejects.toMatchObject({code: 'SKILL_RESELECT'});
});

it('selection preserves every reference field without a body read or admission capability, and bundles for browsers', async () => {
  const f = await fixture(), selected = bindSkillReference(f.request.payload.skills[0]);
  expect(selected).toEqual(f.request.payload.skills[0]);
  expect(Object.keys(selected).sort()).toEqual(['digest', 'locator', 'revision', 'scope', 'skillId', 'sourceBinding', 'sourceId', 'version']);
  expect(boundSkillReferenceSchema.safeParse({...selected, guidance: 'cached instructions'}).success).toBe(false);
  expect(skillInvocationSendPayloadSchema.safeParse({...f.request.payload, skills: Array(9).fill(selected)}).success).toBe(false);
  const result = await build({entryPoints: ['packages/contracts/skill-invocation.ts'], platform: 'browser', bundle: true, write: false});
  expect(result.outputFiles[0].text).not.toMatch(/node:|readBoundFile|withPathGuard|harnessVersionReader/);
});

it('denies a changed runtime thinking level even when the model is unchanged', async () => {
  const f = await fixture(), admitted = await f.host.prepare({...f.request, payload: {...f.request.payload, thinkingLevel: 'high'}}, f.signal);
  expect(() => f.host.runtimeInput({...f.runtime, thinkingLevel: 'low'}, [admitted], f.signal)).toThrow();
  expect(f.host.runtimeInput({...f.runtime, thinkingLevel: 'high'}, [admitted], f.signal).admittedSkillGuidance).toHaveLength(1);
});

it('preserves UTF-8 BOM and original line endings in admitted guidance', async () => {
  const f = await fixture(), exact = '\uFEFF' + document.replaceAll('\n', '\r\n');
  await writeFile(join(f.folder, 'SKILL.md'), exact);
  const ref = (await f.catalog.list()).skills[0].ref!;
  const admitted = await f.host.prepare({...f.request, payload: {...f.request.payload, skills: [ref]}}, f.signal);
  expect(admitted.guidance[0].entry.text).toBe(exact);
});

it('admits all selected references in order, never silently dropping a stale second selection', async () => {
  const f = await fixture(), other = join(f.root, 'skills', 'other'); await mkdir(other);
  await writeFile(join(other, 'SKILL.md'), document.replace('Procedure', 'Other'));
  const page = await f.catalog.list();
  const skills = page.skills.map(entry => bindSkillReference(entry.ref!));
  const request = {...f.request, payload: {...f.request.payload, skills}};
  const admitted = await f.host.prepare(request, f.signal);
  expect(admitted.guidance.map(item => item.reference)).toEqual(skills);
  await writeFile(join(other, 'SKILL.md'), 'changed');
  await expect(f.host.prepare(request, f.signal)).rejects.toMatchObject({code: 'SKILL_RESELECT'});
  await expect(f.host.prepare({...f.request, payload: {...f.request.payload, skills: [skills[0], skills[0]]}}, f.signal)).rejects.toMatchObject({code: 'SKILL_RESELECT'});
});

it('bounds Harness entry bytes before materializing an oversized saved document', async () => {
  const f = await fixture(), store = new Store(join(f.root, 'data')); cleanups.push(async () => store.close());
  store.internal('test.seed', null, () => {
    applySkillOperations(store, [{action: 'create', name: 'learned', baseRevision: 0, description: 'Procedure', content: 'Body'}], {kind: 'user'});
    const saved = store.get<object>('skillVersion', 'learned@1')!;
    store.put('skillVersion', 'learned@1', null, {...saved, document: document + 'x'.repeat(256 * 1024)});
  });
  const catalog = new SkillCatalogRepository([harnessCatalog(store)]), ref = (await catalog.list()).skills[0].ref!;
  const host = new PersonalSkillInvocations({...f.options, catalog, readHarnessVersion: harnessVersionReader(store)});
  await expect(host.prepare({...f.request, payload: {...f.request.payload, skills: [bindSkillReference(ref)]}}, f.signal)).rejects.toMatchObject({code: 'SKILL_RESELECT'});
});

it('captures only a verified installed App package, without activating its host, and rechecks registry revocation', async () => {
  const f = await fixture(), registry = join(f.root, 'registry'), folder = join(registry, 'example', '1.0.0');
  const manifest = {id: 'example', name: 'Example', version: '1.0.0', apiVersion: 1, compatibleGenVersions: '>=0.6.0', frontendEntry: 'frontend/index.html', hostEntry: 'host/index.mjs', skills: [{id: 'procedure', scope: 'personal', entry: 'skills/procedure/SKILL.md', files: ['skills/procedure/SKILL.md', 'skills/procedure/support.txt']}]};
  const files = {'plugin.json': JSON.stringify(manifest), 'frontend/index.html': '<html></html>', 'host/index.mjs': "throw Error('HOST MUST NOT ACTIVATE')", 'skills/procedure/SKILL.md': document, 'skills/procedure/support.txt': 'app support'};
  for (const [path, bytes] of Object.entries(files)) {await mkdir(dirname(join(folder, path)), {recursive: true}); await writeFile(join(folder, path), bytes);}
  const inventory = JSON.stringify({version: 1, files: Object.entries(files).map(([path, bytes]) => ({path, bytes: Buffer.byteLength(bytes), sha256: catalogHash(bytes)}))});
  await writeFile(join(folder, 'plugin-files.json'), inventory);
  await writeFile(join(registry, 'active.json'), JSON.stringify({version: 1, plugins: [{id: 'example', version: '1.0.0', digest: catalogHash(inventory)}]}));
  const catalog = new SkillCatalogRepository([installedAppCatalog({root: registry})]), ref = (await catalog.list()).skills[0].ref!;
  const request = {...f.request, payload: {...f.request.payload, skills: [bindSkillReference(ref)]}};
  const host = new PersonalSkillInvocations({...f.options, catalog}), admitted = await host.prepare(request, f.signal);
  expect(admitted.guidance[0].entry.text).toBe(document);
  expect(host.readSupportingFile(admitted, admitted.guidance[0].supportingFiles[0].handle, f.signal).toString()).toBe('app support');
  const check = catalog.checkReference.bind(catalog); let calls = 0;
  const racing = new PersonalSkillInvocations({...f.options, catalog: {async checkReference(...args: Parameters<typeof check>) {
    const value = await check(...args); if (++calls === 1) await writeFile(join(registry, 'active.json'), JSON.stringify({version: 1, plugins: []})); return value;
  }}});
  await expect(racing.prepare(request, f.signal)).rejects.toMatchObject({code: 'SKILL_RESELECT'});
  await writeFile(join(folder, 'skills/procedure/support.txt'), 'tampered');
  await expect(host.prepare(request, f.signal)).rejects.toMatchObject({code: 'SKILL_RESELECT'});
});

it('uses the bundled manifest pin and denies an index replacement between custody and capture', async () => {
  const f = await fixture(), path = 'third-party/integrations/ponytail/skills/procedure/SKILL.md';
  await mkdir(dirname(join(f.root, path)), {recursive: true}); await writeFile(join(f.root, path), document);
  const integrations = integrationIds.map(id => ({id, name: id, version: '1', upstream: {pin: 'exact-upstream'}, skills: id === 'ponytail' ? [{name: 'Procedure', path, description: 'Procedure'}] : [], files: id === 'ponytail' ? [{path, bytes: Buffer.byteLength(document), sha256: catalogHash(document)}] : []}));
  const manifestPath = join(f.root, 'third-party/integrations/manifest.json');
  await writeFile(manifestPath, JSON.stringify({version: 1, integrations}));
  const catalog = new SkillCatalogRepository([bundledCatalog(f.root)]), ref = (await catalog.list()).skills[0].ref!;
  const request = {...f.request, payload: {...f.request.payload, skills: [bindSkillReference(ref)]}};
  const host = new PersonalSkillInvocations({...f.options, catalog}); expect((await host.prepare(request, f.signal)).guidance[0].entry.text).toBe(document);
  const check = catalog.checkReference.bind(catalog); let calls = 0;
  const racing = new PersonalSkillInvocations({...f.options, catalog: {async checkReference(...args: Parameters<typeof check>) {
    const value = await check(...args); if (++calls === 1) {integrations[0].upstream.pin = 'changed'; await writeFile(manifestPath, JSON.stringify({version: 1, integrations}));} return value;
  }}});
  await expect(racing.prepare(request, f.signal)).rejects.toMatchObject({code: 'SKILL_RESELECT'});
});

it('resolves only the connected canonical project/worktree and denies its root identity changing', async () => {
  const f = await fixture(), store = new Store(join(f.root, 'data')); cleanups.push(async () => store.close());
  const project = join(f.root, 'project'), working = join(f.root, 'working'), folder = join(working, '.agents/skills/procedure');
  await mkdir(project); await mkdir(folder, {recursive: true}); await writeFile(join(folder, 'SKILL.md'), document);
  const original = await lstat(project, {bigint: true}), info = await lstat(working, {bigint: true});
  store.internal('test.seed', null, () => {
    store.put('workspaceProject', 'project', null, {id: 'project', name: 'Project', authority: {kind: 'local'}, createdAt: '2026-11-06'});
    store.put('workspaceProjectRoot', 'project', null, {path: project, identity: {dev: String(original.dev), ino: String(original.ino)}});
    store.put('thread', 'thread', 'thread', {id: 'thread', kind: 'main', projectId: 'project', workspaceId: 'working'});
    store.put('workspaceBinding', 'working', null, {id: 'working', projectId: 'project', threadId: 'thread', path: working, identity: {dev: String(info.dev), ino: String(info.ino)}});
  });
  const selectedAuthority = {...authority(), projectId: 'project', workspaceId: 'working'}; f.setAuthority(selectedAuthority);
  const catalog = new SkillCatalogRepository([projectCatalog(store)]), ref = (await catalog.list({threadId: 'thread', projectId: 'project'})).skills[0].ref!;
  const request = {...f.request, payload: {...f.request.payload, skills: [bindSkillReference(ref)]}};
  const host = new PersonalSkillInvocations({...f.options, expectedAuthority: selectedAuthority, catalog}); expect((await host.prepare(request, f.signal)).guidance[0].entry.text).toBe(document);
  store.internal('test.swap', null, () => store.put('workspaceBinding', 'working', null, {id: 'working', projectId: 'project', threadId: 'thread', path: working, identity: {dev: '0', ino: '0'}}));
  await expect(host.prepare(request, f.signal)).rejects.toMatchObject({code: 'SKILL_RESELECT'});
});

it('aborts after capture while the final source recheck is in flight', async () => {
  const f = await fixture(), check = f.catalog.checkReference.bind(f.catalog), controller = new AbortController(); let calls = 0;
  const host = new PersonalSkillInvocations({...f.options, catalog: {async checkReference(...args: Parameters<typeof check>) {const value = await check(...args); if (++calls === 2) controller.abort(); return value;}}});
  await expect(host.prepare(f.request, controller.signal)).rejects.toMatchObject({code: 'CANCELLED'});
});

it('returns cancellation while an obsolete catalog read is still pending', async () => {
  const f = await fixture(), controller = new AbortController(), check = f.catalog.checkReference.bind(f.catalog);
  let entered!: () => void, release!: () => void;
  const entry = new Promise<void>(resolve => {entered = resolve;}), gate = new Promise<void>(resolve => {release = resolve;});
  const host = new PersonalSkillInvocations({...f.options, catalog: {async checkReference(...args: Parameters<typeof check>) {const value = await check(...args); entered(); await gate; return value;}}});
  const result = host.prepare(f.request, controller.signal).then(() => 'admitted', error => error.code);
  await entry; controller.abort();
  try {expect(await Promise.race([result, new Promise(resolve => setTimeout(() => resolve('still pending'), 50))])).toBe('CANCELLED');}
  finally {release(); await result;}
});

it('replays the same command after an actual Store reopen without another message or current-source read', async () => {
  const f = await fixture(), dataDir = join(f.root, 'durable'); let store = new Store(dataDir);
  cleanups.push(async () => store.close());
  const options = {...f.options, findReplay: (id: string) => store.get('skillInvocation', id)};
  const host = new PersonalSkillInvocations(options), admission = await host.prepare(f.request, f.signal);
  const command = {id: 'command', type: 'message.send', threadId: 'thread', payload: f.request.payload};
  const receipt = store.command(command, () => {
    host.assertCurrent(admission, f.signal);
    store.put('skillInvocation', 'command', 'thread', admission.record);
    store.put('message', 'message', 'thread', {id: 'message', content: f.request.payload.content});
    store.put('outbox', 'command', 'thread', {id: 'command', status: 'persisted'});
    return {messageId: 'message'};
  });
  store.close(); store = new Store(dataDir);
  await writeFile(join(f.folder, 'SKILL.md'), 'source changed after committed Send');
  const restarted = new PersonalSkillInvocations({...options, catalog: {async checkReference() {throw Error('No replay rediscovery');}}});
  const replay = await restarted.prepare(f.request, f.signal);
  expect(restarted.runtimeInput(f.runtime, [replay], f.signal).admittedSkillGuidance[0].entry.text).toBe(document);
  expect(store.command(command, () => {throw Error('Duplicate must not commit');})).toEqual(receipt);
  expect(store.all('message')).toHaveLength(1); expect(store.all('outbox')).toHaveLength(1);
  expect(() => store.receipt({...command, payload: {...command.payload, content: 'changed'}})).toThrowError(expect.objectContaining({code: 'DUPLICATE_COMMAND'}));
});

it('precommit authority revalidation leaves message/outbox/capture storage empty on a race', async () => {
  const f = await fixture(), store = new Store(join(f.root, 'data')); cleanups.push(async () => store.close());
  const admitted = await f.host.prepare(f.request, f.signal); f.setAuthority({...authority(), workspaceId: 'swapped'});
  expect(() => store.command({id: 'command', type: 'message.send', threadId: 'thread', payload: f.request.payload}, () => {
    f.host.assertCurrent(admitted, f.signal);
    store.put('skillInvocation', 'command', 'thread', admitted.record);
    store.put('message', 'message', 'thread', {}); store.put('outbox', 'command', 'thread', {});
  })).toThrowError(expect.objectContaining({code: 'SKILL_RESELECT'}));
  expect(store.all('message')).toEqual([]); expect(store.all('outbox')).toEqual([]); expect(store.all('skillInvocation')).toEqual([]);
});

it('sanitizes authority-provider failures at precommit without leaking host paths', async () => {
  const f = await fixture(); let failed = false;
  const host = new PersonalSkillInvocations({...f.options, currentAuthority: () => {if (failed) throw Error('C:/private/authority-root'); return authority();}});
  const admitted = await host.prepare(f.request, f.signal); failed = true;
  expect(() => host.assertCurrent(admitted, f.signal)).toThrowError(expect.objectContaining({code: 'SKILL_RESELECT'}));
  try {host.assertCurrent(admitted, f.signal);} catch (error) {expect(String(error)).not.toContain('private');}
});

it('accepts the parent raw skills array while taking expected authority only from host options', async () => {
  const f = await fixture(), host = new PersonalSkillInvocations({...f.options, expectedAuthority: authority()});
  const request = {...f.request, payload: {...f.request.payload, skills: [f.request.payload.skills[0]]}};
  expect((await host.prepare(request, f.signal)).guidance[0].reference).toEqual(request.payload.skills[0]);
  await expect(host.prepare({...request, payload: {...request.payload, authority: authority()}}, f.signal)).rejects.toMatchObject({code: 'SKILL_RESELECT'});
});
