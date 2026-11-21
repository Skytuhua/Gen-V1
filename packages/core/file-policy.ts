import { agentFileRuleSchema } from '../contracts/agent-file-policy.ts';

/** Locale-independent case fold + NFC, applied to rules and candidate paths alike. */
const fold = (value: string) => value.normalize('NFC').toLowerCase();

interface CompiledRule {
	/** Segments for a root-relative path rule; undefined for a basename-only rule. */
	segments?: string[];
	basename?: string;
}

function compileRule(rule: string): CompiledRule | undefined {
	const parsed = agentFileRuleSchema.safeParse(rule.trim().normalize('NFC'));
	if (!parsed.success) return undefined;
	const value = fold(parsed.data);
	if (value.includes('/')) return { segments: value.split('/') };
	return { basename: value };
}

/** `*` = zero or more non-separator chars, `?` = exactly one. Iterative, bounded by the 256-byte rule cap. */
function matchSegment(pattern: string, value: string): boolean {
	let p = 0, v = 0, starP = -1, starV = 0;
	while (v < value.length) {
		if (p < pattern.length && (pattern[p] === '?' || pattern[p] === value[v])) { p++; v++; }
		else if (p < pattern.length && pattern[p] === '*') { starP = p++; starV = v; }
		else if (starP >= 0) { p = starP + 1; v = ++starV; }
		else return false;
	}
	while (p < pattern.length && pattern[p] === '*') p++;
	return p === pattern.length;
}

/** `**` matches zero or more whole segments. */
function matchPath(segments: string[], parts: string[]): boolean {
	if (segments.length === 0) return parts.length === 0;
	const [head, ...rest] = segments;
	if (head === '**') {
		if (matchPath(rest, parts)) return true;
		return parts.length > 0 && matchPath(segments, parts.slice(1));
	}
	return parts.length > 0 && matchSegment(head, parts[0]) && matchPath(rest, parts.slice(1));
}

export interface AgentFilePolicyMatcher {
	readonly size: number;
	/** True when the candidate's basename matches a basename-only rule. */
	deniesBasename(name: string): boolean;
	/** True when a root-relative path matches any rule (also checks basename rules). */
	deniesPath(rootRelativePath: string): boolean;
}

/** Bounded matcher over already-validated rules; invalid entries are skipped so a corrupt store never weakens policy silently — callers validate persisted records on save. */
export function compileFilePolicy(rules: readonly string[]): AgentFilePolicyMatcher {
	const compiled = rules.map(compileRule).filter((rule): rule is CompiledRule => rule !== undefined);
	const basenames = compiled.map(rule => rule.basename).filter((name): name is string => name !== undefined);
	const paths = compiled.map(rule => rule.segments).filter((segments): segments is string[] => segments !== undefined);
	const basename = (name: string) => basenames.some(pattern => matchSegment(pattern, name));
	return {
		size: compiled.length,
		deniesBasename(name: string) { return basename(fold(name)); },
		deniesPath(rootRelativePath: string) {
			const parts = rootRelativePath.split('/').map(fold);
			if (parts.length === 0 || parts.some(part => part === '')) return false;
			return basename(parts[parts.length - 1]) || paths.some(segments => matchPath(segments, parts));
		},
	};
}

/** Union of the global scope with every applicable project scope. */
export function filePolicyDenies(matchers: readonly AgentFilePolicyMatcher[], rootRelativePath: string): boolean {
	return matchers.some(matcher => matcher.deniesPath(rootRelativePath));
}
