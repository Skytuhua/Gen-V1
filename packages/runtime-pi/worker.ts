import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { HarnessError, type RunContext, type StartRun } from "../contracts/index.ts";
import { dispatchInput } from "./delivery.ts";
import { EventNormalizer } from "./events.ts";
import { encodeInput } from "./input-envelope.ts";
import { CheckpointBridge, sameContext, ToolBridge, type ToolReply, type CheckpointReply } from "./ipc.ts";
import {sameMemoryCheckpointRequirement} from '../runtime/memory-checkpoint.ts';
import { selectSubscriptionModel, subscriptionModels,thinkingForModel } from "./models.ts";
import { safeError } from "./sdk.ts";
import {isSubscriptionProviderId} from '../contracts/connections.ts';
import { openTaskSession, taskPaths } from "./session.ts";
import { createHostResourceLoader, createHostTools, loadDomainTools } from "./tool-definitions.ts";
import {assertModelOnlyInput,PREDICTION_MAX_OUTPUT_BYTES,PREDICTION_MAX_TOKENS,MEMORY_EXTRACTION_MAX_OUTPUT_BYTES,MEMORY_EXTRACTION_MAX_TOKENS,type ModelPurpose} from '../runtime/model-only.ts';

interface Command { type: "command"; requestId: string; command: "models" | "start" | "followUp" | "compact" | "abort"; dataDir: string; input?: StartRun; ctx?: RunContext;modelOnly?:boolean;purpose?:ModelPurpose;providerId?:unknown }
let session: AgentSession | undefined;
let bridge: ToolBridge | undefined;
let checkpointBridge:CheckpointBridge|undefined;
let initialInput:StartRun|undefined;
let context: RunContext | undefined;
let normalizer: EventNormalizer | undefined;
let shuttingDown = false;
let settled = false;
let controls = Promise.resolve();
function send(message: unknown) { if (process.connected) process.send!(message, undefined, undefined, () => {}); }
function usage() {
  if (!session || !normalizer) return;
  normalizer.usage(session.getContextUsage(), session.getSessionStats(), session.isCompacting ? "compacting" : session.isRetrying ? "retrying" : session.isIdle ? "idle" : "running");
}
function sessionPath() { if (session?.sessionFile) normalizer?.emit("session", { sessionPath: session.sessionFile }); }
function assertInputAuthority() {
  if (settled) throw new HarnessError("PI_STALE_RUN", "Pi worker run has settled. Start or resume with a fresh worker.");
  if (shuttingDown) throw new Error("Pi worker is stopping.");
}

