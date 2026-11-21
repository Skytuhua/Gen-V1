import { HarnessError } from '../contracts/index.ts';
import {
	AGENT_FILE_POLICY_DEFAULTS,
	AGENT_FILE_POLICY_LIMITS,
	agentFilePolicySchema,
	parseAgentFilePolicyRules,
	type AgentFilePolicy,
} from '../contracts/agent-file-policy.ts';
import type { Store } from '../storage/store.ts';

const kind = 'agentFilePolicy';
export const agentFilePolicyScopeSchema = (value: unknown): value is string =>
	typeof value === 'string' && (value === 'global' || /^project:[A-Za-z0-9:_.-]{1,200}$/.test(value));

export interface ResolvedAgentFilePolicy extends AgentFilePolicy {
	/** False when no record exists and the value is virtual (global defaults or empty project). */
	explicit: boolean;
}

/** An absent global record resolves to the shipped defaults at revision zero; an absent project record is empty. */
export function readAgentFilePolicy(store: Store, scope: string): ResolvedAgentFilePolicy {
	if (!agentFilePolicyScopeSchema(scope)) throw new HarnessError('INVALID_INPUT', 'Choose a global or project scope.');
	const stored = store.get<AgentFilePolicy>(kind, scope);
	if (!stored) return { revision: 0, rules: scope === 'global' ? [...AGENT_FILE_POLICY_DEFAULTS] : [], explicit: false };
	// A corrupt record must not weaken policy silently: validate, then fall back to the virtual default on failure.
	const parsed = agentFilePolicySchema.safeParse(stored);
	if (!parsed.success) return { revision: 0, rules: scope === 'global' ? [...AGENT_FILE_POLICY_DEFAULTS] : [], explicit: false };
	return { ...parsed.data, explicit: true };
}

/** Effective deny is the union of the global scope with every applicable project scope. */
export function resolvedAgentFilePolicy(store: Store, projectId: string | null): { global: AgentFilePolicy; project: AgentFilePolicy | null; revision: string } {
	const global = readAgentFilePolicy(store, 'global');
	const project = projectId ? readAgentFilePolicy(store, `project:${projectId}`) : null;
	return { global, project, revision: `${global.revision}/${project?.revision ?? 0}` };
}

export function saveAgentFilePolicy(store: Store, scope: string, baseRevision: number, rulesText: string): { scope: string; revision: number } {
	if (!agentFilePolicyScopeSchema(scope)) throw new HarnessError('INVALID_INPUT', 'Choose a global or project scope.');
	if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) throw new HarnessError('INVALID_INPUT', 'Provide the current revision.');
	if (new TextEncoder().encode(rulesText).byteLength > AGENT_FILE_POLICY_LIMITS.rules * (AGENT_FILE_POLICY_LIMITS.ruleBytes + 1) * 2)
		throw new HarnessError('INVALID_INPUT', 'Rule text exceeds the supported size.');
	const { rules, errors } = parseAgentFilePolicyRules(rulesText);
	if (errors.length > 0) throw new HarnessError('INVALID_INPUT', 'Fix the highlighted rules before saving.', errors);
	return store.internal('agentFilePolicy.save', null, (): { scope: string; revision: number } => {
		const current = store.get<AgentFilePolicy>(kind, scope);
		const revision = current?.revision ?? 0;
		if (revision !== baseRevision) throw new HarnessError('AGENT_FILE_POLICY_CHANGED', 'File rules changed. Reload before saving.');
		const next: AgentFilePolicy = { revision: revision + 1, rules };
		store.put(kind, scope, null, next);
		return { scope, revision: next.revision };
	}) as { scope: string; revision: number };
}
