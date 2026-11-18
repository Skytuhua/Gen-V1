import type { FastifyInstance } from 'fastify';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Service } from '../../packages/core/service.ts';
import { HarnessError } from '../../packages/contracts/index.ts';
import { workspaceHost } from './workspace-host.ts';
import {
  CodeIntelligence, StdioLspAdapter, requireCodeIntelligenceFlag,
  type LanguageServerAdapter, type LanguageServerDescriptor,
} from '../../packages/core/code-intelligence.ts';
import { EditPreviewRegistry } from '../../packages/core/edit-preview.ts';
import { DebugRegistry, type DebugAdapter } from '../../packages/core/debug-session.ts';
import { assertProvenBackend, type ExecutionBackend } from '../../packages/core/execution-policy.ts';
import { hostFlagEnabled, type RegisteredHostFlag } from '../../packages/core/host-flags.ts';
import { ProjectVerificationService } from '../../packages/core/project-verification.ts';
import type { CheckObservationV1 } from '../../packages/contracts/verification.ts';
import { approvalSchema, type ApprovalV1, type ToolOwner } from '../../packages/contracts/tool-effects.ts';
import type { Operation, Thread } from '../../packages/contracts/index.ts';
import { actionCommitment } from '../../packages/core/tool-effects.ts';
import { renamePlanV1Schema } from '../../packages/contracts/code-intelligence.ts';
import { digest } from '../../packages/storage/store.ts';
import { randomUUID } from 'node:crypto';

const identifier = z.string().regex(/^[a-zA-Z0-9:_.-]{1,200}$/);
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const signal = () => new AbortController().signal;

/** Approved language servers: installed executables only, never downloaded,
 * launched under the project execution profile. An absent server is
 * UNSUPPORTED — never a reason for a regex or unrestricted-shell fallback. */
const APPROVED_SERVERS: Record<string, { executable: string; argv: string[] }> = {
  typescript: { executable: 'typescript-language-server', argv: ['--stdio'] },
  javascript: { executable: 'typescript-language-server', argv: ['--stdio'] },
  python: { executable: 'pyright-langserver', argv: ['--stdio'] },
};

