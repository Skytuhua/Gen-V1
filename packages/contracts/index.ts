export type TaskStatus = "ready" | "working" | "awaiting_input" | "stopped" | "interrupted" | "completed" | "failed";
export interface ModelInfo { id: string; provider: string; name: string; thinkingLevels?: string[] }
export interface Thread { id: string; title: string; projectName: string | null; createdAt: string; updatedAt: string; status: TaskStatus; epoch: number; runId: string | null; modelId: string | null; sessionPath: string | null; accountId?: string | null; mode?: 'plan' | 'build'; kind?:'main'|'side'|'delegate'; parentThreadId?:string;jobId?:string;projectId?:string;workspaceId?:string;sideParentId?:string; thinkingLevel?:string|null; error?: string | null; presentation?: { pinned?: boolean; unread?: boolean; settled?: boolean; order?: number } }
export interface Message { id: string; threadId: string; role: "user" | "assistant" | "activity"; content: string; createdAt: string; runId: string | null; sourceRefs?: import('./source-selection.ts').SourceRefV1[]; sendMode?: import('./source-selection.ts').SendModeV1 }
export interface TaskMemory { id: string; threadId: string; key: string; content: string; revision: number; author: 'user' | 'agent'; updatedAt: string }
export interface ElementSpec { type: string; props: Record<string, unknown>; children?: string[] }
export interface SurfaceSpec { root: string; elements: Record<string, ElementSpec> }
export interface DataRef { id: string; revision: number; pointer?: string }
export type DataBinding = { mode: "snapshot"; ref: DataRef } | { mode: "live"; id: string; pointer?: string };
export interface DataRecord { id: string; threadId: string; revision: number; value: unknown; provenance: string; createdAt: string }
export interface ActionDefinition { kind: "agent" | "operation" | "request"; label?: string; prompt?: string; operationId?: string; requestId?: string; requestRevision?: number; schema?: Record<string, unknown> }
export interface WidgetDefinition { hash: string; html: string; inputSchema: Record<string, unknown>; eventSchema: Record<string, unknown>; stateSchema: Record<string, unknown>; stateSchemaVersion: number }
export interface ArtifactPresentation { width: "compact" | "standard" | "wide"; frame: "card" | "canvas" }
export interface ArtifactRecord { id: string; threadId: string; messageId: string; title: string; purpose: string; kind: "structured" | "widget"; revision: number; spec: SurfaceSpec | null; widget: WidgetDefinition | null; bindings: Record<string, DataBinding>; actions: Record<string, ActionDefinition>; stateId: string; lifecycle: "active" | "archived"; placement: "inline" | "expanded"; pinned: boolean; presentation?: ArtifactPresentation; catalogVersion: string; createdAt: string; updatedAt: string }
export interface UserStateRecord { id: string; threadId: string; revision: number; schemaVersion: number; values: Record<string, unknown> }
export interface InputRequest { id: string; threadId: string; artifactId: string | null; revision: number; title: string; prompt: string; responseSchema: Record<string, unknown>; basis: DataRef[]; status: "pending" | "accepted" | "withdrawn" | "superseded"; response?: unknown; presentation?: import('./planning-question.ts').PlanningQuestionDefinition; detailRequests?: {id:string;kind:'explain'|'examples'|'more-options';optionId?:string;status:'pending'|'resolved'|'failed';error?:string}[] }
export interface Operation { id: string; threadId: string; revision: number; kind: string; description: string; args: Record<string, unknown>; resourceIds: string[]; preconditions: Record<string, string>; status: "prepared" | "running" | "succeeded" | "failed" | "cancelled" | "unknown"; approved: boolean; result?: unknown; error?: string; createdAt: string }
export interface ResourceGrant { id: string; threadId: string; kind: "project" | "file" | "database" | "export" | "attachment"; path: string; label: string; writable: boolean; createdAt: string; identity?: {dev:string;ino:string} }
export interface RuntimeUsage { contextTokens: number | null; contextWindow: number | null; inputTokens: number | null; outputTokens: number | null; cacheReadTokens?: number | null; cacheWriteTokens?: number | null; cost: number | null; activity: "idle" | "running" | "compacting" | "retrying" | "queued" | "starting" | "generating" | "tool" | "cleanup"; sessionPercent: number | null; weeklyPercent: number | null; contextBreakdown?: { label: string; tokens: number }[]; lastRequest?: import("./request-context.ts").ContextRequestObservationV1; inferenceBudget?: import("./request-context.ts").ContextInferenceBudgetObservationV1; hostProjection?: import("./request-context.ts").HostRequestProjectionV1; compaction?: import("./request-context.ts").CompactionProjectionV1 }
export interface LearningReviewSummary {sourceThreadId:string;sourceRunId:string;modelId:string;accountId:string|null;status:'reviewing'|'completed'|'settled'|'cancelled'|'failed'|'limit'|'timeout';startedAt:string;finishedAt?:string;toolCalls:number;inputBytes:number;appliedChanges:number;usage?:Partial<RuntimeUsage>;error?:string;cleanupConfirmed?:boolean;engine?:'hermes-source';summary?:string}
export interface LearningStatus {supported:boolean;status:'idle'|'reviewing'|'blocked';lastReview:LearningReviewSummary|null;lastCuratedAt?:string}
export type TurnOutcome = 'completed' | 'stopped' | 'interrupted' | 'failed';
export interface TurnTimingV1 { runId: string; threadId: string; startedAt: string; endedAt?: string; outcome?: TurnOutcome }
export interface WorkspaceEvent { seq: number; id: string; type: string; threadId: string | null; payload: unknown; occurredAt: string }
export interface Snapshot { seq: number; threads: Thread[]; archivedThreads?: Thread[]; accounts?: import('./accounts.ts').ConnectionAccount[]; skills?:import('./skills.ts').SkillSummary[];skillProposals?:import('./skills.ts').SkillProposalSummary[];learning?:LearningStatus; messages: Message[]; messagesTruncated?: Record<string, number>; artifacts: ArtifactRecord[]; userStates: UserStateRecord[]; data: DataRecord[]; requests: InputRequest[]; operations: Operation[]; resources: ResourceGrant[]; memory?: TaskMemory[]; turnTimings?: TurnTimingV1[]; usage: Record<string, RuntimeUsage>; modelRequests?: Record<string, import('./model-request.ts').ModelRequestObservationV1[]>; settings: { theme: "light" | "dark" | "system"; modelId: string | null; selectedAccounts?: import('./accounts.ts').AccountSelections; preferences?: import('./preferences.ts').PreferencePatch }; activeThreadId: string | null }
export interface RunContext { threadId: string; runId: string; epoch: number }
/** Host custody only: never accepted from tool arguments or encoded into model prompts. */
export interface ApprovedWriteOrigin extends RunContext {sessionPath:string;modelId:string;accountId:string|null;projectId:string;workspaceId:string;projectRoot:string}
export interface CompletedWriteReceipt {operationId:string;revision:number;inputId:string;origin:ApprovedWriteOrigin;path:string;sha256:string;bytes:number;delivery?:RunContext}
export interface WriteHookDiagnostic {operationId:string;revision:number;inputId:string;status:'applied'|'failed'|'stale'|'disabled'|'no_project'|'scope_unavailable'|'unknown';message:string}
export interface HostCommand { id: string; type: string; threadId?: string; payload: Record<string, unknown> }
export interface CommandReceipt { commandId: string; eventSeq: number; result: unknown }
export interface ToolCall { name: string; args: Record<string, unknown> }
export interface RuntimeEvent { type: string; threadId: string; runId: string; epoch: number; [key: string]: unknown }
export interface RuntimeCallbacks { onEvent: (event: RuntimeEvent) => void; onTool: (call: ToolCall, ctx: RunContext) => Promise<unknown>; onMemoryCheckpoint?: (request: import('./memory-checkpoint.ts').MemoryCheckpointRequestV1) => Promise<import('./memory-checkpoint.ts').MemoryCheckpointAckV1>; onBeforeInference?: (request: import('./request-context.ts').InferenceAdmissionV1) => void | Promise<void>; onCompactionCommit?: (request: import('./native-compaction.ts').NativeCompactionAdmissionV1) => import('./native-compaction.ts').NativeCompactionAckV1 }
export interface StartRun extends RunContext { prompt: string; modelId: string; thinkingLevel?:string|null; sessionPath: string | null; accountId?: string | null; inputId: string; inputIds?: string[]; resources: ResourceGrant[]; memory?: string; completedWrites?:CompletedWriteReceipt[]; requestContext?:import('./request-context.ts').RequestContextV1; memoryCheckpoint?:import('./memory-checkpoint.ts').MemoryCheckpointRequirementV1; automaticCompactionProtection?:import('./native-compaction.ts').AutomaticCompactionRequirementV1; sourceRefs?:import('./source-selection.ts').SourceRefV1[]; approvedProjectContext?:import('./request-context.ts').ApprovedProjectContextV1 }
export interface RuntimeAdapter {
  configure(callbacks: RuntimeCallbacks): void;
  models(options?: { refresh?: boolean; accountId?: string | null; providerId?: import('./connections.ts').ConnectionProviderId }): Promise<ModelInfo[]>;
  /** Drop cached model catalogs for an account (or all) after sign-out so a stale catalog is never served. */
  invalidateModels?(options?: { accountId?: string | null; providerId?: import('./connections.ts').ConnectionProviderId }): Promise<void>;
  start(input: StartRun): Promise<void>;
  followUp(input: StartRun): Promise<void>;
  cancel(ctx: RunContext): Promise<void>;
  compact(ctx: RunContext, sessionPath: string, modelId: string, accountId?: string | null, memoryCheckpoint?:import('./memory-checkpoint.ts').MemoryCheckpointRequirementV1, expectedHistorySha256?: string): Promise<void>;
  /** Optional protected native operation; unavailable adapters must never emulate it. */
  compactProtected?(ctx: RunContext, sessionPath: string, modelId: string, accountId: string | null, protection: import('./native-compaction.ts').NativeCompactionEnvelopeV1, memoryCheckpoint?: import('./memory-checkpoint.ts').MemoryCheckpointRequirementV1): Promise<import('./native-compaction.ts').NativeCompactionReceiptV1>;
  history(sessionPath: string, accountId?: string | null): Promise<string[]>;
  /** Live native history digest for exact-source-cut compare-and-swap compaction; absent when the adapter has no CAS channel. */
  nativeHistoryDigest?(ctx: RunContext, sessionPath: string, accountId?: string | null): Promise<{ sha256: string; messages: unknown[] } | null>;
  dispose(): Promise<void>;
}
export interface Capability { name: string; category: string; description: string; props: Record<string, unknown>; example?: unknown }
export const EMPTY_USAGE: RuntimeUsage = { contextTokens: null, contextWindow: null, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, cost: null, activity: "idle", sessionPercent: null, weeklyPercent: null };
export class HarnessError extends Error { constructor(public code: string, message: string, public details?: unknown) { super(message); this.name = "HarnessError"; } }
export * from "./tool-effects.ts";
export type * from "./request-context.ts";
