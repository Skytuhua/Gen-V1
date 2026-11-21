import { z } from 'zod';

/** WSL distribution names are host data: bounded text without control characters
 * or a leading dash, so a stored name can never read as a wsl.exe flag. */
export const wslDistroSchema = z.string().min(1).max(200).regex(
  /^[^-\x00-\x1f\x7f][^\x00-\x1f\x7f]*$/,
  'WSL distribution names cannot start with a dash or contain control characters.',
);
export const terminalShellKindSchema = z.enum(['default', 'cmd', 'pwsh', 'powershell', 'git-bash', 'wsl']);
export type TerminalShellKind = z.infer<typeof terminalShellKindSchema>;
/** One whole selection; a distro is only meaningful on the wsl kind. Availability is
 * checked on launch, so this schema validates syntax only, never host presence. */
export const terminalShellSelectionSchema = z.union([
  z.strictObject({ kind: z.enum(['default', 'cmd', 'pwsh', 'powershell', 'git-bash']) }),
  z.strictObject({ kind: z.literal('wsl'), distro: wslDistroSchema.optional() }),
]);
export type TerminalShellSelection = z.infer<typeof terminalShellSelectionSchema>;
export const shellAvailabilitySchema = z.enum(['available', 'missing', 'unsupported', 'error']);
export type ShellAvailability = z.infer<typeof shellAvailabilitySchema>;
/** Catalog labels/reasons are host-generated text; executable paths and environment
 * contents deliberately never enter this contract. */
export const terminalShellOptionSchema = z.strictObject({
  kind: terminalShellKindSchema,
  label: z.string().min(1).max(120),
  availability: shellAvailabilitySchema,
  reason: z.string().min(1).max(500).optional(),
});
export type TerminalShellOption = z.infer<typeof terminalShellOptionSchema>;
export const terminalShellCatalogSchema = z.strictObject({
  platform: z.enum(['win32', 'linux', 'darwin', 'other']),
  options: z.array(terminalShellOptionSchema).min(1).max(16),
  wsl: z.strictObject({
    distributions: z.array(wslDistroSchema).max(64),
    availability: shellAvailabilitySchema,
    reason: z.string().min(1).max(500).optional(),
  }),
});
export type TerminalShellCatalog = z.infer<typeof terminalShellCatalogSchema>;
/** Effective shell metadata on a session record: captured at spawn, never recomputed
 * from the current preference on read. Old records without it render "Terminal". */
export const terminalShellInfoSchema = z.strictObject({
  kind: terminalShellKindSchema,
  label: z.string().min(1).max(120),
  distro: wslDistroSchema.optional(),
  notice: z.string().min(1).max(500).optional(),
});
export type TerminalShellInfo = z.infer<typeof terminalShellInfoSchema>;
