import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { HarnessError, type ModelInfo } from '../contracts/index.ts';
import { messageInputIds } from '../runtime-pi/input-envelope.ts';
import { terminateProcessTree } from '../runtime-pi/process-tree.ts';
import { hostSystemPrompt } from '../runtime-pi/tool-definitions.ts';
import { AcpConnection } from './acp.ts';
import { officialRuntimeCommand, officialRuntimeEnvironment, officialRuntimeHome } from './environment.ts';
import { bounded, finite, type DriverContext, type HistoryReceipt, type OfficialDriver, type WireInput } from './internal.ts';
import { saveManifest, secureDirectory, type ManifestState } from './manifest.ts';
import { createHostMcp } from './mcp.ts';

const BUILTIN_TOOLS = ['list_directory', 'read_file', 'read_many_files', 'glob', 'grep_search', 'run_shell_command', 'write_file', 'replace', 'web_fetch', 'google_web_search', 'write_todos', 'activate_skill', 'ask_user', 'get_internal_docs', 'invoke_agent', 'enter_plan_mode', 'exit_plan_mode', 'update_topic', 'complete_task', 'read_mcp_resource', 'list_mcp_resources', 'list_background_processes', 'read_background_output', 'tracker_create_task', 'tracker_update_task', 'tracker_get_task', 'tracker_list_tasks', 'tracker_add_dependency', 'tracker_visualize', 'take_snapshot'];

async function assertGoogleLogin(dataDir: string): Promise<void> {
  let settings: any;
  try { settings = JSON.parse(await readFile(join(officialRuntimeHome(dataDir, 'gemini-cli'), '.gemini', 'settings.json'), 'utf8')); }
  catch { /* Authentication metadata only; never read oauth_creds.json. */ }
  if (settings?.security?.auth?.selectedType !== 'oauth-personal') throw new HarnessError('OFFICIAL_SUBSCRIPTION_REQUIRED', 'This connection requires your own Google account signed in directly through the official Gemini CLI. API-key, Vertex, gateway, and unknown authentication contexts are not accepted here.');
}

function advertisedModels(response: any): { models: ModelInfo[]; configId?: string } {
  if (Array.isArray(response.configOptions)) {
    const model = response.configOptions.find((option: any) => option?.category === 'model' && option.type === 'select' && typeof option.id === 'string');
    if (!model) throw new HarnessError('OFFICIAL_MODEL_UNAVAILABLE', 'The official Gemini session did not advertise a selectable model.');
    const choices = (model.options ?? []).flatMap((option: any) => Array.isArray(option.options) ? option.options : [option]);
    return { configId: model.id, models: choices.filter((option: any) => typeof option.value === 'string' && option.value && !/[\s\u0000]/.test(option.value)).map((option: any) => ({ id: `gemini-cli/${option.value}`, provider: 'gemini-cli', name: typeof option.name === 'string' ? option.name : option.value })) };
  }
  // ACP v1 published 0.66.0 returns the documented legacy models field.
  const choices = response.models?.availableModels;
  if (!Array.isArray(choices)) throw new HarnessError('OFFICIAL_MODEL_UNAVAILABLE', 'The official Gemini session did not advertise models.');
  return { models: choices.filter((model: any) => typeof model.modelId === 'string' && model.modelId && !/[\s\u0000]/.test(model.modelId)).map((model: any) => ({ id: `gemini-cli/${model.modelId}`, provider: 'gemini-cli', name: typeof model.name === 'string' ? model.name : model.modelId })) };
}

function replayReceipts(manifest: ManifestState, text: string): HistoryReceipt[] {
  const ids = messageInputIds({ role: 'user', content: text });
  if (!ids.length) return [];
  try {
    const marker = JSON.parse(text.slice('[harness-input:v1] '.length, text.indexOf('\n')));
    if (marker.threadId !== manifest.value.threadId) return [];
    return Object.entries(manifest.value.inputs).flatMap(([uuid, receipt]) => receipt.runId === marker.runId && receipt.epoch === marker.epoch && JSON.stringify(receipt.inputIds) === JSON.stringify(ids) ? [{ uuid, inputIds: [...ids] }] : []);
  } catch { return []; }
}

