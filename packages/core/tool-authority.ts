import { HarnessError } from "../contracts/index.ts";
import { integrationPrepareArgsSchema } from "../contracts/integration-secrets.ts";
import {
  actorRoleSchema,
  toolDefinitionSchema,
  type ActorRole,
  type ToolDefinitionV1,
  type ToolOwner,
  type ToolRisk,
  type ReplayClass,
} from "../contracts/tool-effects.ts";
import { OPERATION_EXECUTE, SKILL_TOOLS, TASK_FINISH, TASK_MEMORY, UI_TOOLS, VERIFICATION_DECLARE } from "../runtime-pi/tool-definitions.ts";
import { PLANNING_TOOLS } from "./planning-tools.ts";
import { toolSchemas } from "../capabilities/schemas.ts";
import { z } from "zod";
import { CONTEXT_RESULT_READ } from "./context-result-tool.ts";
import { REPOSITORY_MAP } from "./repository-map-tool.ts";
import { digest } from "../storage/store.ts";

/** Where a call's effect is executed. "internal" bindings only mutate the
 * host-owned store/presentation under the caller's owner; external bindings
 * escape it (filesystem, process, network, domain executor). */
type ExecutorBinding = "read" | "store" | "presentation" | "domain-prepare" | "domain" | "process" | "network";
const INTERNAL_BINDINGS: ReadonlySet<ExecutorBinding> = new Set(["read", "store", "presentation", "domain-prepare"]);
export type { ActorRole };

export interface RegistryEntry extends ToolDefinitionV1 {
  executorBinding: ExecutorBinding;
  /** 'operation': approval is enforced at the operation dispatch boundary;
   * 'explicit': dispatch requires a consumed single-use ApprovalV1;
   * 'none': no user approval needed (reads and internal session-state writes). */
  approval: "operation" | "explicit" | "none";
}

const registryEntrySchema = toolDefinitionSchema.extend({
  executorBinding: z.enum(["read", "store", "presentation", "domain-prepare", "domain", "process", "network"]),
  approval: z.enum(["operation", "explicit", "none"]),
});

type Row = [name: string, risk: ToolRisk, replay: ReplayClass, roles: ActorRole[], binding: ExecutorBinding, approval: RegistryEntry["approval"]];

const RUN: ActorRole[] = ["run"];
const READ_ROLES: ActorRole[] = ["run", "planning_child", "learning"];

