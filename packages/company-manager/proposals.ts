import {createHash, randomUUID} from 'node:crypto';
import {CompanyManagerError, CompanyManagerInputSchema, CompanyManagerProposalSchema, COMPANY_MANAGER_MAX_PROPOSAL_BYTES, type CompanyManagerInput, type CompanyManagerDraft, type CompanyManagerProposal} from './contracts.ts';

export function validateManagerProposal(output: string, sourceRefs: readonly string[]): CompanyManagerProposal {
  try {
    if (Buffer.byteLength(output, 'utf8') > COMPANY_MANAGER_MAX_PROPOSAL_BYTES) throw new Error();
    const value = CompanyManagerProposalSchema.parse(JSON.parse(output));
    const tasks = new Map(value.tasks.map(task => [task.id, task]));
    if (tasks.size !== value.tasks.length) throw new Error();
    const permitted = new Set(sourceRefs), complete = new Set<string>(), active = new Set<string>();
    const visit = (id: string) => {
      if (complete.has(id)) return;
      const task = tasks.get(id);
      if (!task || active.has(id)) throw new Error();
      active.add(id);
      if (new Set(task.dependsOn).size !== task.dependsOn.length || new Set(task.sourceRefs).size !== task.sourceRefs.length || task.sourceRefs.some(ref => !permitted.has(ref))) throw new Error();
      for (const dependency of task.dependsOn) visit(dependency);
      active.delete(id); complete.add(id);
    };
    for (const task of value.tasks) visit(task.id);
    return value;
  } catch {throw new CompanyManagerError('COMPANY_MANAGER_INPUT');}
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {for (const item of Object.values(value)) freeze(item); Object.freeze(value);}
  return value;
}

/** UI-local draft only. Durable company identity/revision requires a service receipt. */
export function createManagerDraft(input: CompanyManagerInput, proposal: CompanyManagerProposal, context: {permitId: string; policyRevision: string; sourceRefs: readonly string[]; createdAt: number}): CompanyManagerDraft {
  const request = CompanyManagerInputSchema.parse(input);
  const content = validateManagerProposal(JSON.stringify(proposal), context.sourceRefs);
  const record = {
    id: randomUUID(), kind: 'local_manager_draft' as const, state: 'unsubmitted' as const,
    authority: 'proposal_only' as const, evidenceScope: 'local_manager_output' as const,
    requestId: request.requestId, projectId: request.projectId, dispatchAuthorized: false as const, companyReceipt: null,
    permitId: context.permitId, policyRevision: context.policyRevision,
    sourceRefs: [...context.sourceRefs], createdAt: context.createdAt, content,
  };
  return freeze({...record, digest: createHash('sha256').update(JSON.stringify(record)).digest('hex')});
}