/** Published ACP v1 is supported explicitly. V2 has a different acceptance/state lifecycle. */
export async function openGemini(context: DriverContext, spawnProcess: typeof spawn, modelId?: string, historyOnly = false): Promise<OfficialDriver> {
  await assertGoogleLogin(context.dataDir);
  if (!context.current()) throw new HarnessError('OFFICIAL_RUN_ABORTED', 'Official run authority was revoked.');
  if (context.manifest.value.sessionId && !historyOnly) return (await import('./gemini-headless.ts')).openGeminiHeadless(context, spawnProcess, modelId);
  const connectionId=randomUUID();
  const settingsPath = join(context.taskDir, `runtime-settings-${connectionId}.json`);
  const promptPath = join(context.taskDir, `system-${connectionId}.md`);
  // tools.core is an exact allowlist. No built-in class can match these MCP-only names.
  // Its high-priority deny fallback also prevents unknown future built-ins.
  const core = [...context.mcp.names].map(name => `mcp_host_${name}`);
  if (!core.length) core.push('mcp_host_no_tools');
  const settings = {
    tools: { core, exclude: BUILTIN_TOOLS },
    mcp: { allowed: ['host'], autoAllowInHeadless: false },
    mcpServers: {},
    hooksConfig: { enabled: false },
    security: { allowedExtensions: ['(?!)'], auth: { selectedType: 'oauth-personal' } },
    context: { fileName: `.harness-context-disabled-${randomUUID()}.md`, includeDirectories: [], loadMemoryFromIncludeDirectories: false, fileFiltering: { enableRecursiveFileSearch: false } },
    experimental: { autoMemory: false, extensionReloading: false, enableAgents: false },
    telemetry: { enabled: false },
    advanced: { autoConfigureMemory: false },
  };
  await Promise.all([writeFile(settingsPath, JSON.stringify(settings), { mode: 0o600 }), writeFile(promptPath, hostSystemPrompt(context.memory), { mode: 0o600 })]);
  if (!context.current()) throw new HarnessError('OFFICIAL_RUN_ABORTED', 'Official run authority was revoked.');
  const command = officialRuntimeCommand('gemini-cli');
  const child = spawnProcess(command.file, [...command.args, '--acp', '--extensions', '__harness_no_extensions__', '--allowed-mcp-server-names', 'host'], {
    cwd: context.taskDir,
    env: { ...officialRuntimeEnvironment(context.dataDir, 'gemini-cli'), NO_BROWSER: 'true', GEMINI_CLI_SYSTEM_SETTINGS_PATH: settingsPath, GEMINI_SYSTEM_MD: promptPath },
    stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true,
  });
  context.own(child);
  let closed = false;
  let sessionId = context.manifest.value.sessionId;
  let replaying = !!sessionId;
  let initializing = true;
  let commandsSeen = false;
  let commandsReady!: () => void;
  const commandsBoundary = new Promise<void>(resolve => { commandsReady = resolve; });
  let commands = new Set<string>();
  const queue: WireInput[] = [];
  let processing = false;
  let content = '';
  let contextUsage: { contextTokens: number | null; contextWindow: number | null } = { contextTokens: null, contextWindow: null };
  let activeWire: WireInput | undefined;
  const historyWrites: Promise<unknown>[] = [];
  const rpc = new AcpConnection(child, (method, params) => {
    if (method !== 'session/update' || !context.current() || closed || !params || params.sessionId !== sessionId) return;
    const update = params.update;
    if (!update || typeof update.sessionUpdate !== 'string') return;
    if (update.sessionUpdate === 'available_commands_update') {
      commands = new Set((update.availableCommands ?? []).filter((command: any) => typeof command.name === 'string').map((command: any) => command.name));
      commandsSeen = true; commandsReady();
      return;
    }
    if (update.sessionUpdate === 'user_message_chunk' && update.content?.type === 'text' && typeof update.content.text === 'string') {
      if (replaying || historyOnly) {
        for (const receipt of replayReceipts(context.manifest, update.content.text)) context.manifest.value.inputs[receipt.uuid].observed = true;
        historyWrites.push(saveManifest(context.manifest));
      } else if (activeWire && update.content.text === activeWire.text) historyWrites.push(context.observed(activeWire.uuid));
    }
    if (replaying || historyOnly || initializing) return;
    if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text' && typeof update.content.text === 'string') content += update.content.text;
    if (update.sessionUpdate === 'usage_update') contextUsage = { contextTokens: finite(update.used), contextWindow: finite(update.size) };
  });
  child.stderr?.resume();
  const assert = () => { if (!context.current() || closed) throw new HarnessError('OFFICIAL_RUN_ABORTED', 'Official run authority was revoked.'); };
  async function prompt(text: string) {
    assert();
    const result = await rpc.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, 180_000);
    assert();
    if (!['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled'].includes(result?.stopReason)) throw new HarnessError('OFFICIAL_PROTOCOL_INVALID', 'Gemini CLI returned no recognized ACP v1 terminal stop reason. Input delivery remains uncertain.');
    return result;
  }
  async function drain() {
    if (processing) return;
    processing = true;
    try {
      while (queue.length) {
        assert(); activeWire = queue.shift()!; content = '';
        const result = await prompt(activeWire.text);
        // v1 replies only when the prompt completes. A successful non-cancelled terminal
        // response proves the prompt entered the official runtime; stdin writes do not.
        if (result.stopReason !== 'cancelled') await context.observed(activeWire.uuid);
        assert();
        if (content) context.event('assistant.message', { messageId: randomUUID(), content, inputIds: result.stopReason === 'cancelled' ? [] : context.inputIds([activeWire.uuid]) });
        context.event('usage', { usage: { ...contextUsage, inputTokens: finite(result.usage?.inputTokens), outputTokens: finite(result.usage?.outputTokens), cost: null, sessionPercent: null, weeklyPercent: null, activity: queue.length ? 'running' : 'idle' } });
        activeWire = undefined;
        if (!queue.length) context.event('settled', { aborted: result.stopReason === 'cancelled' });
      }
    } catch (error) {
      if (context.current() && !closed) {
        try { context.event('error', { message: error instanceof Error ? error.message : 'Official Gemini CLI failed. Delivery remains uncertain.' }); } catch { /* Notification cannot prevent settlement. */ }
        try { context.event('settled', { aborted: false }); } catch { /* Notification cannot prevent teardown. */ }
        await driver.close();
      }
    } finally { processing = false; }
  }
  const driver: OfficialDriver = {
    models: [],
    geminiConfig:{settingsPath,promptPath},
    async submit(wire) { assert(); queue.push(wire); void drain(); },
    async compact() {
      assert();
      if (!commandsSeen) await bounded(commandsBoundary, 5000, 'Gemini CLI did not advertise session commands.');
      if (!commands.has('compress')) throw new HarnessError('OFFICIAL_COMPACTION_UNSUPPORTED', 'The official Gemini CLI session did not advertise /compress.');
      context.event('compaction.start', { reason: 'manual' });
      const result = await prompt('/compress');
      if (result.stopReason !== 'end_turn') throw new HarnessError('OFFICIAL_COMPACTION_UNCONFIRMED', 'Gemini CLI did not confirm a successful terminal /compress result.');
      context.event('compaction.end', { reason: 'manual', aborted: false });
      context.event('settled', { aborted: false });
    },
    async close() {
      if (closed) return;
      closed = true; queue.length = 0;
      try { if (sessionId) rpc.notify('session/cancel', { sessionId }); } catch { /* Exited CLI. */ }
      rpc.close(); child.stdin?.end();
      await Promise.allSettled(historyWrites);
    },
  };
  context.ready(driver);
  try {
    const initialization = await rpc.request('initialize', { protocolVersion: 1, clientInfo: { name: 'generative-harness', version: '0.4.1' }, clientCapabilities: { terminal: false, fs: { readTextFile: false, writeTextFile: false }, auth: { terminal: false } } });
    assert();
    if (initialization.protocolVersion !== 1) throw new HarnessError('OFFICIAL_ACP_UNSUPPORTED', 'This pinned Gemini CLI connection requires negotiated ACP v1. ACP v2 uses a different prompt acceptance and state lifecycle and is not enabled.');
    if (initialization.agentCapabilities?.mcpCapabilities?.http !== true) throw new HarnessError('OFFICIAL_ACP_UNSUPPORTED', 'The official Gemini CLI did not advertise HTTP MCP support.');
    if (!initialization.authMethods?.some((method: any) => method.id === 'oauth-personal')) throw new HarnessError('OFFICIAL_SUBSCRIPTION_REQUIRED', 'The official Gemini CLI did not advertise Google account login.');
    await rpc.request('authenticate', { methodId: 'oauth-personal' }); assert();
    if (sessionId && initialization.agentCapabilities?.loadSession !== true) throw new HarnessError('OFFICIAL_RESUME_UNSUPPORTED', 'The official Gemini CLI did not advertise session loading.');
    const response = await rpc.request(sessionId ? 'session/load' : 'session/new', {
      ...(sessionId ? { sessionId } : {}), cwd: context.taskDir,
      mcpServers: [{ type: 'http', name: 'host', url: context.mcp.url, headers: Object.entries(context.mcp.headers).map(([name, value]) => ({ name, value })) }],
    });
    assert();
    const id = sessionId ?? response.sessionId;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id) || (response.sessionId && response.sessionId !== id)) throw new HarnessError('OFFICIAL_SESSION_MISMATCH', 'The official Gemini CLI returned an invalid or different session identity.');
    sessionId = id; context.manifest.value.sessionId = id; await saveManifest(context.manifest); assert();
    const advertised = advertisedModels(response); driver.models = advertised.models;
    if (modelId) {
      if (!driver.models.some(model => model.id === `gemini-cli/${modelId}`)) throw new HarnessError('OFFICIAL_MODEL_UNAVAILABLE', 'The selected Gemini model is not advertised by this authenticated official session. Refresh models and select an available model.');
      if (advertised.configId) {
        const selected = await rpc.request('session/set_config_option', { sessionId, configId: advertised.configId, value: modelId });
        const option = selected.configOptions?.find((option: any) => option.id === advertised.configId);
        if (option?.currentValue !== modelId) throw new HarnessError('OFFICIAL_MODEL_UNAVAILABLE', 'The official Gemini CLI did not confirm the selected model configuration.');
      } else await rpc.request('session/set_model', { sessionId, modelId });
      assert();
    }
    if (replaying) {
      // session/load is not a complete replay receipt in published 0.66.0: its
      // streamHistory is unawaited. Reconcile only envelopes actually received
      // before this response. Missing/late envelopes retain uncertain delivery.
      await Promise.all(historyWrites); assert();
    }
    replaying = false; initializing = false;
    return driver;
  } catch (error) { await driver.close(); throw error; }
}