const CLASSIFICATION: Row[] = [
  ["ui_discover", "READ", "READ_RETRYABLE", RUN, "read", "none"],
  ["context_result_read", "READ", "READ_RETRYABLE", RUN, "read", "none"],
  ["ui_inspect", "READ", "READ_RETRYABLE", RUN, "read", "none"],
  ["ui_present", "WORKSPACE_WRITE", "NONREPLAYABLE", RUN, "presentation", "none"],
  ["ui_create_widget", "WORKSPACE_WRITE", "NONREPLAYABLE", RUN, "presentation", "none"],
  ["ui_arrange", "WORKSPACE_WRITE", "NONREPLAYABLE", RUN, "presentation", "none"],
  ["ui_request_input", "WORKSPACE_WRITE", "NONREPLAYABLE", RUN, "presentation", "none"],
  ["ui_close", "WORKSPACE_WRITE", "NONREPLAYABLE", RUN, "presentation", "none"],
  ["task_finish", "WORKSPACE_WRITE", "NONREPLAYABLE", ["run", "side", "planning_child"], "store", "none"],
  ["verification_declare", "WORKSPACE_WRITE", "NONREPLAYABLE", RUN, "store", "none"],
  ["task_memory", "WORKSPACE_WRITE", "PROVIDER_IDEMPOTENT", RUN, "store", "none"],
  ["plan_update", "WORKSPACE_WRITE", "NONREPLAYABLE", RUN, "store", "none"],
  ["agent_progress", "WORKSPACE_WRITE", "NONREPLAYABLE", ["planning_child"], "store", "none"],
  ["task_delegate", "HOST_EXECUTE", "PROCESS_BOUND", RUN, "process", "explicit"],
  ["operation_execute", "HOST_EXECUTE", "NONREPLAYABLE", RUN, "domain", "operation"],
  ["skills_list", "READ", "READ_RETRYABLE", ["run", "learning", "planning_child"], "read", "none"],
  ["skill_view", "READ", "READ_RETRYABLE", ["run", "learning", "planning_child"], "read", "none"],
  ["skill_manage", "WORKSPACE_WRITE", "NONREPLAYABLE", ["run", "learning"], "store", "none"],
  ["session_search", "READ", "READ_RETRYABLE", ["run", "learning"], "read", "none"],
  ["harness_session_search", "READ", "READ_RETRYABLE", RUN, "read", "none"],
  ["integration_list", "READ", "READ_RETRYABLE", RUN, "network", "none"],
  ["integration_call", "NETWORK_WRITE", "PROVIDER_IDEMPOTENT", RUN, "network", "explicit"],
  ["integration_prepare", "HOST_EXECUTE", "NONREPLAYABLE", RUN, "domain-prepare", "operation"],
  ["repository_map", "READ", "READ_RETRYABLE", RUN, "read", "none"],
  ["repository_files", "READ", "READ_RETRYABLE", READ_ROLES, "read", "none"],
  ["repository_read", "READ", "READ_RETRYABLE", READ_ROLES, "read", "none"],
  ["repository_status", "READ", "READ_RETRYABLE", READ_ROLES, "read", "none"],
  ["repository_diff", "READ", "READ_RETRYABLE", READ_ROLES, "read", "none"],
  ["repository_log", "READ", "READ_RETRYABLE", READ_ROLES, "read", "none"],
  ["database_inspect", "READ", "READ_RETRYABLE", RUN, "read", "none"],
  ["database_schema", "READ", "READ_RETRYABLE", RUN, "read", "none"],
  ["database_query", "READ", "READ_RETRYABLE", RUN, "read", "none"],
  ["pdf_inspect", "READ", "READ_RETRYABLE", RUN, "read", "none"],
  ["text_import", "READ", "READ_RETRYABLE", READ_ROLES, "read", "none"],
  ["knowledge_publish", "WORKSPACE_WRITE", "PROVIDER_IDEMPOTENT", ["run", "planning_child"], "store", "none"],
  ["file_replace_prepare", "WORKSPACE_WRITE", "NONREPLAYABLE", RUN, "domain-prepare", "operation"],
  ["repository_test_prepare", "HOST_EXECUTE", "NONREPLAYABLE", RUN, "domain-prepare", "operation"],
  ["database_prepare", "WORKSPACE_WRITE", "NONREPLAYABLE", RUN, "domain-prepare", "operation"],
  ["pdf_prepare", "WORKSPACE_WRITE", "NONREPLAYABLE", RUN, "domain-prepare", "operation"],
];

function parametersFor(name: string): Record<string, unknown> {
  if (name === "integration_prepare") return z.toJSONSchema(integrationPrepareArgsSchema) as Record<string, unknown>;
  const known = [...UI_TOOLS, ...PLANNING_TOOLS, TASK_FINISH, VERIFICATION_DECLARE, OPERATION_EXECUTE, TASK_MEMORY, ...SKILL_TOOLS, CONTEXT_RESULT_READ, REPOSITORY_MAP].find(tool => tool.name === name);
  if (known) return known.parameters;
  const schema = toolSchemas[name as keyof typeof toolSchemas];
  if (schema) return z.toJSONSchema(schema) as Record<string, unknown>;
  return { type: "object" };
}

/** Build the host-owned registry. Duplicate IDs, invalid roles, unknown risk or
 * replay classes and missing parameter schemas are rejected at registration. */
export function buildToolRegistry(): RegistryEntry[] {
  const seen = new Set<string>();
  return CLASSIFICATION.map(([name, risk, replayClass, allowedRoles, executorBinding, approval]) => {
    if (seen.has(name)) throw new Error("Duplicate tool registration: " + name);
    seen.add(name);
    for (const role of allowedRoles) actorRoleSchema.parse(role);
    if (!INTERNAL_BINDINGS.has(executorBinding) && approval === "none" && risk !== "READ")
      throw new Error("Unclassified external effect requires an approval path: " + name);
    const parameters = parametersFor(name);
    const definition = toolDefinitionSchema.parse({ id: name, version: 1, schemaDigest: digest(parameters), risk, replayClass, allowedRoles, executorBinding });
    return { ...definition, executorBinding, approval } satisfies RegistryEntry;
  });
}

