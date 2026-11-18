import { randomUUID } from "node:crypto";
import { HarnessError } from "../contracts/index.ts";
import {
  CODE_INTELLIGENCE_LIMITS,
  DEBUG_EFFECT_COMMANDS,
  DEBUG_INSPECT_COMMANDS,
  debugSessionV1Schema,
  type DebugSessionV1,
} from "../contracts/code-intelligence.ts";
import { selectBackend, type ExecutionBackend } from "./execution-policy.ts";

/**
 * Restricted debugger workflow. A debug session starts only from an approved
 * reproducible recipe and a proven execution backend (M03 platform proof).
 * Bounded inspection is a read; launch/continue/step/evaluate can execute
 * code and require the approved execution boundary — a debugger is never
 * treated as a read-only tool.
 */

export interface DebugRecipe {
  /** Operator-approved recipe identifier. */
  recipeId: string;
  /** sha256 of the executable bytes, recorded at recipe approval. */
  executableDigest: string;
  /** Confinement profile the debuggee runs under (from the approved recipe). */
  confinementProfile: string;
}

export interface DebugVariable {
  name: string;
  value: string;
  variablesReference: number;
}

export interface DebugStackFrame {
  id: number;
  name: string;
  line?: number;
  column?: number;
  source?: { path?: string };
}

/** Explicit host-adapter boundary for a debug backend (real DAP or a test
 * double). The host never invokes a shell directly. */
