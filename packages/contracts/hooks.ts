import {z} from 'zod';

// User-configured hooks: shell commands run on agent events (issue #1401).
// Event names match Claude Code/Codex so existing scripts can be reused.
export const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop'] as const;
export type HookEvent = typeof HOOK_EVENTS[number];

export const hookSchema = z.strictObject({
  id: z.string().regex(/^hook_[A-Za-z0-9]{8,32}$/),
  name: z.string().max(80).default(''),
  event: z.enum(HOOK_EVENTS),
  matcher: z.string().max(200).default(''),
  command: z.string().min(1).max(4000).refine(value => !value.includes('\0'), 'The command cannot contain NUL bytes.'),
  timeoutSeconds: z.number().int().min(1).max(120).default(30),
  onError: z.enum(['continue', 'block']).default('continue'),
  enabled: z.boolean().default(true),
});
export type Hook = z.infer<typeof hookSchema>;

export const hooksDocumentSchema = z.strictObject({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  enabled: z.boolean(),
  hooks: z.array(hookSchema).max(50),
});
export type HooksDocument = z.infer<typeof hooksDocumentSchema>;

export interface HookRunRecord {
  hookId: string; event: HookEvent; matchKey: string | null; startedAt: string; durationMs: number;
  outcome: 'succeeded' | 'blocked' | 'failed' | 'timed_out' | 'spawn_failed' | 'cancelled';
  exitCode: number | null; reason: string | null; systemMessage: string | null;
  stdout: string; stderr: string; truncated: boolean; ignoredFields: string[];
}

export interface HooksView {
  revision: number; enabled: boolean;
  hooks: (Hook & {lastRun: HookRunRecord | null})[];
  coverage: {covered: string[]; notCovered: string[]};
}