export type AuthorityDecision =
  | { kind: "ALLOW" }
  | { kind: "REQUIRE_APPROVAL"; reason: string }
  | { kind: "DENY"; reason: string };

export interface AuthorityContext {
  epoch: number;
  runId: string | null;
  accountId: string | null;
  projectId: string | null;
  workspaceId: string | null;
}

/** Pure authorization: host-resolved actor + owner (run/epoch), account,
 * project and workspace bindings against the registered definition. No I/O. */
export function authorize(definition: RegistryEntry, role: ActorRole, owner: ToolOwner, current: AuthorityContext): AuthorityDecision {
  if (!definition.allowedRoles.includes(role)) return { kind: "DENY", reason: "role_denied" };
  if (owner.epoch !== current.epoch || owner.runId !== current.runId) return { kind: "DENY", reason: "owner_revoked" };
  if ((owner.accountBinding ?? null) !== (current.accountId ?? null)) return { kind: "DENY", reason: "account_mismatch" };
  if ((owner.projectId ?? null) !== (current.projectId ?? null) || (owner.workspaceId ?? null) !== (current.workspaceId ?? null)) return { kind: "DENY", reason: "scope_changed" };
  if (definition.approval === "explicit") return { kind: "REQUIRE_APPROVAL", reason: "approval_required" };
  return { kind: "ALLOW" };
}

export class ToolAuthority {
  private readonly entries = new Map<string, RegistryEntry>();
  constructor(registry: RegistryEntry[]) {
    for (const entry of registry) {
      const definition = registryEntrySchema.parse(entry);
      if (!INTERNAL_BINDINGS.has(definition.executorBinding) && definition.approval === "none" && definition.risk !== "READ")
        throw new HarnessError("REGISTRY_CONFLICT", "Unclassified external effect requires an approval path: " + definition.id);
      if (this.entries.has(definition.id)) throw new HarnessError("REGISTRY_CONFLICT", "Duplicate tool registration: " + definition.id);
      this.entries.set(definition.id, definition);
    }
  }
  definition(name: string): RegistryEntry | undefined { return this.entries.get(name); }
  require(name: string): RegistryEntry {
    const entry = this.entries.get(name);
    if (!entry) throw new HarnessError("UNREGISTERED_TOOL", "Tool is not registered in the authority: " + name);
    return entry;
  }
  list(): RegistryEntry[] { return [...this.entries.values()]; }
}

/** M02 step-1 coverage table — every tool entry point by runtime and actor.
 * Calls that execute inside a runtime process rather than through Service.tool
 * are not host-observed; the UI shows these notes and no all-tools-audited badge.
 *   entry point                         actor            observation
 *   Service.tool (Pi routeToolCall)     run/side         ledgered via effects.invoke
 *   Official MCP loopback (createHostMcp→onTool→Service.tool)  run/side  ledgered
 *   Side runtime (SideRuntime onTool)   side             ledgered (task_finish only by side policy)
 *   PlanningCoordinator.toolBody        planning_child   ledgered via observeTool hook
 *   LearningCoordinator (learningTool)  learning         ledgered via hooks.tool wrap
 *   operation dispatch (executeOperation) run            ledgered via admitOperationDispatch
 *   Hermes native skill_tool/shared_skill_tool (worker.py) — COVERAGE_GAP:
 *     executes inside the Python runtime and is never host-observed. */
export const TOOL_COVERAGE_NOTES = [
  "Hermes native skill calls (worker.py skill_tool/shared_skill_tool) execute inside the runtime and are not host-observed (COVERAGE_GAP).",
  "Plugin-supplied calls through options.additionalTool are admitted and settled by the ledger, but their internal sub-effects are not host-observed (COVERAGE_GAP).",
  "Network and delegated calls classified REQUIRE_APPROVAL have no approval vehicle yet; they are denied until a per-call approval path lands.",
];
