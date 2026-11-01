import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { AccountInfo, Options, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { HarnessError } from '../contracts/index.ts';
import { hostSystemPrompt } from '../runtime-pi/tool-definitions.ts';
import { officialRuntimeCommand, officialRuntimeEnvironment } from './environment.ts';
import { asyncQueue, bounded, finite, textContent, type DriverContext, type OfficialDriver } from './internal.ts';
import { saveManifest } from './manifest.ts';

export type ClaudeSdk = Pick<typeof import('@anthropic-ai/claude-agent-sdk'), 'query'>;

/** AccountInfo is metadata only. A new official process supplies it before every send. */
export function assertClaudeSubscription(account: AccountInfo): void {
  const plan = account.subscriptionType?.toLowerCase().replace(/^claude\s+/, '');
  if (account.apiProvider !== 'firstParty' || (account.apiKeySource && account.apiKeySource !== 'none') || (account.tokenSource && account.tokenSource !== 'claude.ai') || !plan || !['pro', 'max', 'ultra', 'team', 'enterprise'].includes(plan)) {
    throw new HarnessError('OFFICIAL_SUBSCRIPTION_REQUIRED', 'This connection requires your own Claude subscription signed in directly through the official Claude Code CLI. API-key, third-party, and unknown authentication contexts are not accepted here.');
  }
}

export async function openClaude(context: DriverContext, sdk: ClaudeSdk, modelId?: string): Promise<OfficialDriver> {
  const resuming = !!context.manifest.value.sessionId;
  if (!resuming) { context.manifest.value.sessionId = randomUUID(); await saveManifest(context.manifest); }
  if (!context.current()) throw new HarnessError('OFFICIAL_RUN_ABORTED', 'Official run authority was revoked.');
  const input = asyncQueue<SDKUserMessage>();
  let query: Query;
  let closed = false;
  let failed: Error | undefined;
  let rejectIo!: (error: Error) => void;
  const ioFailure = new Promise<never>((_, reject) => { rejectIo = reject; });
  // Pipe errors can arrive after initialization as well as during native spawn.
  void ioFailure.catch(() => {});
  let turnIds: string[] = [];
  let messageId = randomUUID();
  let emittedText = false;
  const pending = new Set<string>();
  let compact: { boundary: boolean; resolve: () => void; reject: (error: Error) => void } | undefined;
  const allowed = new Set([...context.mcp.names].map(name => `mcp__host__${name}`));
  const authority = () => { if (!context.current() || closed) throw new HarnessError('OFFICIAL_RUN_ABORTED', 'Official run authority was revoked.'); if (failed) throw failed; };
  const permit = (name: string) => context.current() && !closed && allowed.has(name);
  const options: Options = {
    cwd: context.taskDir,
    env: officialRuntimeEnvironment(context.dataDir, 'claude-code'),
    pathToClaudeCodeExecutable: officialRuntimeCommand('claude-code').file,
    ...(resuming ? { resume: context.manifest.value.sessionId! } : { sessionId: context.manifest.value.sessionId! }),
    tools: [], settingSources: [], strictMcpConfig: true,
    skills: [], plugins: [], agents: {},
    systemPrompt: hostSystemPrompt(context.memory),
    permissionMode: 'default', includePartialMessages: true,
    mcpServers: { host: { type: 'http', url: context.mcp.url, headers: context.mcp.headers } },
    canUseTool: async (name, args) => permit(name) ? { behavior: 'allow', updatedInput: args } : { behavior: 'deny', message: 'Only current-run host MCP tools are permitted.' },
    hooks: { PreToolUse: [{ hooks: [async hook => ({ hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: permit('tool_name' in hook ? String(hook.tool_name) : '') ? 'allow' as const : 'deny' as const, permissionDecisionReason: 'Host-only run authority.' } })] }] },
    spawnClaudeCodeProcess: options => {
      authority();
      const child = spawn(options.command, options.args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true, signal: options.signal });
      const failIo = () => {
        if (closed || failed || !context.current()) return;
        failed = new HarnessError('OFFICIAL_PROCESS_IO_FAILED', 'The native Claude connection closed unexpectedly. Reconnect the provider and refresh models.');
        rejectIo(failed); input.close(); compact?.reject(failed); compact = undefined;
        // An observer failure must neither escape a native stream listener nor
        // prevent the independent settlement/teardown notification.
        try { context.event('error', { message: failed.message }); } catch {}
        try { context.event('settled', { aborted: false }); } catch {}
      };
      child.on('error', failIo);
      for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.on('error', failIo);
      context.own(child);
      child.stderr?.resume();
      return child as ReturnType<NonNullable<Options['spawnClaudeCodeProcess']>>;
    },
  };
  query = sdk.query({ prompt: input, options });
  const driver: OfficialDriver = {
    models: [],
    async submit(wire) {
      authority(); pending.add(wire.uuid);
      input.push({ type: 'user', uuid: wire.uuid as `${string}-${string}-${string}-${string}-${string}`, parent_tool_use_id: null, client_composed: true, message: { role: 'user', content: wire.text.replace(/@/g, '\\u0040') } });
    },
    async compact() {
      authority();
      const commands = await query.supportedCommands();
      authority();
      if (!commands.some(command => command.name === 'compact')) throw new HarnessError('OFFICIAL_COMPACTION_UNSUPPORTED', 'The official Claude Code session did not advertise /compact.');
      context.event('compaction.start', { reason: 'manual' });
      await bounded(new Promise<void>((resolve, reject) => {
        compact = { boundary: false, resolve, reject };
        input.push({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: '/compact' } });
      }), 180_000, 'Official Claude Code did not confirm compaction at a terminal boundary.');
    },
    async close() {
      if (closed) return;
      closed = true; input.close();
      compact?.reject(new HarnessError('OFFICIAL_RUN_ABORTED', 'Compaction was cancelled.')); compact = undefined;
      await bounded(query.interrupt().catch(() => undefined), 1000, 'Official interrupt grace elapsed.').catch(() => {});
      query.close();
    },
  };
  context.ready(driver);
  const processing = (async () => {
    try {
      for await (const message of query) {
        if (!context.current() || closed) continue;
        const frame = message as any;
        if (frame.parent_tool_use_id) continue;
        if (frame.session_id && typeof frame.session_id === 'string') {
          const expected = context.manifest.value.sessionId;
          if (expected && frame.session_id !== expected) throw new HarnessError('OFFICIAL_SESSION_MISMATCH', 'Claude Code returned a different official session.');
          if (!expected) { context.manifest.value.sessionId = frame.session_id; context.event('session.identity'); }
        }
        // Error-result single UUIDs also label failed delivery and are not receipts.
        const uuids: string[] = frame.startup_failure_reason ? [] : Array.isArray(frame.user_message_uuids) ? frame.user_message_uuids.filter((id: unknown) => typeof id === 'string') : typeof frame.user_message_uuid === 'string' && (frame.type !== 'result' || (frame.subtype === 'success' && !frame.is_error)) ? [frame.user_message_uuid] : [];
        if (uuids.length) {
          for (const uuid of uuids) { await context.observed(uuid); pending.delete(uuid); }
          turnIds = context.inputIds(uuids);
        }
        if (frame.type === 'user' && typeof frame.uuid === 'string' && !frame.isReplay) await context.observed(frame.uuid);
        if (frame.type === 'stream_event' && frame.event?.type === 'content_block_delta' && frame.event.delta?.type === 'text_delta') context.event('assistant.delta', { messageId, delta: frame.event.delta.text });
        if (frame.type === 'assistant') {
          const content = textContent(frame.message?.content);
          if (content) { context.event('assistant.message', { messageId, content, inputIds: [...turnIds] }); emittedText = true; messageId = randomUUID(); }
          if (frame.error) context.event('error', { message: `Official Claude Code: ${frame.error}.` });
        }
        if (frame.type === 'system' && frame.subtype === 'compact_boundary' && compact) compact.boundary = true;
        if (frame.type === 'result') {
          if (compact) {
            if (compact.boundary && frame.subtype === 'success' && !frame.is_error) { compact.resolve(); context.event('compaction.end', { reason: 'manual', aborted: false }); }
            else compact.reject(new HarnessError('OFFICIAL_COMPACTION_UNCONFIRMED', 'Claude Code did not confirm a compaction boundary and successful terminal result.'));
            compact = undefined;
          } else if (frame.subtype === 'success' && !frame.is_error && !emittedText && typeof frame.result === 'string' && frame.result) {
            context.event('assistant.message', { messageId, content: frame.result, inputIds: [...turnIds] });
          }
          if (frame.subtype !== 'success' || frame.is_error) context.event('error', { message: 'Official Claude Code ended the turn with an error. Persisted history will determine input delivery.' });
          const usage = await query.getContextUsage({ detail: 'summary' }).catch(() => undefined);
          context.event('usage', { usage: { contextTokens: finite(usage?.totalTokens), contextWindow: finite(usage?.maxTokens), inputTokens: finite(frame.usage?.input_tokens), outputTokens: finite(frame.usage?.output_tokens), cost: null, sessionPercent: null, weeklyPercent: null, activity: pending.size || frame.queued_turn_count > 0 ? 'running' : 'idle' } });
          messageId = randomUUID(); emittedText = false; turnIds = [];
          if ((frame.queued_turn_count === 0 || frame.subtype !== 'success' || !pending.size) && !(frame.queued_turn_count > 0)) context.event('settled', { aborted: false });
        }
      }
      if (context.current() && !closed) throw new Error('Official Claude Code exited before a terminal result. Persisted history will determine input delivery.');
    } catch (error) { failed = error instanceof Error ? error : new Error('Official Claude Code failed.'); if (context.current() && !closed) {context.event('error', { message: failed.message });context.event('settled',{aborted:false});} }
  })();
  void processing;
  try {
    const [account, models] = await bounded(Promise.race([Promise.all([query.accountInfo(), query.supportedModels()]), ioFailure]), 30_000, 'Official Claude Code initialization timed out.');
    authority(); assertClaudeSubscription(account);
    driver.models = models.filter(model => typeof model.value === 'string' && model.value && !/[\s\u0000]/.test(model.value)).map(model => ({ id: `claude-code/${model.value}`, provider: 'claude-code', name: model.displayName, ...(model.supportedEffortLevels?.length ? { thinkingLevels: [...model.supportedEffortLevels] } : {}) }));
    if (modelId) {
      if (!driver.models.some(model => model.id === `claude-code/${modelId}`)) throw new HarnessError('OFFICIAL_MODEL_UNAVAILABLE', 'The selected Claude Code model is not advertised by the authenticated official runtime. Refresh models and select an available model.');
      await query.setModel(modelId); authority();
      if(context.thinkingLevel!==undefined){
        const selected=driver.models.find(model=>model.id===`claude-code/${modelId}`)!;
        if(context.thinkingLevel!==null&&!selected.thinkingLevels?.includes(context.thinkingLevel))throw new HarnessError('OFFICIAL_MODEL_UNAVAILABLE','The selected effort is not supported by this advertised Claude model.');
        await query.applyFlagSettings({effortLevel:context.thinkingLevel as Parameters<Query['applyFlagSettings']>[0]['effortLevel']});authority();
      }
    }
    return driver;
  } catch (error) { await driver.close(); throw error; }
}