async function initialize(command: Command) {
  const input = command.input!;
  initialInput=structuredClone(input);
  const prediction=command.purpose==='prediction',extraction=command.purpose==='memory-extraction',bounded=prediction||extraction;
  const outputLimit=prediction?PREDICTION_MAX_OUTPUT_BYTES:MEMORY_EXTRACTION_MAX_OUTPUT_BYTES;let outputBytes=0,outputExceeded=false;
  context = { threadId: input.threadId, runId: input.runId, epoch: input.epoch };
  normalizer = new EventNormalizer(context, event => {
    if(outputExceeded&&event.type!=='settled'&&event.type!=='usage')return;
    if(bounded&&(event.type==='assistant.delta'||event.type==='assistant.message')){
      const bytes=Buffer.byteLength(String(event.type==='assistant.delta'?event.delta??'':event.content??''));
      if(event.type==='assistant.delta')outputBytes+=bytes;
      if(bytes>outputLimit||outputBytes>outputLimit){outputExceeded=true;shuttingDown=true;void session?.abort().catch(()=>{});send({type:'event',event:{...context,type:'error',code:extraction?'MEMORY_EXTRACTION_OUTPUT_LIMIT':'PREDICTION_OUTPUT_LIMIT',message:extraction?'Memory extraction exceeded its output limit.':'The prediction exceeded its output limit.'},ctx:context});return;}
    }
    // Revoke locally before the host can observe settlement and clear its active run.
    if (event.type === "settled") { settled = true; session?.clearQueue(); }
    send({ type: "event", event, ctx: context });
  });
  const paths = taskPaths(command.dataDir, input.threadId);
  const { sdk, runtime, model } = await selectSubscriptionModel(paths.authPath, input.modelId);
  if (shuttingDown) throw new Error("Pi run aborted during initialization.");
  bridge = new ToolBridge(context, send);
  checkpointBridge=new CheckpointBridge(context,send);
  const customTools = command.modelOnly?[]:createHostTools(await loadDomainTools(), (id, name, args, signal) => bridge!.call(id, name, args, signal), input.programTools);
  const sessionManager = prediction?sdk.SessionManager.inMemory(paths.taskDir):await openTaskSession(command.dataDir, input,command.purpose);
  if (shuttingDown) throw new Error("Pi run aborted during initialization.");
  const created = await sdk.createAgentSession({
    cwd: paths.taskDir, agentDir: paths.agentDir, modelRuntime: runtime, model,
    thinkingLevel:prediction?'off':thinkingForModel(model,input.thinkingLevel),
    sessionManager, resourceLoader: createHostResourceLoader(sdk, input.memory,command.modelOnly,command.purpose,{
      requirement:input.memoryCheckpoint,binding:()=>({ctx:context!,sessionPath:session?.sessionFile??input.sessionPath??'',modelId:input.modelId,accountId:input.accountId??null}),
      request:(request,signal)=>checkpointBridge!.call(request,signal),assertCurrent:assertInputAuthority,
      onFailure:error=>normalizer?.emit('error',{code:error.code,message:error.message}),
    }),
    settingsManager: sdk.SettingsManager.inMemory({ cacheWarming: "off", retry: { enabled: !bounded, maxRetries: bounded?0:2 }, compaction: { enabled: !bounded } }),
    tools: customTools.map(tool => tool.name), customTools,...(command.modelOnly?{noTools:'all' as const}:{}),
  });
  session = created.session;
  if(bounded){const stream=session.agent.streamFunction;session.agent.streamFunction=(model,context,options)=>stream(model,context,{...options,maxTokens:prediction?PREDICTION_MAX_TOKENS:MEMORY_EXTRACTION_MAX_TOKENS});}
  if (shuttingDown) { session.dispose(); throw new Error("Pi run aborted during initialization."); }
  const allowed = new Set(customTools.map(tool => tool.name));
  if (session.getActiveToolNames().some(name => !allowed.has(name))) throw new Error("Pi SDK enabled a tool outside the host allowlist.");
  session.subscribe(event => {
    if (event.type === "agent_settled") { sessionPath(); usage(); }
    normalizer!.accept(event, session!);
    if (["entry_appended", "message_end", "compaction_end"].includes(event.type)) {
      sessionPath();
      // message_end is emitted before the SDK appends its message to storage.
      if (event.type !== "message_end") usage();
    }
    if (["agent_start", "compaction_start", "auto_retry_start", "auto_retry_end"].includes(event.type)) usage();
  });
  send({ type: "ready", ctx: context, tools: [...allowed] });
  sessionPath(); usage();
}

