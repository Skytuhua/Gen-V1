import { randomUUID } from "node:crypto";

import {
  HarnessError,
  type ApprovedWriteOrigin,
  type ArtifactRecord,
  type DataRecord,
  type ResourceGrant,
  type RunContext,
  type Thread,
  type UserStateRecord,
} from "../contracts/index.ts";
import type { Store } from "../storage/store.ts";
import { resolveGrant } from "./security.ts";
import type { ToolEffectLedger } from "./tool-effects.ts";
import { threadData } from "./ui-admission.ts";

type Lease = { id: string; threadId: string; clientId: string; fields: string[]; expiresAt: number };

/** Cross-domain calls a `ServiceResources` needs back into `Service`. */
export interface ServiceResourcesHost {
  store: Store;
  effects: ToolEffectLedger;
  thread(id: string): Thread;
  hasGate(id: string): boolean;
  approvedWriteHooks(): boolean;
  context(
    threadId: string,
    signal: AbortSignal,
  ): {
    resolveResource(id: string, relativePath?: string, write?: boolean): Promise<string>;
    withResource?<T>(id: string, relativePath: string | undefined, write: boolean, action: (filename: string) => Promise<T>): Promise<T>;
    publishData(value: unknown, provenance: string): DataRecord;
    progress(message: string, counts?: Record<string, number>): unknown;
  };
}

const now = () => new Date().toISOString();

/**
 * The resources/artifacts/data domain: mutation gates, artifact and state
 * lookup, leases, resource-grant resolution, dataset reads/publishes, approved
 * write origins, and the read-only domain surface for agent children.
 */
export class ServiceResources {
  constructor(private readonly host: ServiceResourcesHost) {}

  assertMutation(threadId: string): void {
    const { host } = this;
    host.effects.assertAdmissionsEnabled();
    const thread = host.thread(threadId);
    if (thread.mode === "plan") throw new HarnessError("PLAN_MODE", "Plan mode is read-only. Switch to Build before preparing or approving a change.");
    if (["stopped", "interrupted"].includes(thread.status)) throw new HarnessError("CANCELLED_RUN", "Resume this thread before starting operations");
    if (host.hasGate(threadId)) throw new HarnessError("REQUEST_GATED", "A pending decision must be resolved before a new operation");
  }

  artifact(threadId: string, id: unknown): ArtifactRecord {
    const artifact = typeof id === "string" ? this.host.store.get<ArtifactRecord>("artifact", id) : null;
    if (!artifact || artifact.threadId !== threadId) throw new HarnessError("NOT_FOUND", "Artifact is not available to this thread");
    return artifact;
  }

  state(threadId: string, id: unknown): UserStateRecord {
    const state = typeof id === "string" ? this.host.store.get<UserStateRecord>("userState", id) : null;
    if (!state || state.threadId !== threadId) throw new HarnessError("NOT_FOUND", "State is not available to this thread");
    return state;
  }

  lease(stateId: string): Lease | null {
    const lease = this.host.store.get<Lease>("lease", stateId);
    return lease && lease.expiresAt > Date.now() ? lease : null;
  }

  async resolveResource(threadId: string, id: string, relativePath?: string, write = false): Promise<string> {
    const grant = this.host.store.get<ResourceGrant>("resource", id);
    if (!grant || grant.threadId !== threadId) throw new HarnessError("CAPABILITY_DENIED", "Resource is not granted to this thread");
    return resolveGrant(grant, relativePath, write, this.host.store.dataDir);
  }

  data(threadId: string, id: string, revision?: number): DataRecord {
    return threadData(this.host.store, threadId, id, revision);
  }

  publishData(threadId: string, value: unknown, provenance: string): DataRecord {
    const { host } = this;
    if (Buffer.byteLength(JSON.stringify(value)) > 8 * 1024 * 1024) throw new HarnessError("INVALID_INPUT", "Dataset exceeds the 8 MiB import limit");
    const record: DataRecord = { id: randomUUID(), threadId, revision: 1, value, provenance, createdAt: now() };
    host.store.internal("data.published", threadId, () => {
      host.store.put("data", record.id, threadId, record);
      host.store.put("dataVersion", record.id + "@1", threadId, record);
      return { id: record.id, revision: 1 };
    });
    return record;
  }

  writeOrigin(thread: Thread, authority?: RunContext): ApprovedWriteOrigin | undefined {
    const { host } = this;
    if (!host.approvedWriteHooks() || !authority || thread.sideParentId || thread.kind === "delegate" || !thread.sessionPath || !thread.modelId || !thread.projectId || !thread.workspaceId) return;
    const binding = host.store.get<{ id: string; threadId: string; projectId: string; path: string }>("workspaceBinding", thread.workspaceId),
      project = host.store.get<{ authority: { kind: string } }>("workspaceProject", thread.projectId);
    if (binding?.id !== thread.workspaceId || binding.threadId !== thread.id || binding.projectId !== thread.projectId || project?.authority.kind !== "local") return;
    return {
      ...authority,
      sessionPath: thread.sessionPath,
      modelId: thread.modelId,
      accountId: thread.accountId ?? null,
      projectId: thread.projectId,
      workspaceId: thread.workspaceId,
      projectRoot: binding.path,
    };
  }

  /** M09 read-role domain context: resources resolve read-only, operation
   * preparation is denied before effects, evidence publishing stays open. */
  agentReadDomain(threadId: string) {
    const { host } = this;
    host.effects.assertAdmissionsEnabled();
    const signal = new AbortController().signal,
      domain = host.context(threadId, signal);
    return {
      threadId,
      signal,
      resolveResource: async (id: string, path?: string, write?: boolean) => {
        if (write) throw new HarnessError("AGENT_TOOL_DENIED", "Read-only resource access");
        return domain.resolveResource(id, path, false);
      },
      ...(domain.withResource
        ? {
            withResource: <T>(id: string, path: string | undefined, write: boolean, action: (filename: string) => Promise<T>) => {
              if (write) throw new HarnessError("AGENT_TOOL_DENIED", "Read-only resource access");
              return domain.withResource!(id, path, false, action);
            },
          }
        : {}),
      publishData: (value: unknown, provenance: string) => domain.publishData(value, provenance),
      prepareOperation: (): never => {
        throw new HarnessError("AGENT_TOOL_DENIED", "Agent children cannot prepare operations");
      },
      progress: (message: string, counts?: Record<string, number>) => domain.progress(message, counts),
    };
  }
}
