import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { HarnessError, type HostCommand } from '../contracts/index.ts';
import {
  workspaceActionEnvelopeSchema,
  workspaceActionOperationSchema,
  workspaceActionOwnerSchema,
  workspaceActionPayloadSchemas,
  type WorkspaceActionEnvelope,
  type WorkspaceActionExecution,
  type WorkspaceActionOutcome,
} from '../contracts/workspace-action-outcomes.ts';
import { digest } from '../storage/store.ts';
import { withPathGuard } from '../core/file-access.ts';
import { privateFamilyForBinding, withPrivateGitFamily } from './git-storage.ts';
import type { ProjectTools } from './tools.ts';
import type { GitHubTools } from './github.ts';

interface Intent {
  version: 1;
  command: HostCommand;
  ownerFence: string;
  status: 'prepared' | 'started' | 'confirmed' | 'not-applied';
  result?: unknown;
}
interface Fence {
  hash: string;
  repo?: string;
  credential?: { path: string; dev: string; ino: string };
}
const kind = 'workspaceActionOutcome';
const duplicate = () => new HarnessError('DUPLICATE_COMMAND', 'Command ID reused with different content');
const denied = () => new HarnessError('CAPABILITY_DENIED', 'The original action owner or access changed.');

/** Host only. Private intent/results never flow through Store transaction return values. */
export class WorkspaceActionOutcomes {
  constructor(
    private readonly projects: ProjectTools,
    private readonly github: GitHubTools,
  ) {}
  private get store() {
    return this.projects.store;
  }
  private command(projectId: string, input: WorkspaceActionEnvelope): HostCommand {
    return { ...input, type: 'project.' + input.type, payload: { ...input.payload, projectId } };
  }
  private read(command: HostCommand): Intent | null {
    const intent = this.store.get<Intent>(kind, command.id);
    if (intent && digest(intent.command) !== digest(command)) throw duplicate();
    const legacy = this.store.get<{ command?: HostCommand }>('workspaceAction', command.id);
    if (legacy?.command && digest(legacy.command) !== digest(command)) throw duplicate();
    this.store.receipt(command); // Also reject collisions with commands outside this helper.
    return intent;
  }
  private async fence(projectId: string, input: WorkspaceActionEnvelope): Promise<Fence> {
    const binding = await this.projects.binding(projectId, input.threadId),
      workspace = binding.workspace;
    if (!workspace) throw denied();
    const family = privateFamilyForBinding(this.store, workspace);
    if (!family) throw denied();
    await withPrivateGitFamily(family, new AbortController().signal, async () => {});
    let repo: string | undefined, credential: Fence['credential'], account: string | undefined;
    if (input.type === 'review-pr') {
      repo = (await this.github.repo(projectId, input.threadId)).repo;
      const path = join(this.store.dataDir, 'github', 'credentials.json'),
        info = await lstat(path, { bigint: true });
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n) throw denied();
      credential = { path, dev: String(info.dev), ino: String(info.ino) };
      account = await withPathGuard([{ ...credential, leaf: true, readOnly: true }], new AbortController().signal, async () =>
        digest(await this.github.auth.token()),
      );
    }
    return {
      hash: digest({
        profile: this.store.dataDir,
        projectId,
        threadId: input.threadId ?? null,
        authority: binding.project.authority,
        path: binding.path,
        workspace,
        root: this.store.get('workspaceProjectRoot', projectId),
        family: family.privateFamily,
        repo: repo ?? null,
        account: account ?? null,
        credential: credential ?? null,
      }),
      repo,
      credential,
    };
  }
  private result(command: HostCommand, intent: Intent, fence: Fence): WorkspaceActionExecution {
    if (intent.version !== 1 || intent.ownerFence !== fence.hash) return { state: 'revoked' };
    if (intent.status === 'not-applied') return { state: 'not-applied' };
    if (intent.status === 'confirmed') {
      const receipt = this.store.receipt(command),
        summary = receipt?.result;
      // Only our bounded summary is replayable; never return a legacy/private tool result.
      if (receipt && digest(summary) === digest(this.summary(command, 'confirmed'))) return { state: 'confirmed', receipt };
    }
    return { state: 'uncertain' };
  }
  private summary(command: HostCommand, state: 'confirmed' | 'not-applied' | 'uncertain') {
    return { operationId: command.id, operation: command.type.slice('project.'.length), state };
  }
  async execute(projectId: string, raw: unknown): Promise<WorkspaceActionExecution> {
    workspaceActionOwnerSchema.shape.projectId.parse(projectId);
    const input = workspaceActionEnvelopeSchema.parse(raw);
    workspaceActionPayloadSchemas[input.type].parse(input.payload);
    const command = this.command(projectId, input);
    this.read(command);
    let fence: Fence;
    try {
      fence = await this.fence(projectId, input);
    } catch {
      return { state: 'revoked' };
    }
    const existing = this.read(command);
    if (existing) return this.result(command, existing, fence);
    if (this.store.get('workspaceAction', input.id) || this.store.receipt(command)) return { state: 'uncertain' };
    let reserved = false;
    this.store.internal('project.action.prepared', input.threadId ?? null, () => {
      if (!this.read(command) && !this.store.get('workspaceAction', input.id) && !this.store.receipt(command)) {
        this.store.put(kind, input.id, input.threadId ?? null, {
          version: 1,
          command,
          ownerFence: fence.hash,
          status: 'prepared',
        } satisfies Intent);
        reserved = true;
      }
      return this.summary(command, 'uncertain');
    });
    if (!reserved) {
      const current = this.read(command);
      return current ? this.result(command, current, fence) : { state: 'uncertain' };
    }
    let started = false;
    try {
      const write = async () => {
        if ((await this.fence(projectId, input)).hash !== fence.hash) throw denied();
        this.store.internal('project.action.started', input.threadId ?? null, () => {
          const current = this.read(command);
          if (!current || current.status !== 'prepared' || current.ownerFence !== fence.hash) throw denied();
          this.store.put(kind, input.id, input.threadId ?? null, { ...current, status: 'started' });
          return this.summary(command, 'uncertain');
        });
        started = true;
        if (input.type === 'review-pr') return this.github.review(projectId, input.threadId, input.payload);
        const current = await this.projects.gitStatus(projectId, input.threadId);
        if (input.payload.expectedHead !== current.head) throw new HarnessError('REVISION_CHANGED', 'The reviewed commit changed.');
        const payload = workspaceActionPayloadSchemas[input.type].parse(input.payload);
        return this.projects.gitAction(projectId, input.threadId, { type: input.type, ...payload });
      };
      // Pin the actual profile credential for the entire remote call, including every tool await.
      const result = fence.credential
        ? await withPathGuard([{ ...fence.credential, leaf: true, readOnly: true }], new AbortController().signal, write)
        : await write();
      const receipt = this.store.command(command, () => {
        const current = this.read(command);
        if (!current || current.status !== 'started' || current.ownerFence !== fence.hash) throw denied();
        this.store.put(kind, input.id, input.threadId ?? null, { ...current, status: 'confirmed', result });
        return this.summary(command, 'confirmed');
      });
      return { state: 'confirmed', receipt };
    } catch {
      if (started) return { state: 'uncertain' };
      // This invocation owns the reservation and has never entered a write tool.
      try {
        this.store.internal('project.action.not-applied', input.threadId ?? null, () => {
          const current = this.read(command);
          if (!current || current.status !== 'prepared' || current.ownerFence !== fence.hash) throw denied();
          this.store.put(kind, input.id, input.threadId ?? null, { ...current, status: 'not-applied' });
          return this.summary(command, 'not-applied');
        });
        return { state: 'not-applied' };
      } catch {
        return { state: 'uncertain' };
      }
    }
  }
  /** Read only: no commands, retries, current diff inspection, or remote review searches. */
  async inspect(raw: unknown): Promise<WorkspaceActionOutcome> {
    const operation = workspaceActionOperationSchema.parse(raw),
      owner = operation.selection.owner;
    const input: WorkspaceActionEnvelope = {
      id: operation.operationId,
      type: operation.operation,
      payload: operation.payload,
      ...(owner.threadId === undefined ? {} : { threadId: owner.threadId }),
    };
    const command = this.command(owner.projectId, input);
    this.read(command);
    const payload = workspaceActionPayloadSchemas[input.type].safeParse(input.payload);
    if (!payload.success) return { state: 'uncertain' };
    const p = input.payload,
      comparison = operation.comparison,
      target = operation.selection.target,
      action = operation.action;
    if (
      p.revision !== action.revision ||
      (input.type === 'review-pr' ? p.head : p.expectedHead) !== action.head ||
      comparison.headOid !== action.head
    )
      return { state: 'uncertain' };
    if (input.type === 'review-pr') {
      if (
        comparison.kind !== 'pull-request' ||
        target.kind !== 'pull-request' ||
        comparison.repo !== target.repo ||
        comparison.number !== target.number ||
        p.number !== target.number
      )
        return { state: 'uncertain' };
    } else if (
      comparison.kind !== 'local' ||
      target.kind !== 'local' ||
      comparison.scope !== target.scope ||
      comparison.branch !== action.branch
    )
      return { state: 'uncertain' };
    let fence: Fence;
    try {
      fence = await this.fence(owner.projectId, input);
    } catch {
      return { state: 'revoked' };
    }
    if (target.kind === 'pull-request' && target.repo !== fence.repo) return { state: 'revoked' };
    const current = this.read(command);
    if (!current) return { state: 'uncertain' };
    return { state: this.result(command, current, fence).state };
  }
}