async function handle(command: Command) {
  if (command.command === "models") {
    if(command.providerId!==undefined&&!isSubscriptionProviderId(command.providerId))throw new HarnessError('INVALID_INPUT','Choose a subscription provider for model discovery.');
    return subscriptionModels(taskPaths(command.dataDir, "models").authPath,command.providerId);
  }
  if(command.purpose==='prediction'&&(command.command==='followUp'||command.command==='compact'))throw new HarnessError('PREDICTION_SESSION_UNSUPPORTED','Predictions require a fresh conversation.');
  if(command.purpose==='memory-extraction'&&(command.command==='followUp'||command.command==='compact'))throw new HarnessError('MEMORY_EXTRACTION_SESSION_UNSUPPORTED','Memory extraction requires a fresh ephemeral conversation.');
  if(command.purpose==='memory-extraction'&&!command.modelOnly)throw new HarnessError('MEMORY_EXTRACTION_INPUT_INVALID','Memory extraction requires a tool-free ephemeral transport.');
  if(command.modelOnly&&command.input)assertModelOnlyInput(command.input,command.purpose);
  assertInputAuthority();
  if (command.command === "start" || (command.command === "compact" && !session)) await initialize(command);
  if (!session || !context || !sameContext(command.input ?? command.ctx, context)) throw new Error("Stale Pi worker context.");
  assertInputAuthority();
  if (command.command === "start" || command.command === "followUp") {
    if(!sameMemoryCheckpointRequirement(command.input!.memoryCheckpoint,initialInput?.memoryCheckpoint)||(command.input!.accountId??null)!==(initialInput?.accountId??null))throw new HarnessError('MEMORY_CHECKPOINT_OWNER','Follow-up changed the captured checkpoint or account binding.');
    if (command.input!.modelId !== `${session.model?.provider}/${session.model?.id}`) throw new Error("Cannot change models inside an active run. Stop and start a new run.");
    if (command.input!.sessionPath && command.input!.sessionPath !== session.sessionFile) throw new Error("Follow-up session path does not match this task.");
    if (command.command === "followUp") {
      if (session.isCompacting) throw new Error("Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.");
      // prompt() can cross an async input preflight and start a new run after settlement.
      // Queue-only delivery cannot restart this context, even if settlement wins that race.
      const disposition = await session.followUp(encodeInput(command.input!), undefined, { source: "rpc" });
      try { assertInputAuthority(); }
      catch (error) { session.clearQueue(); throw error; }
      if (disposition === "handled") throw new Error("Pi unexpectedly consumed the application input.");
    } else {
      await dispatchInput(session, command.input!, error => {
        normalizer!.emit("error", { message: safeError(error) });
        sessionPath(); usage();
      });
    }
    sessionPath();
    return null;
  }
  if (command.command === "compact") {
    if (!session.isIdle) throw new Error("Stop the active run before compacting its session.");
    try { await session.compact(); }
    finally { sessionPath(); usage(); }
    if (session.isIdle) normalizer!.emit("settled", { aborted: false });
    return null;
  }
}

process.on("message", (message: Command | ToolReply | CheckpointReply) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "tool.result") { bridge?.receive(message); return; }
  if(message.type==='memory.checkpoint.result'){checkpointBridge?.receive(message);return;}
  if (message.type !== "command") return;
  if (message.command === "abort") {
    if (context && !sameContext(message.ctx, context)) return;
    shuttingDown = true; bridge?.close();checkpointBridge?.close();
    void (session?.abort() ?? Promise.resolve()).then(() => send({ type: "response", requestId: message.requestId, value: null }), () => send({ type: "response", requestId: message.requestId, value: null }));
    return;
  }
  controls = controls.then(async () => {
    try {
      const value = await handle(message);
      if (message.command === "followUp") assertInputAuthority();
      send({ type: "response", requestId: message.requestId, value });
    }
    catch (error) {
      const text = safeError(error);
      const code = error instanceof HarnessError ? error.code : "PI_WORKER_ERROR";
      normalizer?.emit("error", { message: text, code });
      send({ type: "response", requestId: message.requestId, error: text, code });
    }
  });
});
process.on("disconnect", () => { shuttingDown = true; bridge?.close();checkpointBridge?.close(); session?.dispose(); process.exit(0); });
process.on("uncaughtException", error => { normalizer?.emit("error", { message: safeError(error) }); bridge?.close();checkpointBridge?.close(); session?.dispose(); process.exit(1); });
process.on("unhandledRejection", error => { normalizer?.emit("error", { message: safeError(error) }); bridge?.close();checkpointBridge?.close(); session?.dispose(); process.exit(1); });
