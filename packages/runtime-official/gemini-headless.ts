import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HarnessError } from '../contracts/index.ts';
import { terminateProcessTree } from '../runtime-pi/process-tree.ts';
import { officialRuntimeCommand, officialRuntimeEnvironment } from './environment.ts';
import { findGeminiNativeSession } from './gemini-native-history.ts';
import { bounded, finite, type DriverContext, type OfficialDriver, type WireInput } from './internal.ts';
import {MODEL_ONLY_MAX_WIRE_BYTES} from '../runtime/model-only.ts';

/** Native --resume emits only current-turn stream-json, avoiding ACP v1 replay ambiguity. */
export async function openGeminiHeadless(context: DriverContext, spawnProcess: typeof spawn, modelId?: string): Promise<OfficialDriver> {
  if (!await findGeminiNativeSession(context.dataDir, context.manifest)) throw new HarnessError('OFFICIAL_RESUME_UNSUPPORTED', 'The official Gemini session has no matching canonical native transcript. Delivery remains unresolved; native resume cannot safely continue this task.');
  const { openGemini } = await import('./gemini.ts');
  const shadow = { dataDir: context.dataDir, path: join(context.taskDir, `preflight-${randomUUID()}.json`), value: { ...structuredClone(context.manifest.value), sessionId: null, inputs: {} } };
  const preflight = await openGemini({ ...context, manifest: shadow }, spawnProcess, modelId);
  const models = preflight.models;
  const config=preflight.geminiConfig;
  if(!config)throw new HarnessError('OFFICIAL_PROTOCOL_INVALID','The official preflight has no owned configuration.');
  const promptPath=config.promptPath;
  await preflight.close();
  if (!context.current()) throw new HarnessError('OFFICIAL_RUN_ABORTED', 'Official run authority was revoked.');
  // The preflight writes app-owned settings in the task directory; use an explicit
  // host server definition for native headless mode, which has no ACP MCP argument.
  const settingsPath = join(context.taskDir, `headless-settings-${randomUUID()}.json`);
  const source = JSON.parse(await readFile(config.settingsPath, 'utf8'));
  source.mcpServers = context.modelOnly?{}:{ host: { httpUrl: context.mcp.url, headers: context.mcp.headers, trust: true, includeTools: [...context.mcp.names] } };
  await writeFile(settingsPath, JSON.stringify(source), { mode: 0o600 });
  let closed = false;
  let active: ChildProcess | undefined;
  let draining = false;
  const queue: WireInput[] = [];
  const assert = () => { if (closed || !context.current()) throw new HarnessError('OFFICIAL_RUN_ABORTED', 'Official run authority was revoked.'); };
  async function execute(wire: WireInput): Promise<void> {
    assert();
    const command = officialRuntimeCommand('gemini-cli');
    const child = active = spawnProcess(command.file, [...command.args, '--resume', context.manifest.value.sessionId!, '--model', modelId!, '--output-format', 'stream-json', '--extensions', '__harness_no_extensions__', '--allowed-mcp-server-names', 'host'], {
      cwd: context.taskDir, env: { ...officialRuntimeEnvironment(context.dataDir, 'gemini-cli'), NO_BROWSER: 'true', GEMINI_CLI_SYSTEM_SETTINGS_PATH: settingsPath, GEMINI_SYSTEM_MD: promptPath },
      stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true,
    });
    context.own(child); child.stderr?.resume();
    let buffer = ''; let initialized = false; let echoed = false; let consumed = false; let terminal = false; let status: string | undefined;
    let content = ''; let usage: any; let failure: Error | undefined;
    let writes: Promise<unknown> = Promise.resolve();
    const text = wire.text.replace(/@/g, '\\u0040');
    const receipt = () => { if (!consumed) { consumed = true; writes = writes.then(() => context.observed(wire.uuid)); } };
    const accept = (frame: any) => {
      assert();
      if (terminal) throw new HarnessError('OFFICIAL_PROTOCOL_INVALID', 'Official Gemini emitted content after its terminal result.');
      if (frame.type === 'init') {
        if (initialized || frame.session_id !== context.manifest.value.sessionId || frame.model !== modelId) throw new HarnessError('OFFICIAL_SESSION_MISMATCH', 'Official Gemini headless init did not match the selected session and model.');
        initialized = true; return;
      }
      if (!initialized) throw new HarnessError('OFFICIAL_PROTOCOL_INVALID', 'Official Gemini emitted work before session identity.');
      if (frame.type === 'message' && frame.role === 'user') {
        if (echoed || frame.content !== text) throw new HarnessError('OFFICIAL_PROTOCOL_INVALID', 'Official Gemini echoed a different current-turn input.');
        echoed = true; return; // Echo precedes LegacyAgentSession.send: not acceptance.
      }
      if (frame.type === 'message' && frame.role === 'assistant') {
        if (!echoed || typeof frame.content !== 'string') throw new HarnessError('OFFICIAL_PROTOCOL_INVALID', 'Official Gemini response lacks the current-turn input identity.');
        receipt(); content += frame.content; return;
      }
      if (frame.type === 'tool_use') {
        if (!echoed) throw new HarnessError('OFFICIAL_PROTOCOL_INVALID', 'Official Gemini tool event lacks a current-turn input.');
        const allowed = new Set([...context.mcp.names].flatMap(name => [name, `host__${name}`, `mcp_host_${name}`]));
        if (!allowed.has(frame.tool_name)) throw new HarnessError('OFFICIAL_TOOL_POLICY', 'Official Gemini exposed a tool outside the registered host MCP tools.');
        receipt(); return;
      }
      if (frame.type === 'result') {
        if (!echoed || !['success', 'error'].includes(frame.status)) throw new HarnessError('OFFICIAL_PROTOCOL_INVALID', 'Official Gemini returned no recognized current-turn terminal result.');
        terminal = true; status = frame.status; usage = frame.stats;
        if (status === 'success') receipt();
      }
    };
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', chunk => {
      if (!context.current() || closed || failure) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer) > (context.modelOnly?MODEL_ONLY_MAX_WIRE_BYTES:4*1024*1024)) { failure = new HarnessError('OFFICIAL_PROTOCOL_INVALID', 'Official Gemini JSON frame exceeded its bounded limit.'); void terminateProcessTree(child); return; }
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        try { accept(JSON.parse(line)); } catch (error) { failure = error instanceof Error ? error : new Error('Invalid official Gemini event.'); void terminateProcessTree(child); break; }
      }
    });
    const ended = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); child.stdin?.once('error', reject); });
    child.stdin?.end(text);
    const code = await bounded(ended, 180_000, 'Official Gemini headless turn did not terminate.');
    await writes; assert();
    if (failure) throw failure;
    if (code !== 0 || !terminal || status !== 'success') throw new HarnessError('OFFICIAL_TURN_FAILED', 'Official Gemini did not confirm a successful terminal turn. Native history will determine input delivery.');
    if (content) context.event('assistant.message', { messageId: randomUUID(), content, inputIds: context.inputIds([wire.uuid]) });
    context.event('usage', { usage: { contextTokens: null, contextWindow: null, inputTokens: finite(usage?.input_tokens), outputTokens: finite(usage?.output_tokens), cost: null, sessionPercent: null, weeklyPercent: null, activity: queue.length ? 'running' : 'idle' } });
    active = undefined;
  }
  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (queue.length) await execute(queue.shift()!);
      context.event('settled', { aborted: false });
    } catch (error) { if (context.current() && !closed) { context.event('error', { message: error instanceof Error ? error.message : 'Official Gemini turn failed.' }); context.event('settled', { aborted: false }); } }
    finally { draining = false; }
  }
  const driver: OfficialDriver = {
    models,
    async submit(wire) { assert(); queue.push(wire); void drain(); },
    async compact() { throw new HarnessError('OFFICIAL_COMPACTION_UNSUPPORTED', 'This pinned native headless Gemini session does not advertise a verifiable /compress command result.'); },
    async close() { if (closed) return; closed = true; queue.length = 0; if (active && active.exitCode === null && active.signalCode === null) { active.kill('SIGINT'); await bounded(new Promise<void>(resolve => active!.once('exit', () => resolve())), 500, 'Official Gemini cancellation grace elapsed.').catch(() => {}); } },
  };
  context.ready(driver);
  return driver;
}
