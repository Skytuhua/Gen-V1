import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent, StartRun } from '../packages/contracts/index.ts';
import { createOfficialRuntime, officialRuntimeHome } from '../packages/runtime-official/index.ts';
import { encodeInput } from '../packages/runtime-pi/input-envelope.ts';
import { openManifest, saveManifest } from '../packages/runtime-official/manifest.ts';
import { readGeminiNativeHistory } from '../packages/runtime-official/gemini-native-history.ts';

const input = (extra: Partial<StartRun> = {}): StartRun => ({ threadId: 'thread', runId: 'r-new', epoch: 2, modelId: 'gemini-cli/model-from-runtime', inputId: 'input-new', prompt: 'Read no ambient @C:/private/file.txt', resources: [], sessionPath: null, ...extra });
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'official-native-'));
  const home = officialRuntimeHome(dataDir, 'gemini-cli'); await mkdir(join(home, '.gemini'), { recursive: true });
  await writeFile(join(home, '.gemini', 'settings.json'), JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }));
  const manifest = await openManifest(dataDir, 'gemini-cli', 'thread', null);
  manifest.value.sessionId = '12345678-abcd-4000-8000-123456789000';
  manifest.value.inputs['old-client-uuid'] = { inputIds: ['old-input'], runId: 'r-old', epoch: 1, observed: false }; await saveManifest(manifest);
  const taskDir = dirname(manifest.path); const registryKey = process.platform === 'win32' ? resolve(taskDir).toLowerCase() : resolve(taskDir);
  const projectDir = join(home, '.gemini', 'tmp', 'task-slug'); await mkdir(join(projectDir, 'chats'), { recursive: true });
  await writeFile(join(home, '.gemini', 'projects.json'), JSON.stringify({ projects: { [registryKey]: 'task-slug' } }));
  await writeFile(join(projectDir, '.project_root'), registryKey);
  const nativeFile = join(projectDir, 'chats', 'session-2026-10-31T00-00-12345678.jsonl');
  const header = { sessionId: manifest.value.sessionId, projectHash: createHash('sha256').update(taskDir).digest('hex'), startTime: '2026-10-31' };
  const old = input({ runId: 'r-old', epoch: 1, inputId: 'old-input', prompt: 'old prompt' });
  await writeFile(nativeFile, [JSON.stringify(header), JSON.stringify({ type: 'user', id: 'official-user-id', content: [{ text: encodeInput(old) }] }), JSON.stringify({ type: 'gemini', content: [{ text: 'old assistant' }] })].join('\n') + '\n');
  return { dataDir, manifest, nativeFile, header };
}

describe('Gemini official headless native continuation', () => {
  it('reconciles bounded native JSONL only after exact project and session identity checks', async () => {
    const { dataDir, manifest, nativeFile, header } = await fixture();
    expect(await readGeminiNativeHistory(dataDir, manifest)).toEqual([{ uuid: 'old-client-uuid', inputIds: ['old-input'] }]);
    await writeFile(nativeFile, JSON.stringify({ ...header, projectHash: 'foreign-project' }) + '\n' + JSON.stringify({ type: 'user', content: encodeInput(input({ runId: 'r-old', epoch: 1, inputId: 'old-input' })) }));
    await expect(readGeminiNativeHistory(dataDir, manifest)).rejects.toMatchObject({ code: 'OFFICIAL_SESSION_MISMATCH' });
  });

  it.each(['before-exit','after-exit'])('runs native resume and accepts current-turn stdout arriving %s', async phase => {
    const { dataDir, manifest } = await fixture();
    const children: any[] = []; const calls: any[] = []; const inputs: string[] = [];
    const spawn = vi.fn((file: string, args: string[], settings: any) => {
      const child: any = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null; child.signalCode = null; child.kill = () => { child.exitCode = 0; child.emit('exit', 0, null); return true; };
      calls.push({ file, args, settings });
      const emit = (value: unknown) => child.stdout.write(JSON.stringify(value) + '\n'); child.emitFrame = emit;
      const isAcp = args.includes('--acp');
      child.stdin = new Writable({ write(chunk, _encoding, done) {
        if (isAcp) for (const line of chunk.toString().trim().split('\n')) {
          const request = JSON.parse(line); const reply = (result: unknown) => emit({ jsonrpc: '2.0', id: request.id, result });
          if (request.method === 'initialize') reply({ protocolVersion: 1, authMethods: [{ id: 'oauth-personal' }], agentCapabilities: { mcpCapabilities: { http: true } } });
          else if (request.method === 'authenticate' || request.method === 'session/set_model') reply({});
          else if (request.method === 'session/new') reply({ sessionId: 'preflight-only', models: { availableModels: [{ modelId: 'model-from-runtime', name: 'Official model' }] } });
        } else inputs.push(chunk.toString());
        done();
      }, final(done) {
        if (isAcp) { child.exitCode = 0; queueMicrotask(() => child.emit('exit', 0, null)); }
        else {
          emit({ type: 'init', session_id: manifest.value.sessionId, model: 'model-from-runtime' });
          emit({ type: 'message', role: 'user', content: inputs.at(-1) });
        }
        done();
      } }); children.push(child); return child;
    });
    const runtime = createOfficialRuntime({ dataDir }, { spawn: spawn as any });
    const events: RuntimeEvent[] = []; runtime.configure({ onEvent: event => events.push(event), onTool: async () => null });
    await runtime.start(input({ sessionPath: manifest.path }));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    const turn = calls.find(call => call.args.includes('--resume'));
    expect(turn.args).toContain(manifest.value.sessionId);
    expect(turn.args).toContain('stream-json');
    expect(turn.args).toContain('model-from-runtime');
    expect(inputs[0]).not.toContain('@'); expect(inputs[0]).toContain('\\u0040');
    expect(events.some(event => event.type === 'input.processing')).toBe(false);
    const child = children[1];
    if(phase==='after-exit'){child.exitCode=0;child.emit('exit',0,null);await new Promise(done=>setImmediate(done));}
    child.emitFrame({ type: 'message', role: 'assistant', content: 'current response', delta: true });
    child.emitFrame({ type: 'result', status: 'success', stats: { input_tokens: 4, output_tokens: 2 } });
    if(phase==='before-exit'){child.exitCode = 0; child.emit('exit', 0, null);}
    child.stdout.end();child.emit('close',0,null);
    await vi.waitFor(() => expect(events.some(event => event.type === 'settled')).toBe(true));
    expect(events.find(event => event.type === 'assistant.message')).toMatchObject({ content: 'current response', inputIds: ['input-new'] });
    expect(events.filter(event => event.type === 'input.processing').flatMap(event => event.inputIds)).toEqual(['input-new']);
    expect(JSON.parse(await readFile(manifest.path, 'utf8')).sessionId).toBe(manifest.value.sessionId);
    await runtime.dispose();
  });
});
