import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { openManifest, saveManifest } from '../packages/runtime-official/manifest.ts';
import type { DriverContext } from '../packages/runtime-official/internal.ts';

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'cursor-driver-'));
  const manifest = await openManifest(dataDir, 'cursor-sdk', 'thread', null);
  manifest.value.inputs['wire-uuid'] = { inputIds: ['input-1'], runId: 'run-host', epoch: 3, observed: false }; await saveManifest(manifest);
  const events: any[] = []; const owned: any[] = []; let current = true; let ready: any;
  const ctx: DriverContext = { dataDir, manifest, taskDir: dirname(manifest.path), memory: 'retained summary', current: () => current, event(type, value) { events.push({ type, ...value }); }, observed: vi.fn(async uuid => { manifest.value.inputs[uuid].observed = true; return manifest.value.inputs[uuid].inputIds; }), inputIds: uuids => uuids.flatMap(uuid => manifest.value.inputs[uuid]?.observed ? manifest.value.inputs[uuid].inputIds : []), own: child => owned.push(child), ready: driver => { ready = driver; }, mcp: { url: 'http://127.0.0.1:3031/mcp', headers: { Authorization: 'Bearer host-secret' }, names: new Set(['resource_read']), close: async () => {} } };
  return { dataDir, ctx, events, owned, revoke: () => { current = false; }, get ready() { return ready; } };
}
function transport(onInit?: (child: any, init: any) => void) {
  const calls: any[] = []; const children: any[] = [];
  const spawn = vi.fn((file, args, settings) => {
    const child: any = new EventEmitter(); child.exitCode = null; child.signalCode = null; child.connected = true;
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { child.exitCode = 0; child.emit('exit', 0, null); return true; };
    child.send = (message: any, callback?: (error: Error | null) => void) => { calls.push(message); callback?.(null); if (message.type === 'initialize') queueMicrotask(() => onInit?.(child, message.init)); if (message.type === 'close') { child.emit('message', { type: 'closed' }); child.exitCode = 0; child.emit('exit', 0, null); } return true; };
    children.push(child); calls.push({ file, args, settings }); return child;
  }); return { spawn, calls, children };
}
const wire = { uuid: 'wire-uuid', text: '[harness-input:v1] {"inputId":"input-1","inputIds":["input-1"],"threadId":"thread","runId":"run-host","epoch":3}\n{"prompt":"hello","resources":[]}', inputIds: ['input-1'] };

