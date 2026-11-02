import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent, StartRun } from '../packages/contracts/index.ts';
import { createOfficialRuntime, officialRuntimeHome } from '../packages/runtime-official/index.ts';
import { encodeInput } from '../packages/runtime-pi/input-envelope.ts';
import { openManifest, saveManifest } from '../packages/runtime-official/manifest.ts';

const run = (extra: Partial<StartRun> = {}): StartRun => ({ threadId: 'thread', runId: 'run-1', epoch: 1, modelId: 'gemini-cli/official-model', inputId: 'input-1', prompt: 'hello', resources: [], sessionPath: null, ...extra });
async function data(auth = 'oauth-personal') {
  const dir = await mkdtemp(join(tmpdir(), 'official-acp-'));
  const config = join(officialRuntimeHome(dir, 'gemini-cli'), '.gemini'); await mkdir(config, { recursive: true });
  await writeFile(join(config, 'settings.json'), JSON.stringify({ security: { auth: { selectedType: auth } } }));
  return dir;
}
function acp(options: { version?: number; http?: boolean; google?: boolean; config?: boolean; holdPrompt?: boolean; holdInitialize?:boolean; replay?: string[];commands?:boolean } = {}) {
  const messages: any[] = []; const children: any[] = []; const calls: any[] = [];
  const spawn = vi.fn((_file: string, _args: string[], settings: any) => {
    calls.push({ file: _file, args: _args, settings });
    const child: any = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null; child.signalCode = null;
    child.killed = false;
    child.kill = () => { child.killed = true; child.exitCode = 0; child.emit('exit', 0, null); return true; };
    const reply = (request: any, result: any) => child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
    const update = (update: any, sessionId = 'official-session') => child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } })}\n`);
    child.update = update; child.reply = reply;
    const configOptions = [{ id: 'selected-model', category: 'model', type: 'select', currentValue: 'official-model', options: [{ value: 'official-model', name: 'Official model' }] }];
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      for (const line of chunk.toString().trim().split('\n')) {
        const message = JSON.parse(line); messages.push(message);
        if (message.method === 'initialize' && !options.holdInitialize) reply(message, { protocolVersion: options.version ?? 1, authMethods: options.google === false ? [] : [{ id: 'oauth-personal', name: 'Log in with Google' }], agentCapabilities: { loadSession: true, mcpCapabilities: { http: options.http !== false } } });
        else if (message.method === 'authenticate') reply(message, {});
        else if (message.method === 'session/new' || message.method === 'session/load') {
          for (const text of options.replay ?? []) update({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text } });
          if (options.replay) update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'old assistant must stay hidden' } });
          reply(message, { ...(message.method === 'session/new' ? { sessionId: 'official-session' } : {}), ...(options.config ? { configOptions } : { models: { currentModelId: 'official-model', availableModels: [{ modelId: 'official-model', name: 'Official model' }] } }) });
          update({ sessionUpdate: 'available_commands_update', availableCommands: options.commands===false?[]:[{ name: 'compress' }] });
        } else if (message.method === 'session/set_model') reply(message, {});
        else if (message.method === 'session/set_config_option') reply(message, { configOptions });
        else if (message.method === 'session/prompt' && !options.holdPrompt) {
          update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'official answer' } });
          reply(message, { stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 2 } });
        }
      }
      done();
    }, final(done) { child.exitCode = 0; queueMicrotask(() => child.emit('exit', 0, null)); done(); } });
    children.push(child); return child;
  });
  return { spawn: spawn as any, messages, calls, children };
}

describe('official Gemini CLI ACP runtime', () => {
  it('provides a model-only Gemini session without native MCP tools and preserves Hermes markup',async()=>{
    const fake=acp({holdPrompt:true,http:false}),events:RuntimeEvent[]=[],onTool=vi.fn(async()=>null),runtime=createOfficialRuntime({dataDir:await data(),modelOnly:true},{spawn:fake.spawn});
    runtime.configure({onEvent:event=>events.push(event),onTool});
    try{
      await runtime.start(run());await vi.waitFor(()=>expect(fake.messages.some(message=>message.method==='session/prompt')).toBe(true));
      expect(fake.messages.find(message=>message.method==='session/new')?.params.mcpServers).toEqual([]);
      const env=fake.calls[0].settings.env,settings=JSON.parse(await readFile(env.GEMINI_CLI_SYSTEM_SETTINGS_PATH,'utf8')),system=await readFile(env.GEMINI_SYSTEM_MD,'utf8');
      expect(settings.mcp.allowed).toEqual([]);expect(settings.mcpServers).toEqual({});expect(settings.tools.core).toEqual(['mcp_host_no_tools']);expect(system).toContain('text-model transport for Hermes');expect(system).not.toContain('ui_present');
      const content='<tool_call>{"name":"skill_manage"}</tool_call>\n日本語';fake.children[0].update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:content}});fake.children[0].reply(fake.messages.find(message=>message.method==='session/prompt'),{stopReason:'end_turn'});
      await vi.waitFor(()=>expect(events.some(event=>event.type==='assistant.message'&&event.content===content)).toBe(true));expect(onTool).not.toHaveBeenCalled();
    }finally{await runtime.dispose();}
  });
  it.each(['stdout','stderr'] as const)('settles an active Gemini %s failure even when the error observer throws',async stream=>{
    const fake=acp({holdPrompt:true}),events:RuntimeEvent[]=[],runtime=createOfficialRuntime({dataDir:await data()},{spawn:fake.spawn});
    runtime.configure({onEvent:event=>{events.push(event);if(event.type==='error')throw Error('Synthetic observer failure');},onTool:async()=>null});
    try{
      await runtime.start(run());await vi.waitFor(()=>expect(fake.messages.some(message=>message.method==='session/prompt')).toBe(true));
      expect(()=>fake.children[0][stream].emit('error',Object.assign(Error('Private native diagnostic'),{code:'ENOTCONN'}))).not.toThrow();
      await vi.waitFor(()=>expect(events.some(event=>event.type==='settled')).toBe(true));
      expect(events.find(event=>event.type==='error')?.message).toBe('The native Gemini connection closed unexpectedly. Reconnect the provider and refresh models.');
      expect(events.some(event=>event.type==='input.processing')).toBe(false);
    }finally{await runtime.dispose();}
  });
  it('cancels the owned Gemini history fallback before disposal reports completion',async()=>{
    const directory=await data(),manifest=await openManifest(directory,'gemini-cli','thread',null);manifest.value.sessionId='official-session';await saveManifest(manifest);
    const fake=acp({holdInitialize:true}),runtime=createOfficialRuntime({dataDir:directory},{spawn:fake.spawn});
    const history=runtime.history(manifest.path).catch(error=>error);let finished=false;void history.then(()=>{finished=true;});
    try{
      await vi.waitFor(()=>expect(fake.children).toHaveLength(1));
      await runtime.dispose();
      expect(finished).toBe(true);expect(fake.children[0].stdin.writableEnded).toBe(true);
      expect(await history).toMatchObject({code:expect.stringMatching(/^OFFICIAL_/)});
    }finally{fake.children.forEach(child=>child.stdin.end());await history;await runtime.dispose();}
  });
  it.each([true,false])('compacts a resumed native session only when compress is advertised (%s)',async advertised=>{
    const directory=await data(),manifest=await openManifest(directory,'gemini-cli','thread',null);manifest.value.sessionId='official-session';await saveManifest(manifest);
    const fake=acp({commands:advertised,replay:['historical content']}),events:RuntimeEvent[]=[],runtime=createOfficialRuntime({dataDir:directory},{spawn:fake.spawn});
    runtime.configure({onEvent:event=>events.push(event),onTool:async()=>null});
    try{
      const compact=runtime.compact(run(),manifest.path,'gemini-cli/official-model');
      if(advertised){await compact;await vi.waitFor(()=>expect(events.map(event=>event.type)).toEqual(expect.arrayContaining(['compaction.start','compaction.end','settled'])));expect(fake.messages.find(message=>message.method==='session/prompt').params.prompt).toEqual([{type:'text',text:'/compress'}]);}
      else{await expect(compact).rejects.toMatchObject({code:'OFFICIAL_COMPACTION_UNSUPPORTED'});expect(fake.messages.some(message=>message.method==='session/prompt')).toBe(false);}
      expect(events.some(event=>event.type==='assistant.message'||event.type==='input.processing')).toBe(false);
    }finally{await runtime.dispose();}
  });
  it('keeps active configuration and notes intact during concurrent history inspection',async()=>{
    const fake=acp({holdPrompt:true}),events:RuntimeEvent[]=[],runtime=createOfficialRuntime({dataDir:await data()},{spawn:fake.spawn});
    runtime.configure({onEvent:event=>events.push(event),onTool:async()=>null});
    try{
      await runtime.start(run({memory:'Preserve the current task note'}));
      const original=fake.calls[0].settings.env,settings=await readFile(original.GEMINI_CLI_SYSTEM_SETTINGS_PATH,'utf8'),prompt=await readFile(original.GEMINI_SYSTEM_MD,'utf8');
      await runtime.history(String(events.find(event=>event.type==='session')!.sessionPath));
      expect(fake.calls[1].settings.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH).not.toBe(original.GEMINI_CLI_SYSTEM_SETTINGS_PATH);
      expect(await readFile(original.GEMINI_CLI_SYSTEM_SETTINGS_PATH,'utf8')).toBe(settings);expect(await readFile(original.GEMINI_SYSTEM_MD,'utf8')).toBe(prompt);expect(prompt).toContain('Preserve the current task note');
    }finally{await runtime.dispose();}
  });
  it.each([false, true])('uses advertised model selection before a serialized prompt (configOptions=%s)', async config => {
    const fake = acp({ config, holdPrompt: true }); const runtime = createOfficialRuntime({ dataDir: await data() }, { spawn: fake.spawn });
    const events: RuntimeEvent[] = []; runtime.configure({ onEvent: event => events.push(event), onTool: async () => null });
    await runtime.start(run()); await runtime.followUp(run({ inputId: 'input-2', prompt: 'second' }));
    await vi.waitFor(() => expect(fake.messages.filter(message => message.method === 'session/prompt')).toHaveLength(1));
    const selection = fake.messages.findIndex(message => message.method === (config ? 'session/set_config_option' : 'session/set_model'));
    expect(selection).toBeGreaterThan(0); expect(selection).toBeLessThan(fake.messages.findIndex(message => message.method === 'session/prompt'));
    expect(events.some(event => event.type === 'input.processing')).toBe(false);
    const prompt = fake.messages.find(message => message.method === 'session/prompt');
    fake.children[0].update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'first answer' } });
    fake.children[0].reply(prompt, { stopReason: 'end_turn' });
    await vi.waitFor(() => expect(fake.messages.filter(message => message.method === 'session/prompt')).toHaveLength(2));
    expect(events.find(event => event.type === 'assistant.message')?.inputIds).toEqual(['input-1']);
    expect(events.some(event => event.type === 'settled')).toBe(false);
    const systemSettings = JSON.parse(await readFile(fake.calls[0].settings.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH, 'utf8'));
    expect(systemSettings.tools.core.length).toBeGreaterThan(0);
    expect(systemSettings.tools.core.every((name: string) => name.startsWith('mcp_host_'))).toBe(true);
    expect(systemSettings.hooksConfig.enabled).toBe(false);
    expect(fake.messages.find(message => message.method === 'session/new').params.mcpServers[0]).toMatchObject({ type: 'http', name: 'host' });
    expect(fake.messages.find(message => message.method === 'initialize').params.clientCapabilities.terminal).toBe(false);
    await runtime.dispose();
  });

  it.each([{ version: 2 }, { version: 99 }, { http: false }, { google: false }])('fails closed on unsupported negotiation: %j', async options => {
    const fake = acp(options); const runtime = createOfficialRuntime({ dataDir: await data() }, { spawn: fake.spawn });
    runtime.configure({ onEvent: () => {}, onTool: async () => null });
    await expect(runtime.start(run())).rejects.toMatchObject({ code: expect.stringMatching(/OFFICIAL_/) });
    expect(fake.messages.some(message => message.method === 'session/prompt')).toBe(false); await runtime.dispose();
  });

  it('rejects API-key settings without spawning the CLI and rejects unadvertised models', async () => {
    const fake = acp(); const runtime = createOfficialRuntime({ dataDir: await data('gemini-api-key') }, { spawn: fake.spawn });
    runtime.configure({ onEvent: () => {}, onTool: async () => null });
    await expect(runtime.start(run())).rejects.toMatchObject({ code: 'OFFICIAL_SUBSCRIPTION_REQUIRED' }); expect(fake.spawn).not.toHaveBeenCalled(); await runtime.dispose();
    const other = createOfficialRuntime({ dataDir: await data() }, { spawn: fake.spawn }); other.configure({ onEvent: () => {}, onTool: async () => null });
    await expect(other.start(run({ modelId: 'gemini-cli/invented' }))).rejects.toMatchObject({ code: 'OFFICIAL_MODEL_UNAVAILABLE' });
    expect(fake.messages.some(message => message.method === 'session/prompt')).toBe(false); await other.dispose();
  });

  it('cancels permissions, rejects filesystem requests, and suppresses stale session updates', async () => {
    const fake = acp({ holdPrompt: true }); const runtime = createOfficialRuntime({ dataDir: await data() }, { spawn: fake.spawn });
    const events: RuntimeEvent[] = []; const onTool = vi.fn(async () => null); runtime.configure({ onEvent: event => events.push(event), onTool }); await runtime.start(run());
    fake.children[0].stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 100, method: 'session/request_permission', params: { sessionId: 'official-session', options: [{ optionId: 'allow', kind: 'allow_once' }] } })}\n`);
    fake.children[0].stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 101, method: 'fs/read_text_file', params: { path: 'C:/secret' } })}\n`);
    await vi.waitFor(() => expect(fake.messages.find(message => message.id === 100)).toMatchObject({ result: { outcome: { outcome: 'cancelled' } } }));
    expect(fake.messages.find(message => message.id === 101)).toHaveProperty('error');
    await runtime.cancel(run()); fake.children[0].update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'late' } });
    expect(onTool).not.toHaveBeenCalled(); expect(events.some(event => event.type === 'assistant.message')).toBe(false); expect(events.filter(event => event.type === 'settled')).toHaveLength(1); await runtime.dispose();
  });

  it('refuses resumed prompts when pinned ACP cannot distinguish replayed assistants from new output', async () => {
    const directory = await data();
    const manifest = await openManifest(directory, 'gemini-cli', 'thread', null);
    manifest.value.sessionId = 'official-session'; await saveManifest(manifest);
    const fake = acp({ replay: [encodeInput(run())] });
    const runtime = createOfficialRuntime({ dataDir: directory }, { spawn: fake.spawn });
    const events: RuntimeEvent[] = []; runtime.configure({ onEvent: event => events.push(event), onTool: async () => null });
    await expect(runtime.start(run({ sessionPath: manifest.path }))).rejects.toMatchObject({ code: 'OFFICIAL_RESUME_UNSUPPORTED' });
    expect(fake.messages.some(message => message.method === 'session/prompt')).toBe(false);
    expect(events.some(event => event.type === 'assistant.message')).toBe(false);
    await runtime.dispose();
  });

  it('history reconciles only actually replayed leading host envelopes and emits no old assistants', async () => {
    const directory = await data();
    const manifest = await openManifest(directory, 'gemini-cli', 'thread', null);
    manifest.value.sessionId = 'official-session';
    manifest.value.inputs['uuid-1'] = { inputIds: ['input-1'], runId: 'run-1', epoch: 1, observed: false };
    manifest.value.inputs['uuid-2'] = { inputIds: ['input-2'], runId: 'run-1', epoch: 1, observed: false };
    await saveManifest(manifest);
    const fake = acp({ replay: [encodeInput(run()), 'User quoted this marker: ' + encodeInput(run({ inputId: 'input-2' }))] });
    const runtime = createOfficialRuntime({ dataDir: directory }, { spawn: fake.spawn });
    const events: RuntimeEvent[] = []; runtime.configure({ onEvent: event => events.push(event), onTool: async () => null });
    expect(await runtime.history(manifest.path)).toEqual(['input-1']);
    expect(events).toHaveLength(0);
    expect(fake.messages.some(message => message.method === 'session/prompt')).toBe(false);
    await runtime.dispose();
  });
});
