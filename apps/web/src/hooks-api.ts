import { z } from 'zod';
import { authenticated, csrfToken, read } from './api.ts';
import { hookSchema, HOOK_EVENTS, type Hook, type HookRunRecord, type HooksView } from '../../../packages/contracts/hooks.ts';

const hookRunRecordSchema = z.object({
  hookId: z.string(), event: z.enum(HOOK_EVENTS), matchKey: z.string().nullable(),
  startedAt: z.string(), durationMs: z.number(),
  outcome: z.enum(['succeeded', 'blocked', 'failed', 'timed_out', 'spawn_failed', 'cancelled']),
  exitCode: z.number().nullable(), reason: z.string().nullable(), systemMessage: z.string().nullable(),
  stdout: z.string(), stderr: z.string(), truncated: z.boolean(), ignoredFields: z.array(z.string()),
});
const hooksViewSchema = z.object({
  revision: z.number().int().nonnegative(), enabled: z.boolean(),
  hooks: z.array(hookSchema.extend({ lastRun: hookRunRecordSchema.nullable() })),
  coverage: z.object({ covered: z.array(z.string()), notCovered: z.array(z.string()) }),
});

export type HookDraft = Omit<Hook, 'id'> & { id?: string };
const json = (body: unknown) => ({ method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'x-harness-csrf': csrfToken }, body: JSON.stringify(body) }) as const;

export async function loadHooks(): Promise<HooksView> {
  return hooksViewSchema.parse(await authenticated(() => fetch('/api/hooks', { credentials: 'same-origin', cache: 'no-store' })).then(read));
}
export async function saveHook(hook: HookDraft, baseRevision: number): Promise<HooksView> {
  await authenticated(() => fetch('/api/hooks', { ...json({ hook, baseRevision }), method: 'PUT' })).then(read);
  return loadHooks();
}
export async function removeHook(id: string, baseRevision: number): Promise<void> {
  await authenticated(() => fetch('/api/hooks', { ...json({ id, baseRevision }), method: 'DELETE' })).then(read);
}
export async function setHooksEnabled(enabled: boolean, baseRevision: number): Promise<void> {
  await authenticated(() => fetch('/api/hooks/enabled', { ...json({ enabled, baseRevision }), method: 'PUT' })).then(read);
}
export async function testHook(hook: HookDraft): Promise<HookRunRecord> {
  const body = hook.id ? { hook } : { hook };
  const response = await authenticated(() => fetch('/api/hooks/test', json(body))).then(read);
  return hookRunRecordSchema.parse(response);
}