describe('Cursor official worker facade', () => {
  it.each(['stdout','stderr'] as const)('contains Cursor %s errors and settles even when the error observer throws',async stream=>{
    const {openCursor}=await import('../packages/runtime-official/cursor.ts');
    const f=await fixture(),t=transport(child=>child.emit('message',{type:'ready',sessionId:'native-session',models:[{id:'cursor-sdk/native-model',provider:'cursor-sdk',name:'Native'}]}));
    const driver=await openCursor(f.ctx,t.spawn as any,'native-model');
    const event=f.ctx.event;f.ctx.event=(type,value)=>{event(type,value);if(type==='error')throw Error('Synthetic observer failure');};
    try{
      expect(()=>t.children[0][stream].emit('error',Object.assign(Error('Private native diagnostic'),{code:'ENOTCONN'}))).not.toThrow();
      await vi.waitFor(()=>expect(f.events.some(event=>event.type==='settled')).toBe(true));
      expect(f.events.find(event=>event.type==='error')?.message).toBe('The native Cursor connection closed unexpectedly. Reconnect the provider and refresh models.');
      await vi.waitFor(()=>expect(t.children[0].exitCode).toBe(0));
    }finally{await driver.close();}
  });
  it('exists without importing or starting the native SDK in the host', async () => {
    const module = await import('../packages/runtime-official/cursor.ts').catch(() => undefined);
    expect(module?.openCursor, 'native work must have an existing authority-owned facade').toBeTypeOf('function');
  });
  it('owns and exposes cancellation before startup, with a private allowlisted environment', async () => {
    const { openCursor } = await import('../packages/runtime-official/cursor.ts');
    const f = await fixture(); const t = transport();
    process.env.CURSOR_API_KEY = 'poison-key'; process.env.CURSOR_BACKEND_URL = 'https://evil.invalid'; process.env.NODE_OPTIONS = '--require evil';
    const opening = openCursor(f.ctx, t.spawn as any, 'native-model');
    await vi.waitFor(() => expect(f.owned).toHaveLength(1)); expect(f.ready).toBeDefined();
    expect(t.calls[0].settings.env).not.toHaveProperty('CURSOR_API_KEY'); expect(t.calls[0].settings.env).not.toHaveProperty('NODE_OPTIONS'); expect(t.calls[0].settings.env).not.toHaveProperty('CURSOR_BACKEND_URL');
    expect(t.calls[0].settings.env.HOME).toBe(join(f.dataDir, 'official', 'cursor-sdk', 'home'));
    f.revoke(); await f.ready.close(); await expect(opening).rejects.toMatchObject({ code: 'OFFICIAL_RUN_ABORTED' });
    expect(t.children[0].exitCode).toBe(0);
    delete process.env.CURSOR_API_KEY; delete process.env.CURSOR_BACKEND_URL; delete process.env.NODE_OPTIONS;
  });
  it('accepts only current canonical receipts and suppresses all late events after settlement', async () => {
    const { openCursor } = await import('../packages/runtime-official/cursor.ts');
    const f = await fixture(); const t = transport(child => child.emit('message', { type: 'ready', sessionId: 'native-session', models: [{ id: 'cursor-sdk/native-model', provider: 'cursor-sdk', name: 'Native' }] }));
    const driver = await openCursor(f.ctx, t.spawn as any, 'native-model'); await driver.submit(wire);
    expect(f.ctx.observed).not.toHaveBeenCalled();
    t.children[0].emit('message', { type: 'receipt', sessionId: 'native-session', uuid: wire.uuid, text: wire.text.replace('run-host', 'wrong-run') });
    await new Promise(done => setImmediate(done)); expect(f.ctx.observed).not.toHaveBeenCalled();
    t.children[0].emit('message', { type: 'receipt', sessionId: 'native-session', uuid: wire.uuid, text: wire.text });
    t.children[0].emit('message', { type: 'assistant', uuid: wire.uuid, text: 'Result' });
    t.children[0].emit('message', { type: 'settled' });
    await vi.waitFor(() => expect(f.events.some(event => event.type === 'settled')).toBe(true));
    expect(f.ctx.observed).toHaveBeenCalledOnce(); expect(f.events.find(event => event.type === 'assistant.message')).toMatchObject({ content: 'Result', inputIds: ['input-1'] });
    await expect(driver.submit({ ...wire, uuid: 'late' })).rejects.toMatchObject({ code: 'OFFICIAL_RUN_ABORTED' });
    const count = f.events.length; t.children[0].emit('message', { type: 'assistant', uuid: wire.uuid, text: 'Late' }); await new Promise(done => setImmediate(done)); expect(f.events).toHaveLength(count);
    await expect(driver.compact()).rejects.toMatchObject({ code: 'OFFICIAL_COMPACTION_UNSUPPORTED' }); await driver.close();
  });
  it('skips discovery when there is no private login marker without spawning', async () => {
    const { discoverCursor } = await import('../packages/runtime-official/cursor.ts'); const f = await fixture(); const t = transport();
    expect(await discoverCursor(f.dataDir, t.spawn as any)).toEqual([]); expect(t.spawn).not.toHaveBeenCalled();
  });
  it('closes discovery workers after metadata and after external cancellation', async () => {
    const { discoverCursor } = await import('../packages/runtime-official/cursor.ts'); const f = await fixture(); const home = join(f.dataDir, 'official', 'cursor-sdk', 'home'); await mkdir(home, { recursive: true }); await writeFile(join(home, 'sdk-browser-login.json'), '{}');
    const t = transport(child => child.emit('message', { type: 'models', models: [{ id: 'cursor-sdk/account-model', provider: 'cursor-sdk', name: 'Account model' }] }));
    expect(await discoverCursor(f.dataDir, t.spawn as any)).toHaveLength(1); expect(t.children[0].exitCode).toBe(0);
    const hanging = transport(); const pending = discoverCursor(f.dataDir, hanging.spawn as any); await vi.waitFor(() => expect(hanging.children).toHaveLength(1)); hanging.children[0].kill();
    await expect(pending).rejects.toMatchObject({ code: 'OFFICIAL_PROTOCOL_INVALID' }); expect(hanging.children[0].exitCode).toBe(0);
  });
  it('rejects changed native session identities before a prompt and redacts native failure secrets', async () => {
    const { openCursor } = await import('../packages/runtime-official/cursor.ts'); const f = await fixture(); f.ctx.manifest.value.sessionId = 'owned-native'; await saveManifest(f.ctx.manifest);
    const t = transport(child => child.emit('message', { type: 'ready', sessionId: 'foreign-native', models: [{ id: 'cursor-sdk/native-model', provider: 'cursor-sdk', name: 'Native' }] }));
    await expect(openCursor(f.ctx, t.spawn as any, 'native-model')).rejects.toMatchObject({ code: 'OFFICIAL_PROTOCOL_INVALID' }); expect(t.calls.some(call => call.type === 'submit')).toBe(false);
    const next = await fixture(); const failing = transport(child => child.emit('message', { type: 'error', code: 'OFFICIAL_CURSOR_FAILED', message: 'key=private-user-key Authorization: Bearer host-secret' }));
    await expect(openCursor(next.ctx, failing.spawn as any, 'native-model')).rejects.not.toThrow(/private-user-key|host-secret/);
    expect(JSON.stringify(next.events)).not.toMatch(/private-user-key|host-secret/);
  });
  it('reconciles history only from exact leading envelopes with the current manifest session', async () => {
    const { cursorHistory } = await import('../packages/runtime-official/cursor.ts'); const f = await fixture(); f.ctx.manifest.value.sessionId = 'owned-native';
    const t = transport(child => child.emit('message', { type: 'history', sessionId: 'owned-native', messages: ['opaque ' + wire.text, wire.text.replace('"epoch":3', '"epoch":2'), wire.text.replace('"threadId":"thread"', '"threadId":"foreign"'), wire.text] }));
    expect(await cursorHistory(f.dataDir, f.ctx.manifest, t.spawn as any)).toEqual([{ uuid: 'wire-uuid', inputIds: ['input-1'] }]); expect(t.children[0].exitCode).toBe(0);
    const foreign = transport(child => child.emit('message', { type: 'history', sessionId: 'foreign-native', messages: [wire.text] }));
    await expect(cursorHistory(f.dataDir, f.ctx.manifest, foreign.spawn as any)).rejects.toMatchObject({ code: 'OFFICIAL_PROTOCOL_INVALID' });
  });
  it('starts the actual fixed worker and exits it on startup cancellation without SDK login', async () => {
    const { openCursor } = await import('../packages/runtime-official/cursor.ts'); const f = await fixture();
    const opening = openCursor(f.ctx, spawn, 'native-model'); const outcome = opening.catch(error => error);
    expect(f.owned).toHaveLength(1); expect(f.ready).toBeDefined();
    f.revoke(); await f.ready.close(); expect(await outcome).toMatchObject({ code: 'OFFICIAL_RUN_ABORTED' });
    expect(f.owned[0].exitCode !== null || f.owned[0].signalCode !== null).toBe(true);
  });
  it('starts and closes the actual discovery worker without accepting an unproven private credential file', async () => {
    const { discoverCursor } = await import('../packages/runtime-official/cursor.ts'); const f = await fixture(); const home = join(f.dataDir, 'official', 'cursor-sdk', 'home'); await mkdir(home, { recursive: true }); await writeFile(join(home, 'sdk-browser-login.json'), '{}');
    const children: any[] = []; const ownedSpawn = ((...args: Parameters<typeof spawn>) => { const child = spawn(...args); children.push(child); return child; }) as typeof spawn;
    await expect(discoverCursor(f.dataDir, ownedSpawn)).rejects.toMatchObject({ code: 'OFFICIAL_SUBSCRIPTION_REQUIRED' });
    expect(children).toHaveLength(1); expect(children[0].exitCode !== null || children[0].signalCode !== null).toBe(true);
  });
  it('acknowledges native runtime entry only after the parent durable receipt has completed', async () => {
    const { openCursor } = await import('../packages/runtime-official/cursor.ts'); const f = await fixture(); let release!: () => void;
    const saved = new Promise<void>(yes => { release = yes; });
    f.ctx.observed = vi.fn(async () => { await saved; return ['input-1']; });
    const t = transport(child => child.emit('message', { type: 'ready', sessionId: 'native-session', models: [{ id: 'cursor-sdk/native-model', provider: 'cursor-sdk', name: 'Native' }] }));
    const driver = await openCursor(f.ctx, t.spawn as any, 'native-model'); await driver.submit(wire);
    t.children[0].emit('message', { type: 'receipt', sessionId: 'native-session', uuid: wire.uuid, text: wire.text });
    await vi.waitFor(() => expect(f.ctx.observed).toHaveBeenCalledOnce()); expect(t.calls.some(call => call.type === 'receipt-ack')).toBe(false);
    release(); await vi.waitFor(() => expect(t.calls).toContainEqual({ type: 'receipt-ack', uuid: wire.uuid, sessionId: 'native-session' })); await driver.close();
  });
});
