import { z } from 'zod';

export const AGENT_FILE_POLICY_LIMITS = { rules: 100, ruleBytes: 256 } as const;
/** Shipped defaults apply until the operator explicitly saves a different global list. `.env.example` is intentionally blocked by `.env.*`. */
export const AGENT_FILE_POLICY_DEFAULTS = ['.env', '.env.*', '**/secrets/**', '*.pem', '*.key', 'id_rsa', 'id_ed25519'] as const;
/** Distinct safe denial for direct operations; never carries the path, rule or counts. */
export const FILE_POLICY_DENIED = 'FILE_POLICY_DENIED';
export const FILE_POLICY_DENIED_MESSAGE = 'This file is blocked by your agent file rules.';

const metachars = /[{}[\]!#]/;
const control = /[-]/;
const segment = z.string()
  .refine(value => value.length > 0, 'Empty rule segment.')
  .refine(value => value !== '.' && value !== '..', 'Relative tokens are not allowed in rules.')
  .refine(value => !control.test(value), 'Control characters are not allowed in rules.')
  .refine(value => !metachars.test(value), 'Only *, ? and whole-segment ** wildcards are allowed.');

export const agentFileRuleSchema = z.string()
  .refine(value => new TextEncoder().encode(value).byteLength <= AGENT_FILE_POLICY_LIMITS.ruleBytes, `Rules are at most ${AGENT_FILE_POLICY_LIMITS.ruleBytes} bytes.`)
  .refine(value => value.trim() === value && value.length > 0, 'Rules must not be blank.')
  .refine(value => !/[\\:]/.test(value), 'Rules are relative; backslashes and drive/UNC syntax are not allowed.')
  .refine(value => !value.startsWith('/'), 'Rules are relative to the project root.')
  .refine(value => {
    const segments = value.split('/');
    return segments.every(part => part === '**' || segment.safeParse(part).success);
  }, 'Use plain names, *, ? wildcards in a segment, or ** as a whole segment.');

/** One normalized rule: trimmed, NFC. Slash-containing rules match full root-relative paths; others match any basename. */
export const agentFilePolicySchema = z.strictObject({
  revision: z.number().int().min(0),
  rules: z.array(agentFileRuleSchema).max(AGENT_FILE_POLICY_LIMITS.rules),
});

export const agentFilePolicySaveSchema = z.strictObject({
  expectedRevision: z.number().int().min(0),
  rulesText: z.string().refine(value => new TextEncoder().encode(value).byteLength <= AGENT_FILE_POLICY_LIMITS.rules * (AGENT_FILE_POLICY_LIMITS.ruleBytes + 1), 'Rule text exceeds the supported size.'),
});

export interface AgentFileRuleError { line: number; message: string }
/** Parse editor text (one rule per line). Blank lines are ignored; duplicates keep the first occurrence. Errors carry line numbers only, never echo rule text. */
export function parseAgentFilePolicyRules(text: string): { rules: string[]; errors: AgentFileRuleError[] } {
  const rules: string[] = [], errors: AgentFileRuleError[] = [], seen = new Set<string>();
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const rule = raw.trim().normalize('NFC');
    if (rule === '') continue;
    const parsed = agentFileRuleSchema.safeParse(rule);
    if (!parsed.success) errors.push({ line: index + 1, message: parsed.error.issues[0]?.message ?? 'Invalid rule.' });
    else if (!seen.has(rule)) { seen.add(rule); rules.push(rule); }
    if (rules.length > AGENT_FILE_POLICY_LIMITS.rules) errors.push({ line: index + 1, message: `At most ${AGENT_FILE_POLICY_LIMITS.rules} rules.` });
  }
  return { rules: rules.slice(0, AGENT_FILE_POLICY_LIMITS.rules), errors };
}

export type AgentFilePolicy = z.infer<typeof agentFilePolicySchema>;
export type AgentFilePolicySave = z.infer<typeof agentFilePolicySaveSchema>;
