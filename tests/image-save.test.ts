import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import type { ArtifactRecord, DataRecord, Operation, ResourceGrant, RuntimeAdapter, RuntimeCallbacks, StartRun } from '../packages/contracts/index.ts';
import { handleDomainTool, executeDomainOperation, reconcileDomainOperation, type DomainContext } from '../packages/capabilities/index.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'imgsave-')); cleanups.push(() => rmSync(d, { recursive: true, force: true })); return d; };

const png = (w = 16, h = 8) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  b[24] = 8; b[25] = 6;
  return b;
};
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

class NoRuntime implements RuntimeAdapter {
  configure(_callbacks: RuntimeCallbacks) {}
  async models() { return []; }
  async start(_input: StartRun) {}
  async followUp(_input: StartRun) {}
  async cancel() {}
  async compact() {}
  async history() { return []; }
  async dispose() {}
}

async function serviceSetup() {
  const dataDir = tempDir(), project = tempDir();
  const store = new Store(dataDir);
  const service = new Service(store, new NoRuntime(), { sideRuntimeFactory: () => new NoRuntime() });
  await service.recover();
  cleanups.push(async () => { await service.dispose(); store.close(); });
  const created = await service.command({ id: 't', type: 'thread.create', payload: { title: 'Save tests' } });
  const threadId = (created.result as { id: string }).id;
  const grant = async (payload: Record<string, unknown>) => (await service.command({ id: randomUUID(), type: 'resource.grant', threadId, payload })).result as ResourceGrant;
  const upload = async (bytes: Buffer, name = 'img.png') => (await service.command({ id: randomUUID(), type: 'resource.upload', threadId, payload: { name, base64: bytes.toString('base64') } })).result as ResourceGrant;
  const save = (payload: Record<string, unknown>) => service.command({ id: randomUUID(), type: 'image.save', threadId, payload });
  return { dataDir, project, store, service, threadId, grant, upload, save };
}