export async function geminiHistory(dataDir: string, manifest: ManifestState, spawnProcess: typeof spawn, owner?: Pick<DriverContext, 'current' | 'ready'>): Promise<HistoryReceipt[]> {
  const native = await import('./gemini-native-history.ts');
  if (await native.findGeminiNativeSession(dataDir, manifest)) return native.readGeminiNativeHistory(dataDir, manifest);
  let current = true;
  const active = () => current && (owner?.current() ?? true);
  const children = new Set<ChildProcess>();
  let driver: OfficialDriver | undefined;
  const mcp = await createHostMcp({ ctx: { threadId: manifest.value.threadId, runId: 'history', epoch: 0 }, current: active, onTool: async () => { throw new Error('History replay cannot execute host tools.'); }, tools: [] });
  try {
    await secureDirectory(dataDir, dirname(manifest.path));
    driver = await openGemini({ dataDir, taskDir: dirname(manifest.path), manifest, mcp, current: active,
      event() {}, observed: async () => [], inputIds: () => [], own(child) { children.add(child); child.once('exit', () => children.delete(child)); }, ready(value) { driver = value; owner?.ready(value); },
    }, spawnProcess, undefined, true);
    return Object.entries(manifest.value.inputs).filter(([, receipt]) => receipt.observed).map(([uuid, receipt]) => ({ uuid, inputIds: [...receipt.inputIds] }));
  } finally {
    current = false; await mcp.close(); await driver?.close();
    await Promise.all([...children].map(child => terminateProcessTree(child)));
  }
}
