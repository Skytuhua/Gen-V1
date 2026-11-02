export type TaskStatus = "ready" | "working" | "awaiting_input" | "stopped" | "interrupted" | "completed" | "failed";
export interface ModelInfo { id: string; provider: string; name: string; thinkingLevels?: string[] }
export interface Thread { id: string; title: string; projectName: string | null; createdAt: string; updatedAt: string; status: TaskStatus; epoch: number; runId: string | null; modelId: string | null; sessionPath: string | null; accountId?: string | null; mode?: 'plan' | 'build'; sideParentId?:string; thinkingLevel?:string|null; error?: string | null; presentation?: { pinned?: boolean; unread?: boolean; settled?: boolean; order?: number } }
export interface Message { id: string; threadId: string; role: "user" | "assistant" | "activity"; content: string; createdAt: string; runId: string | null }
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
export interface RuntimeUsage { contextTokens: number | null; contextWindow: number | null; inputTokens: number | null; outputTokens: number | null; cost: number | null; activity: "idle" | "running" | "compacting" | "retrying"; sessionPercent: number | null; weeklyPercent: number | null; contextBreakdown?: { label: string; tokens: number }[] }
export interface LearningReviewSummary {sourceThreadId:string;sourceRunId:string;modelId:string;accountId:string|null;status:'reviewing'|'completed'|'settled'|'cancelled'|'failed'|'limit'|'timeout';startedAt:string;finishedAt?:string;toolCalls:number;inputBytes:number;appliedChanges:number;usage?:Partial<RuntimeUsage>;error?:string;cleanupConfirmed?:boolean;engine?:'hermes-source';summary?:string}
export interface LearningStatus {supported:boolean;status:'idle'|'reviewing'|'blocked';lastReview:LearningReviewSummary|null;lastCuratedAt?:string}
export interface WorkspaceEvent { seq: number; id: string; type: string; threadId: string | null; payload: unknown; occurredAt: string }
export interface Snapshot { seq: number; threads: Thread[]; archivedThreads?: Thread[]; accounts?: import('./accounts.ts').ConnectionAccount[]; skills?:import('./skills.ts').SkillSummary[];skillProposals?:import('./skills.ts').SkillProposalSummary[];learning?:LearningStatus; messages: Message[]; artifacts: ArtifactRecord[]; userStates: UserStateRecord[]; data: DataRecord[]; requests: InputRequest[]; operations: Operation[]; resources: ResourceGrant[]; memory?: TaskMemory[]; usage: Record<string, RuntimeUsage>; settings: { theme: "light" | "dark" | "system"; modelId: string | null; selectedAccounts?: import('./accounts.ts').AccountSelections; preferences?: import('./preferences.ts').PreferencePatch }; activeThreadId: string | null }
export interface RunContext { threadId: string; runId: string; epoch: number }
export interface HostCommand { id: string; type: string; threadId?: string; payload: Record<string, unknown> }
export interface CommandReceipt { commandId: string; eventSeq: number; result: unknown }
export interface ToolCall { name: string; args: Record<string, unknown> }
export interface RuntimeEvent { type: string; threadId: string; runId: string; epoch: number; [key: string]: unknown }
export interface RuntimeCallbacks { onEvent: (event: RuntimeEvent) => void; onTool: (call: ToolCall, ctx: RunContext) => Promise<unknown> }
export interface StartRun extends RunContext { prompt: string; modelId: string; thinkingLevel?:string|null; sessionPath: string | null; accountId?: string | null; inputId: string; inputIds?: string[]; resources: ResourceGrant[]; memory?: string }
export interface RuntimeAdapter {
  configure(callbacks: RuntimeCallbacks): void;
  models(options?: { refresh?: boolean; accountId?: string | null }): Promise<ModelInfo[]>;
  start(input: StartRun): Promise<void>;
  followUp(input: StartRun): Promise<void>;
  cancel(ctx: RunContext): Promise<void>;
  compact(ctx: RunContext, sessionPath: string, modelId: string, accountId?: string | null): Promise<void>;
  history(sessionPath: string, accountId?: string | null): Promise<string[]>;
  dispose(): Promise<void>;
}
export interface Capability { name: string; category: string; description: string; props: Record<string, unknown>; example?: unknown }
export const EMPTY_USAGE: RuntimeUsage = { contextTokens: null, contextWindow: null, inputTokens: null, outputTokens: null, cost: null, activity: "idle", sessionPercent: null, weeklyPercent: null };
export class HarnessError extends Error { constructor(public code: string, message: string, public details?: unknown) { super(message); this.name = "HarnessError"; } }