function installedExecutable(name: string): string | null {
  try {
    const command = process.platform === 'win32' ? 'where' : 'command';
    const args = process.platform === 'win32' ? [name] : ['-v', name];
    const out = execFileSync(command, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const first = out.split(/\r?\n/).find(line => line.trim());
    return first?.trim() || null;
  } catch { return null; }
}

export function languageServerDescriptor(language: string): LanguageServerDescriptor {
  const approved = APPROVED_SERVERS[language];
  if (!approved) throw new HarnessError('UNSUPPORTED', `No approved language server exists for "${language}".`);
  const executable = installedExecutable(approved.executable);
  if (!executable) throw new HarnessError('UNSUPPORTED', `The approved ${language} language server is not installed on this host.`);
  let configDigest: string;
  try { configDigest = sha(readFileSync(executable)); }
  catch { throw new HarnessError('UNSUPPORTED', `The approved ${language} language server binary is unreadable on this host.`); }
  return { language, executable, argv: approved.argv, configDigest };
}

export interface CodeIntelligenceHostOptions {
  /** Test seam: supply a factory to replace the real stdio adapter. */
  adapterFactory?: (descriptor: LanguageServerDescriptor, root: string) => LanguageServerAdapter;
  /** Proven execution backends for the debug registry. */
  backends?: readonly ExecutionBackend[];
  approvedBackendId?: string;
  debugAdapterFor?: (backend: ExecutionBackend, recipe: { recipeId: string; executableDigest: string; confinementProfile: string }) => DebugAdapter;
  env?: Readonly<Record<string, string | undefined>>;
}

/** M07 surface: revision-aware diagnostics, bounded navigation, streamed edit
 * previews, guarded rename and restricted debug controls. Every endpoint sits
 * beneath the existing authenticated hooks and fails closed when its host flag
 * is off. */
export function registerCodeIntelligenceRoutes(app: FastifyInstance, service: Service, options: CodeIntelligenceHostOptions = {}) {
  const projects = workspaceHost(service).projects;
  const env = options.env ?? process.env;
  const gate = (flag: Extract<RegisteredHostFlag, `coding.${string}`>) => requireCodeIntelligenceFlag(flag, env);
  // A real language server only launches under the project execution profile:
  // an installed, approved backend with a PASS platform proof recorded for this
  // host platform. An injected adapterFactory is a test seam and bypasses this gate.
  const requireProvenBackend = () => assertProvenBackend(options.backends ?? [], options.approvedBackendId);
  const intelligence = new CodeIntelligence(
    options.adapterFactory ?? ((descriptor, root) => { requireProvenBackend(); return new StdioLspAdapter(descriptor, root); }));
  const previews = new EditPreviewRegistry();
  const debug = options.debugAdapterFor
    ? new DebugRegistry(options.backends ?? [], options.approvedBackendId ?? '', options.debugAdapterFor)
    : null;
  const journalRoot = service.store.dataDir;
  const profileDigest = sha('workspace-execute-no-network');
  const verification = new ProjectVerificationService(service.store, env);

  /** M06 evidence feed: completed diagnostics observations and debug commands
   * are recorded as review-advisory checks. The feed is advisory-only — it
   * never satisfies a declared requirement — and stays silent while the M06
   * workflow flag is off. */
  const feed = (owner: ToolOwner, advisory: Omit<CheckObservationV1, 'checkId' | 'observationKind' | 'owner'>) => {
    if (!hostFlagEnabled('verification.workflowV1', env)) return;
    verification.recordAdvisory(owner, advisory);
  };
  const advisoryOwner = (projectId: string, threadId: string | undefined, bound: { workspaceIdentity: string }): ToolOwner => ({
    threadId: threadId ?? projectId, runId: null, epoch: 0, projectId,
    workspaceId: bound.workspaceIdentity, accountBinding: null,
  });
  const advisoryRecipeDigest = (tool: string, language?: string) => sha(JSON.stringify({ kind: 'code-intelligence-advisory', tool, language }));
  const advisoryEnvironment = () => `${process.platform}/${process.version}`;

  /** Consume a stored M02 approval — single-use, owner-bound, expiry-checked,
   * verified inside a store transaction. The approval must be the one the
   * user issued through `operation.approve` for a prepared operation whose
   * kind and args bind this exact plan or recipe; a plan, recipe or approval
   * id the caller merely supplies cannot satisfy this. */
  const consumeApproval = (owner: ToolOwner, approvalId: string, kind: string, args: Record<string, unknown>) => {
    service.store.internal('code-intelligence.approval.consumed', owner.threadId, () => {
      let approval: ApprovalV1;
      try { approval = approvalSchema.parse(service.store.get('approval', approvalId)); }
      catch { throw new HarnessError('APPROVAL_REQUIRED', 'The approval is unavailable or malformed.'); }
      if (approval.owner.threadId !== owner.threadId)
        throw new HarnessError('APPROVAL_REQUIRED', 'The approval belongs to another owner.');
      if (approval.remainingUses < 1 || approval.expiresAt <= new Date().toISOString())
        throw new HarnessError('APPROVAL_REQUIRED', 'The approval expired or was already consumed.');
      const operation = service.store.get<Operation>('operation', approval.operationId);
      const thread = service.store.get<Thread>('thread', owner.threadId);
      if (!operation || !thread || operation.threadId !== owner.threadId || !operation.approved)
        throw new HarnessError('APPROVAL_REQUIRED', 'Approve the prepared operation first.');
      if (approval.actionCommitment !== actionCommitment(operation, thread))
        throw new HarnessError('APPROVAL_REQUIRED', 'The approved action changed; approve the current intent again.');
      if (operation.kind !== kind || digest(operation.args) !== digest(args))
        throw new HarnessError('APPROVAL_REQUIRED', 'The approved operation does not bind this input; approve the current one.');
      service.store.put('approval', approvalId, approval.owner.threadId, { ...approval, remainingUses: 0 });
    });
  };

  const binding = async (projectId: string, threadId?: string) => {
    const bound = await projects.binding(projectId, threadId);
    const identity = bound.workspace?.identity;
    const workspaceIdentity = identity ? sha(`${identity.dev}:${identity.ino}`) : sha(`${bound.project.id}:${bound.path}`);
    return { root: bound.path, workspaceIdentity };
  };

  const observeSchema = z.strictObject({
    threadId: identifier.optional(), language: z.string().min(1).max(64), path: z.string().min(1).max(4096),
    text: z.string().max(4 * 1024 * 1024), beforeDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
    editInvocationId: z.string().max(256).nullable().optional(), wait: z.enum(['inline', 'delayed']).optional(),
  });
  const navigateSchema = z.strictObject({
    threadId: identifier.optional(), language: z.string().min(1).max(64), path: z.string().min(1).max(4096),
    text: z.string().max(4 * 1024 * 1024), kind: z.enum(['definition', 'references', 'implementation', 'hover']),
    position: z.strictObject({ line: z.number().int().nonnegative(), character: z.number().int().nonnegative() }),
  });
  const previewSchema = z.strictObject({
    threadId: identifier.optional(), previewId: z.string().max(128).optional(),
    schemaDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(), chunk: z.string().max(1024 * 1024).optional(),
    finalArgumentsDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(), outcome: z.enum(['APPLIED', 'CONFLICT']).optional(),
    command: z.enum(['begin', 'append', 'seal', 'validate', 'settle', 'discard']),
  });
  const renameSchema = z.strictObject({
    threadId: identifier.optional(), language: z.string().min(1).max(64), path: z.string().min(1).max(4096),
    text: z.string().max(4 * 1024 * 1024), position: z.strictObject({ line: z.number().int().nonnegative(), character: z.number().int().nonnegative() }),
    newName: z.string().min(1).max(512), approvalId: z.string().min(1).max(256), plan: z.unknown().optional(), planId: z.string().max(128).optional(),
    command: z.enum(['plan', 'apply', 'recover']),
  });
  const debugSchema = z.strictObject({
    threadId: identifier.optional(), sessionId: z.string().max(128).optional(), approvalId: z.string().min(1).max(256).optional(),
    recipe: z.strictObject({ recipeId: z.string().min(1).max(256), executableDigest: z.string().regex(/^[a-f0-9]{64}$/), confinementProfile: z.string().min(1).max(256) }).optional(),
    command: z.string().min(1).max(64), args: z.record(z.string(), z.unknown()).optional(),
  });

  app.register(async scope => {
    scope.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

    scope.post('/api/projects/:projectId/intelligence/diagnostics', { bodyLimit: 8 * 1024 * 1024 }, async request => {
      gate('coding.intelligenceV1');
      const { projectId } = z.strictObject({ projectId: identifier }).parse(request.params);
      const input = observeSchema.parse(request.body);
      const bound = await binding(projectId, input.threadId);
      const descriptor = languageServerDescriptor(input.language);
      const startedAt = new Date().toISOString();
      const result = await intelligence.observe({
        workspaceIdentity: bound.workspaceIdentity, root: bound.root, language: input.language,
        descriptor, profileDigest,
        path: input.path, beforeDigest: input.beforeDigest ?? null, afterDigest: sha(input.text), text: input.text,
        editInvocationId: input.editInvocationId ?? null, wait: input.wait ?? 'delayed', signal: signal(),
      });
      const errors = result.diagnostics.filter(d => d.severity === 'error').length;
      feed(advisoryOwner(projectId, input.threadId, bound), {
        version: 1, executionId: `intel-${randomUUID()}`, codeDigest: result.afterDigest,
        dependencyDigest: descriptor.configDigest, recipeDigest: advisoryRecipeDigest('diagnostics', input.language),
        environmentId: advisoryEnvironment(), argv: [descriptor.executable, ...descriptor.argv], cwdIdentity: bound.root,
        phase: 'BUILD', startedAt, endedAt: new Date().toISOString(), exitCode: null,
        outcome: errors > 0 ? 'FAIL' : result.baselineStatus === 'UNAVAILABLE' ? 'UNKNOWN' : 'PASS',
        artifactRefs: [],
        detail: `diagnostics=${result.diagnostics.length} errors=${errors} state=${result.state} baseline=${result.baselineStatus}`.slice(0, 2000),
      });
      return result;
    });

    scope.post('/api/projects/:projectId/intelligence/navigate', { bodyLimit: 8 * 1024 * 1024 }, async request => {
      gate('coding.intelligenceV1');
      const { projectId } = z.strictObject({ projectId: identifier }).parse(request.params);
      const input = navigateSchema.parse(request.body);
      const bound = await binding(projectId, input.threadId);
      return intelligence.navigate({
        root: bound.root, path: input.path, language: input.language, descriptor: languageServerDescriptor(input.language),
        profileDigest, kind: input.kind, position: input.position, grantedRoots: [bound.root],
        signal: signal(), text: input.text, afterDigest: sha(input.text),
      });
    });

    scope.post('/api/projects/:projectId/previews', { bodyLimit: 2 * 1024 * 1024 }, async request => {
      gate('coding.intelligenceV1');
      const { projectId } = z.strictObject({ projectId: identifier }).parse(request.params);
      const input = previewSchema.parse(request.body);
      const owner = sha(projectId);
      switch (input.command) {
        case 'begin': {
          if (!input.schemaDigest) throw new HarnessError('INVALID_INPUT', 'A preview requires the tool schema digest.');
          return previews.begin(owner, input.schemaDigest);
        }
        case 'append': {
          if (!input.previewId || input.chunk === undefined) throw new HarnessError('INVALID_INPUT', 'Append requires a previewId and a chunk.');
          return previews.append(input.previewId, owner, input.chunk);
        }
        case 'seal': {
          if (!input.previewId) throw new HarnessError('INVALID_INPUT', 'Seal requires a previewId.');
          return previews.seal(input.previewId, owner, () => null);
        }
        case 'validate': {
          if (!input.previewId || !input.finalArgumentsDigest) throw new HarnessError('INVALID_INPUT', 'Validate requires a previewId and the final arguments digest.');
          return previews.validateFinal(input.previewId, owner, input.finalArgumentsDigest);
        }
        case 'settle': {
          if (!input.previewId || !input.outcome) throw new HarnessError('INVALID_INPUT', 'Settle requires a previewId and an outcome.');
          return previews.settle(input.previewId, owner, input.outcome);
        }
        case 'discard': {
          if (!input.previewId) throw new HarnessError('INVALID_INPUT', 'Discard requires a previewId.');
          previews.discard(input.previewId, owner);
          return { discarded: true };
        }
      }
    });

    scope.post('/api/projects/:projectId/intelligence/rename', { bodyLimit: 8 * 1024 * 1024 }, async request => {
      gate('coding.renameV1');
      const { projectId } = z.strictObject({ projectId: identifier }).parse(request.params);
      const input = renameSchema.parse(request.body);
      const bound = await binding(projectId, input.threadId);
      switch (input.command) {
        case 'plan':
          return intelligence.planRename({
            root: bound.root, descriptor: languageServerDescriptor(input.language), profileDigest,
            path: input.path, language: input.language, position: input.position, newName: input.newName,
            grantedRoots: [bound.root], workspaceIdentity: bound.workspaceIdentity, approvalId: input.approvalId,
            signal: signal(), text: input.text, afterDigest: sha(input.text),
          });
        case 'apply': {
          if (!input.plan) throw new HarnessError('INVALID_INPUT', 'Apply requires the reviewed plan.');
          const plan = renamePlanV1Schema.parse(input.plan);
          if (plan.exactApprovalId !== input.approvalId)
            throw new HarnessError('APPROVAL_REQUIRED', 'The supplied approval does not match the approved plan.');
          consumeApproval(advisoryOwner(projectId, input.threadId, bound), input.approvalId,
            'code-intelligence.rename.apply', { planDigest: digest(plan), workspaceIdentity: bound.workspaceIdentity });
          return intelligence.applyRename({ plan, approvalId: input.approvalId, journalRoot, grantedRoots: [bound.root], signal: signal() });
        }
        case 'recover': {
          if (!input.planId) throw new HarnessError('INVALID_INPUT', 'Recover requires a planId.');
          return intelligence.recoverRename({ journalRoot, planId: input.planId, grantedRoots: [bound.root], signal: signal() });
        }
      }
    });

    scope.post('/api/projects/:projectId/debug', { bodyLimit: 256 * 1024 }, async request => {
      gate('coding.debuggerV1');
      const { projectId } = z.strictObject({ projectId: identifier }).parse(request.params);
      const input = debugSchema.parse(request.body);
      const owner = sha(projectId);
      if (!debug) throw new HarnessError('UNSUPPORTED', 'No proven debugger backend is installed on this host.');
      const feedDebug = (command: string, outcome: 'PASS' | 'FAIL' | 'UNKNOWN', detail: string) =>
        feed({ threadId: input.threadId ?? projectId, runId: null, epoch: 0, projectId, workspaceId: null, accountBinding: null }, {
          version: 1, executionId: `debug-${randomUUID()}`, codeDigest: sha(command), dependencyDigest: sha('debug-adapter'),
          recipeDigest: input.recipe ? sha(JSON.stringify(input.recipe)) : advisoryRecipeDigest('debug'),
          environmentId: advisoryEnvironment(), argv: ['debug', command], cwdIdentity: projectId,
          phase: 'TEST', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), exitCode: null,
          outcome, artifactRefs: [], detail: detail.slice(0, 2000),
        });
      if (input.command === 'launch') {
        if (!input.recipe || !input.approvalId) throw new HarnessError('INVALID_INPUT', 'Launch requires the approved recipe and its approval.');
        const bound = await binding(projectId, input.threadId);
        consumeApproval(advisoryOwner(projectId, input.threadId, bound), input.approvalId,
          'code-intelligence.debug.launch', { recipeDigest: digest(input.recipe), workspaceIdentity: bound.workspaceIdentity });
        const launched = await debug.launch({ owner, recipe: input.recipe, signal: signal() });
        feedDebug('launch', launched.state === 'UNKNOWN' ? 'UNKNOWN' : 'PASS', `debug launch recipe=${input.recipe.recipeId} state=${launched.state}`);
        return launched;
      }
      if (!input.sessionId) throw new HarnessError('INVALID_INPUT', 'The command requires a sessionId.');
      if ((['threads', 'stackTrace', 'scopes', 'variables'] as const).includes(input.command as never)) {
        const inspected = await debug.inspect(input.sessionId, owner, input.command as 'threads', input.args ?? {}, signal());
        feedDebug(input.command, 'PASS', `debug inspect ${input.command}`);
        return inspected;
      }
      if (input.command === 'terminate') { await debug.terminate(input.sessionId, owner, signal()); feedDebug('terminate', 'PASS', 'debug session terminated'); return { terminated: true }; }
      const effected = await debug.effect(input.sessionId, owner, input.command as 'continue', input.args ?? {}, signal());
      feedDebug(input.command, 'PASS', `debug effect ${input.command}`);
      return effected;
    });
  });

  app.addHook('onClose', async () => { await intelligence.dispose(); await debug?.dispose(signal()); });
}