describe('image.save command (user path)', () => {
  it('saves a generated image into the writable project', async () => {
    const x = await serviceSetup();
    const image = await x.upload(png(32, 32));
    await x.grant({ path: x.project, kind: 'project', writable: true });
    const receipt = await x.save({ imageId: image.id, path: 'assets/generated/plane.png' });
    const result = receipt.result as { path: string; sha256: string };
    expect(result.path).toBe('assets/generated/plane.png');
    expect(readFileSync(join(x.project, 'assets/generated/plane.png'))).toEqual(png(32, 32));
    expect(result.sha256).toBe(sha256(png(32, 32)));
  });

  it('refuses an existing path without writing, and reports the current sha256', async () => {
    const x = await serviceSetup();
    const image = await x.upload(png());
    await x.grant({ path: x.project, kind: 'project', writable: true });
    writeFileSync(join(x.project, 'a.png'), 'occupant');
    await expect(x.save({ imageId: image.id, path: 'a.png' })).rejects.toMatchObject({ code: 'PATH_CONFLICT' });
    expect(readFileSync(join(x.project, 'a.png'), 'utf8')).toBe('occupant');
  });

  it('overwrites with a matching sha256 and rejects a mismatched one', async () => {
    const x = await serviceSetup();
    const image = await x.upload(png(20, 20));
    await x.grant({ path: x.project, kind: 'project', writable: true });
    const target = join(x.project, 'a.png');
    writeFileSync(target, 'v1');
    const good = sha256(readFileSync(target));
    await expect(x.save({ imageId: image.id, path: 'a.png', expectedSha256: '0'.repeat(64) })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(readFileSync(target, 'utf8')).toBe('v1');
    await x.save({ imageId: image.id, path: 'a.png', expectedSha256: good });
    expect(readFileSync(target)).toEqual(png(20, 20));
  });

  it('rejects traversal, absolute, hidden, storage and wrong-extension paths', async () => {
    const x = await serviceSetup();
    const image = await x.upload(png());
    await x.grant({ path: x.project, kind: 'project', writable: true });
    for (const path of ['../x.png', 'a/../x.png', '/abs.png', '.git/x.png', 'dir/.hidden.png', 'x.exe', 'x.png/../y.png']) {
      await expect(x.save({ imageId: image.id, path }), path).rejects.toThrowError();
    }
    expect(existsSync(join(x.project, 'x.png'))).toBe(false);
  });

  it('requires a writable project grant', async () => {
    const x = await serviceSetup();
    const image = await x.upload(png());
    await expect(x.save({ imageId: image.id, path: 'x.png' })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    await x.grant({ path: x.project, kind: 'project', writable: false });
    await expect(x.save({ imageId: image.id, path: 'x.png' })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  });

  it('saves a copy under a -2 suffix when asked', async () => {
    const x = await serviceSetup();
    const image = await x.upload(png(9, 9));
    await x.grant({ path: x.project, kind: 'project', writable: true });
    writeFileSync(join(x.project, 'a.png'), 'first');
    const receipt = await x.save({ imageId: image.id, path: 'a.png', saveAsCopy: true });
    expect((receipt.result as { path: string }).path).toBe('a-2.png');
    expect(readFileSync(join(x.project, 'a-2.png'))).toEqual(png(9, 9));
    expect(readFileSync(join(x.project, 'a.png'), 'utf8')).toBe('first');
  });

  it('appends the saved path to the card saved[] list', async () => {
    const x = await serviceSetup();
    const image = await x.upload(png());
    await x.grant({ path: x.project, kind: 'project', writable: true });
    const artifact: ArtifactRecord = {
      id: randomUUID(), threadId: x.threadId, messageId: 'm', title: 'card', purpose: 'test', kind: 'structured', revision: 1,
      spec: { root: 'card', elements: { card: { type: 'Stack', props: { saved: [] as string[] } } } },
      widget: null, bindings: {}, actions: {}, stateId: 's', lifecycle: 'active', placement: 'inline', pinned: false, catalogVersion: 'v1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    x.store.internal('fixture.artifact', x.threadId, () => x.store.put('artifact', artifact.id, x.threadId, artifact));
    const receipt = await x.save({ imageId: image.id, path: 'assets/x.png', artifactId: artifact.id });
    expect((receipt.result as { artifactId: string }).artifactId).toBe(artifact.id);
    const stored = x.store.get<ArtifactRecord>('artifact', artifact.id)!;
    expect(stored.spec!.elements.card.props.saved).toEqual(['assets/x.png']);
    expect(stored.revision).toBe(2);
  });
});

// --- agent path: image_save_prepare -> approved image.save ---
const agentSandbox = async () => {
  const root = tempDir(), project = tempDir(), imagePath = join(tempDir(), 'generated.png');
  writeFileSync(imagePath, png(24, 24));
  const operations: Operation[] = [];
  const ctx: DomainContext = {
    threadId: 't', signal: new AbortController().signal,
    async resolveResource(id, path, _write = false) {
      const base = id === 'image' ? imagePath : id === 'project' ? project : null;
      if (!base) throw new Error(`grant ${id} denied`);
      const target = path ? resolve(base, path) : base;
      const rel = relative(base, target);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error('Outside grant');
      return target;
    },
    async withResource<T>(id: string, path: string | undefined, write: boolean, action: (filename: string) => Promise<T>) {
      return action(await ctx.resolveResource(id, path, write));
    },
    publishData(value: unknown, provenance: string) { return { id: randomUUID(), threadId: 't', revision: 1, value, provenance, createdAt: new Date().toISOString() } as DataRecord; },
    prepareOperation(kind, args, resourceIds, preconditions, description) {
      const op: Operation = { id: randomUUID(), threadId: 't', revision: 1, kind, args, resourceIds, preconditions, description, status: 'prepared', approved: false, createdAt: new Date().toISOString() };
      operations.push(op); return op;
    },
    progress() {},
  };
  return { root, project, imagePath, ctx, operations };
};
const approve = (op: Operation): Operation => ({ ...op, approved: true, status: 'running' });

describe('image_save_prepare -> image.save (agent path)', () => {
  it('prepares without writing, requires approval, and rejects write nothing', async () => {
    const s = await agentSandbox();
    const op = await handleDomainTool('image_save_prepare', { resourceId: 'image', projectResourceId: 'project', path: 'out/x.png' }, s.ctx) as Operation;
    expect(op.kind).toBe('image.save');
    expect(op.preconditions).toMatchObject({ output: 'absent', sha256: sha256(png(24, 24)) });
    expect(existsSync(join(s.project, 'out/x.png'))).toBe(false); // prepare wrote nothing
    await expect(executeDomainOperation(op, s.ctx)).rejects.toThrowError(); // no approval
    expect(existsSync(join(s.project, 'out/x.png'))).toBe(false); // reject path writes nothing
    await executeDomainOperation(approve(op), s.ctx);
    expect(readFileSync(join(s.project, 'out/x.png'))).toEqual(png(24, 24));
  });

  it('refuses to prepare over an existing path and honors saveAsCopy', async () => {
    const s = await agentSandbox();
    writeFileSync(join(s.project, 'x.png'), 'occupant');
    await expect(handleDomainTool('image_save_prepare', { resourceId: 'image', projectResourceId: 'project', path: 'x.png' }, s.ctx)).rejects.toMatchObject({ code: 'PATH_CONFLICT' });
    const op = await handleDomainTool('image_save_prepare', { resourceId: 'image', projectResourceId: 'project', path: 'x.png', saveAsCopy: true }, s.ctx) as Operation;
    expect((op.args as { resolvedPath: string }).resolvedPath).toBe('x-2.png');
    await executeDomainOperation(approve(op), s.ctx);
    expect(readFileSync(join(s.project, 'x-2.png'))).toEqual(png(24, 24));
  });

  it('pins overwrite to expectedSha256 and fails when the target changed', async () => {
    const s = await agentSandbox();
    const target = join(s.project, 'x.png');
    writeFileSync(target, 'v1');
    const good = sha256(readFileSync(target));
    const op = await handleDomainTool('image_save_prepare', { resourceId: 'image', projectResourceId: 'project', path: 'x.png', expectedSha256: good }, s.ctx) as Operation;
    writeFileSync(target, 'v2'); // changed after preparation
    await expect(executeDomainOperation(approve(op), s.ctx)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(readFileSync(target, 'utf8')).toBe('v2');
  });

  it('rejects invalid save paths at preparation', async () => {
    const s = await agentSandbox();
    for (const path of ['../x.png', '/abs.png', '.git/x.png', 'x.exe']) {
      await expect(handleDomainTool('image_save_prepare', { resourceId: 'image', projectResourceId: 'project', path }, s.ctx), path).rejects.toThrowError();
    }
  });

  it('reconciles a completed save as succeeded and an absent target as unknown', async () => {
    const s = await agentSandbox();
    const op = await handleDomainTool('image_save_prepare', { resourceId: 'image', projectResourceId: 'project', path: 'x.png' }, s.ctx) as Operation;
    expect((await reconcileDomainOperation(approve(op), s.ctx)).status).toBe('unknown');
    await executeDomainOperation(approve(op), s.ctx);
    const reconciliation = await reconcileDomainOperation(approve(op), s.ctx);
    expect(reconciliation).toMatchObject({ status: 'succeeded', basis: 'postcondition' });
  });
});