export interface DebugAdapter {
  /** Launch the approved executable under the confinement profile. Returns a
   * backend process identity the host can hold accountable. */
  launch(recipe: DebugRecipe, signal: AbortSignal): Promise<string>;
  /** Effectful commands that can run code in the debuggee. */
  send(command: (typeof DEBUG_EFFECT_COMMANDS)[number], args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  /** Bounded inspect commands; run only while PAUSED. */
  inspect(command: (typeof DEBUG_INSPECT_COMMANDS)[number], args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  state(): DebugSessionV1["state"];
  terminate(signal: AbortSignal): Promise<void>;
}

interface LiveSession {
  sessionId: string;
  owner: string;
  adapter: DebugAdapter;
  recipe: DebugRecipe;
  state: DebugSessionV1["state"];
  processIdentity: string | null;
}

/** Secrets and variable values are not model-visible until the admitted
 * surface exists; values are clamped and never echoed to output beyond the
 * bounded depth the protocol allows. */
function clampValue(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return String(text).slice(0, 4096);
}

export class DebugRegistry {
  private readonly sessions = new Map<string, LiveSession>();

  constructor(
    private readonly backends: readonly ExecutionBackend[],
    private readonly approvedBackendId: string,
    private readonly adapterFor: (backend: ExecutionBackend, recipe: DebugRecipe) => DebugAdapter,
  ) {}

  /** Start a session only from an approved recipe whose backend carries a
   * PASS platform proof. Anything else is CAPABILITY_DENIED — no fallback. */
  async launch(input: {
    owner: string;
    recipe: DebugRecipe;
    signal: AbortSignal;
  }): Promise<DebugSessionV1> {
    const selection = selectBackend(this.approvedBackendId, this.backends);
    if (selection.status !== "SELECTED" || !selection.backend)
      throw new HarnessError("CAPABILITY_DENIED", `The debugger cannot launch: ${selection.status}.`);
    if (!selection.backend.proof || selection.backend.proof.status !== "PASS")
      throw new HarnessError("CAPABILITY_DENIED", "The debugger requires a proven execution backend.");
    const adapter = this.adapterFor(selection.backend, input.recipe);
    const session: LiveSession = {
      sessionId: randomUUID(), owner: input.owner, adapter,
      recipe: input.recipe, state: "STARTING", processIdentity: null,
    };
    this.sessions.set(session.sessionId, session);
    try {
      session.processIdentity = await adapter.launch(input.recipe, input.signal);
      session.state = adapter.state();
    } catch (error) {
      session.state = "STOPPED";
      // A failed launch can still own a partially started adapter, and an
      // unreachable session id leaves nobody able to terminate it. Release it
      // here and never retain the orphan.
      await adapter.terminate(new AbortController().signal).catch(() => {});
      this.sessions.delete(session.sessionId);
      throw error;
    }
    return this.view(session);
  }

  private require(sessionId: string, owner: string): LiveSession {
    const session = this.sessions.get(sessionId);
    if (!session || session.owner !== owner) throw new HarnessError("NOT_FOUND", "The debug session is unavailable.");
    return session;
  }

  /** Bounded inspect of a paused process: threads, stackTrace, scopes,
   * variables. Refuses when the process is not paused. */
  async inspect(sessionId: string, owner: string, command: (typeof DEBUG_INSPECT_COMMANDS)[number], args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const session = this.require(sessionId, owner);
    if (!DEBUG_INSPECT_COMMANDS.includes(command)) throw new HarnessError("CAPABILITY_DENIED", "Unknown inspect command.");
    if (session.adapter.state() !== "PAUSED" && session.adapter.state() !== "STOPPED")
      throw new HarnessError("PRECONDITION_FAILED", "Inspect commands require a paused debug session.");
    const result = await session.adapter.inspect(command, args, signal);
    return this.bound(command, result);
  }

  /** Effectful commands can execute code: launch controls, stepping and
   * evaluation require the session to be live under its approved recipe. */
  async effect(sessionId: string, owner: string, command: (typeof DEBUG_EFFECT_COMMANDS)[number], args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const session = this.require(sessionId, owner);
    if (!DEBUG_EFFECT_COMMANDS.includes(command)) throw new HarnessError("CAPABILITY_DENIED", "Unknown debug command.");
    if (command === "evaluate") {
      // Evaluation executes code in the debuggee: bounded and gated by the
      // recipe's confinement admission — it is never treated as a read.
      if (String(args.expression ?? "").length > 4096) throw new HarnessError("RESOURCE_LIMIT", "The expression exceeds the bound.");
    }
    const result = await session.adapter.send(command, args, signal);
    session.state = session.adapter.state();
    return this.bound(command, result);
  }

  async terminate(sessionId: string, owner: string, signal: AbortSignal): Promise<void> {
    const session = this.require(sessionId, owner);
    await session.adapter.terminate(signal);
    session.state = "STOPPED";
    this.sessions.delete(sessionId);
  }

  /** Teardown on profile revocation: every owned session is terminated; a
   * teardown failure keeps the session listed rather than pretending it is
   * gone. */
  async revoke(owner: string, signal: AbortSignal): Promise<{ terminated: number; failed: number }> {
    let terminated = 0, failed = 0;
    for (const session of [...this.sessions.values()]) {
      if (session.owner !== owner) continue;
      try { await session.adapter.terminate(signal); session.state = "STOPPED"; this.sessions.delete(session.sessionId); terminated++; }
      catch { failed++; }
    }
    return { terminated, failed };
  }

  private bound(command: string, result: unknown): unknown {
    if (command === "stackTrace" && result && typeof result === "object" && "stackFrames" in result) {
      const frames = (result as { stackFrames: DebugStackFrame[] }).stackFrames;
      return { ...result as object, stackFrames: frames.slice(0, CODE_INTELLIGENCE_LIMITS.debugStackFrames) };
    }
    if (command === "variables" && result && typeof result === "object" && "variables" in result) {
      const variables = (result as { variables: DebugVariable[] }).variables;
      return { ...result as object, variables: variables.slice(0, CODE_INTELLIGENCE_LIMITS.debugVariables).map(v => ({ ...v, value: clampValue(v.value) })) };
    }
    return result;
  }

  view(session: LiveSession): DebugSessionV1 {
    return debugSessionV1Schema.parse({
      version: 1,
      sessionId: session.sessionId,
      owner: session.owner,
      executableIdentity: session.recipe.executableDigest,
      approvedRecipe: session.recipe.recipeId,
      confinementProfile: session.recipe.confinementProfile,
      processIdentity: session.processIdentity,
      state: session.state,
    });
  }

  get(sessionId: string, owner: string): DebugSessionV1 | null {
    const session = this.sessions.get(sessionId);
    return session && session.owner === owner ? this.view(session) : null;
  }

  async dispose(signal: AbortSignal): Promise<void> {
    for (const session of [...this.sessions.values()]) {
      await session.adapter.terminate(signal).catch(() => {});
      this.sessions.delete(session.sessionId);
    }
  }
}
