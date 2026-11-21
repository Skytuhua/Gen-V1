import { z } from 'zod';
import { HarnessError, type DataRecord, type Thread } from '../contracts/index.ts';
import {
  PUBLISH_LIMITS,
  publishDraftV1Schema,
  publishRequestV1Schema,
  type PublishDraftV1,
  type PublishFile,
  type PublishOperationV1,
  type PublishStep,
} from '../contracts/workspace-publish.ts';
import { createdPullRequestResultSchema } from '../contracts/workspace-action-outcomes.ts';
import { registeredCapabilityFlags, type CapabilityFlagKey } from '../core/capability-flags.ts';
import { digest } from '../storage/store.ts';
import { planDataId, PlanRecordSchema } from '../contracts/planning.ts';
import type { ProjectTools } from './tools.ts';
import type { GitHubTools } from './github.ts';
import type { WorkspaceActionOutcomes } from './action-outcomes.ts';

const kind = 'workspacePublish';
const identifier = z.string().regex(/^[a-zA-Z0-9:_.-]{1,200}$/);
const duplicate = () => new HarnessError('DUPLICATE_COMMAND', 'Command ID reused with different content');
const step = (state: PublishStep['state'], extra: Partial<PublishStep> = {}): PublishStep => ({ state, at: new Date().toISOString(), ...extra });
const codePoints = (value: string) => [...value];
const subjectFrom = (title: string) => {
  const clean = title.replace(/[\r\n\t]+/g, ' ').trim();
  const clipped = codePoints(clean).slice(0, PUBLISH_LIMITS.subjectLength).join('').trimEnd();
  return clipped || 'Publish managed workspace changes';
};

/** Durable commit → push → draft-PR pipeline behind workspace.publishV1.
 * Steps are delegated to WorkspaceActionOutcomes; this service only orders
 * them, records per-step state, and never retries an uncertain outcome. */
export class PublishService {
  constructor(
    private readonly projects: ProjectTools,
    private readonly github: GitHubTools,
    private readonly outcomes: WorkspaceActionOutcomes,
    private readonly flagEnabled: () => boolean = PublishService.publishV1Enabled,
  ) {}
  private get store() {
    return this.projects.store;
  }
  /** Snapshot lookup stays correct while #1270's flag registration is pending: unregistered means off. */
  static publishV1Enabled() {
    return registeredCapabilityFlags()['workspace.publishV1' as CapabilityFlagKey] === true;
  }
  private enabled() {
    return this.flagEnabled();
  }
  private requireEnabled() {
    if (!this.enabled()) throw new HarnessError('CAPABILITY_DENIED', 'Workspace publishing is disabled.');
  }

  async draft(projectId: string, threadId: string): Promise<PublishDraftV1> {
    this.requireEnabled();
    identifier.parse(projectId); identifier.parse(threadId);
    const status = await this.projects.gitStatus(projectId, threadId);
    if (status.gitWrite !== true) throw new HarnessError('PROJECT_READ_ONLY', 'Publishing requires a writable managed working copy.');
    const thread = this.thread(projectId, threadId);
    const { base, note } = await this.github.defaultBranch(projectId, threadId);
    const files: PublishFile[] = status.files.map((file) => ({ path: file.path, added: file.added, removed: file.removed, untracked: file.untracked }));
    const subject = subjectFrom(thread.title);
    return publishDraftV1Schema.parse({
      version: 1,
      projectId,
      threadId,
      branch: status.branch,
      head: status.head,
      revision: status.revision,
      base,
      ...(note ? { baseNote: note } : {}),
      files,
      commitMessage: subject,
      title: subject,
      body: this.body(thread, status.branch, files),
    });
  }

  private thread(projectId: string, threadId: string): Thread {
    const thread = this.store.get<Thread>('thread', threadId);
    if (!thread || thread.id !== threadId || thread.projectId !== projectId || thread.kind === 'delegate')
      throw new HarnessError('NOT_FOUND', 'The publish thread is unavailable.');
    return thread;
  }

  private planSteps(threadId: string) {
    const record = this.store.get<DataRecord>('data', planDataId(threadId));
    const parsed = PlanRecordSchema.safeParse(record?.value);
    return parsed.success ? parsed.data.steps : [];
  }

  private body(thread: Thread, branch: string, files: PublishFile[]): string {
    const lines = [
      `Publish the reviewed managed workspace changes on \`${branch}\`.`,
      '',
      '## Changed files',
      ...(files.length
        ? files.map((file) => {
            const counts = file.untracked
              ? 'untracked'
              : file.added === null || file.removed === null
                ? 'binary'
                : `+${file.added}/-${file.removed}`;
            return `- \`${file.path}\` (${counts})`;
          })
        : ['- No working-copy changes; publishes the existing branch head.']),
      '',
      `Created from Gen V1 thread ${thread.title}`,
    ];
    const steps = this.planSteps(thread.id);
    if (steps.length) lines.push('', '## Plan', ...steps.map((item) => `- ${item.status}: ${item.title}`));
    return lines.join('\n');
  }

  async read(projectId: string, threadId: string): Promise<PublishOperationV1 | null> {
    this.requireEnabled();
    identifier.parse(projectId); identifier.parse(threadId);
    const operations = this.store
      .all<PublishOperationV1>('workspacePublish', threadId)
      .filter((item) => item.owner.projectId === projectId && item.owner.threadId === threadId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return operations[0] ?? null;
  }

  private saved(operation: PublishOperationV1): PublishOperationV1 {
    this.store.internal('project.publish.step', operation.owner.threadId, () => {
      this.store.put(kind, operation.id, operation.owner.threadId, operation);
      return operation;
    });
    return operation;
  }

  private setStep(operation: PublishOperationV1, name: keyof PublishOperationV1['steps'], value: PublishStep) {
    operation.steps[name] = value;
    return this.saved(operation);
  }

  private stepFrom(outcome: { state: 'confirmed' | 'not-applied' | 'uncertain' | 'revoked' }, receiptId?: string): PublishStep {
    if (outcome.state === 'confirmed') return step('confirmed', { receiptId });
    if (outcome.state === 'not-applied') return step('not-applied');
    if (outcome.state === 'revoked') return step('uncertain', { error: { code: 'CAPABILITY_DENIED', message: 'The publish owner or access changed while the step ran.' } });
    return step('uncertain', { error: { code: 'ACTION_UNCERTAIN', message: 'The step outcome is uncertain. Inspect before retrying.' } });
  }

  async execute(projectId: string, raw: unknown): Promise<PublishOperationV1> {
    this.requireEnabled();
    identifier.parse(projectId);
    const request = publishRequestV1Schema.parse(raw);
    // A duplicate request ID returns the same durable result; the working copy
    // legitimately moved on after a completed publish.
    const existing = this.store.get<PublishOperationV1>(kind, request.id);
    if (existing) {
      if (existing.owner.projectId !== projectId || existing.owner.threadId !== request.threadId || digest(existing.request) !== digest(request)) throw duplicate();
      return existing;
    }
    this.thread(projectId, request.threadId);
    const status = await this.projects.gitStatus(projectId, request.threadId);
    if (status.gitWrite !== true) throw new HarnessError('PROJECT_READ_ONLY', 'Publishing requires a writable managed working copy.');
    if (status.head !== request.head || status.revision !== request.revision)
      throw new HarnessError('REVISION_CHANGED', 'The reviewed working copy changed. Refresh before publishing.');
    const changed = status.files.map((file) => file.path);
    if (changed.length && (request.selectedPaths.length !== changed.length || !changed.every((path) => request.selectedPaths.includes(path))))
      throw new HarnessError('REVISION_CHANGED', 'The reviewed file selection does not match the working copy.');
    // Persist the operation before the first write step.
    const admitted = this.store.internal('project.publish.started', request.threadId, () => {
      const prior = this.store.get<PublishOperationV1>(kind, request.id);
      if (prior) {
        if (prior.owner.projectId !== projectId || prior.owner.threadId !== request.threadId || digest(prior.request) !== digest(request)) throw duplicate();
        return null;
      }
      const operation: PublishOperationV1 = {
        id: request.id,
        owner: { projectId, threadId: request.threadId },
        createdAt: new Date().toISOString(),
        request,
        steps: { commit: step('not-started'), push: step('not-started'), pr: step('not-started'), link: step('not-started') },
      };
      this.store.put(kind, operation.id, request.threadId, operation);
      return operation;
    });
    const operation = (admitted ?? this.store.get<PublishOperationV1>(kind, request.id)) as PublishOperationV1;
    if (!admitted) return operation;
    return this.run(operation, status);
  }

  private async run(operation: PublishOperationV1, status: Awaited<ReturnType<ProjectTools['gitStatus']>>): Promise<PublishOperationV1> {
    const { projectId, threadId } = operation.owner, request = operation.request;
    try {
      let current = status;
      if (current.files.length) {
        const staged = await this.outcomes.execute(projectId, {
          id: request.id + ':stage',
          type: 'stage',
          payload: { revision: current.revision, expectedHead: current.head, paths: request.selectedPaths },
          threadId,
        });
        if (staged.state !== 'confirmed') {
          this.setStep(operation, 'commit', this.stepFrom(staged));
          return operation;
        }
        current = await this.projects.gitStatus(projectId, threadId);
        if (current.gitWrite !== true) throw new HarnessError('PROJECT_READ_ONLY', 'The working copy is no longer writable.');
        const committed = await this.outcomes.execute(projectId, {
          id: request.id + ':commit',
          type: 'commit',
          payload: { revision: current.revision, expectedHead: current.head, message: request.commitMessage },
          threadId,
        });
        if (committed.state !== 'confirmed') {
          this.setStep(operation, 'commit', this.stepFrom(committed));
          return operation;
        }
        this.setStep(operation, 'commit', step('confirmed', { receiptId: committed.receipt.commandId }));
        current = await this.projects.gitStatus(projectId, threadId);
        if (current.gitWrite !== true) throw new HarnessError('PROJECT_READ_ONLY', 'The working copy is no longer writable.');
      } else this.setStep(operation, 'commit', step('not-applied'));
      const created = await this.outcomes.execute(projectId, {
        id: request.id + ':pr',
        type: 'create-pr',
        payload: { title: request.title, body: request.body, base: request.base, push: true, head: current.head, revision: current.revision },
        threadId,
      });
      if (created.state !== 'confirmed') {
        // Push and PR creation share one fenced outcome; a pre-write refusal
        // leaves the PR step unstarted while ambiguous outcomes mark both.
        const shared = this.stepFrom(created);
        this.setStep(operation, 'push', shared);
        this.setStep(operation, 'pr', created.state === 'not-applied' ? step('not-started') : shared);
        return operation;
      }
      const receipt = createdPullRequestResultSchema.parse(created.receipt.result);
      this.setStep(operation, 'push', step('confirmed', { receiptId: created.receipt.commandId }));
      this.setStep(operation, 'pr', step('confirmed', { receiptId: created.receipt.commandId }));
      const number = Number(/\/pull\/([1-9]\d*)$/.exec(receipt.url)?.[1]);
      operation.result = { url: receipt.url, number, head: receipt.head, repo: receipt.repo };
      this.saved(operation);
      const details = await this.github.details(projectId, threadId, number);
      if (details.repo !== receipt.repo) throw new HarnessError('COMPARISON_IDENTITY_CHANGED', 'The pull request repository did not match.');
      const key = JSON.stringify([projectId, threadId, details.repo, number]);
      this.store.internal('project.publish.link', threadId, () => {
        this.store.put('linkedPullRequest', key, threadId, { projectId, threadId, ...details, linkedAt: new Date().toISOString() });
        return details;
      });
      this.setStep(operation, 'link', step('confirmed'));
      return operation;
    } catch (error) {
      if (error instanceof HarnessError && error.code === 'DUPLICATE_COMMAND') throw error;
      // Never retry after an ambiguous failure; record it for the recovery view.
      const failure = { code: error instanceof HarnessError ? error.code : 'ACTION_UNCERTAIN', message: error instanceof Error ? error.message : 'Publish step failed.' };
      for (const name of ['commit', 'push', 'pr', 'link'] as const)
        if (operation.steps[name].state === 'not-started') this.setStep(operation, name, step('uncertain', { error: failure }));
      return this.saved(operation);
    }
  }
}
