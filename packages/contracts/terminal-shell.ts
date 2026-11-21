import { z } from 'zod';

/** Interactive project-terminal shell choice. `distro` is only valid on `wsl`. */
const distroName = z.string().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/, 'Distribution names cannot contain control characters.').refine(value => !value.startsWith('-'), 'Distribution names cannot start with a dash.');
export const terminalShellKindSchema = z.enum(['default', 'cmd', 'pwsh', 'powershell', 'git-bash', 'wsl']);
export const terminalShellSelectionSchema = z.union([
  z.strictObject({ kind: z.enum(['default', 'cmd', 'pwsh', 'powershell', 'git-bash']) }),
  z.strictObject({ kind: z.literal('wsl'), distro: distroName.optional() }),
]);
export type TerminalShellSelection = z.infer<typeof terminalShellSelectionSchema>;
export type TerminalShellKind = z.infer<typeof terminalShellKindSchema>;

export const shellAvailabilitySchema = z.enum(['available', 'missing', 'unsupported', 'error']);
export type ShellAvailability = z.infer<typeof shellAvailabilitySchema>;

export const terminalShellOptionSchema = z.strictObject({
  kind: terminalShellKindSchema,
  label: z.string().min(1).max(200),
  availability: shellAvailabilitySchema,
  reason: z.string().min(1).max(500).optional(),
});
export type TerminalShellOption = z.infer<typeof terminalShellOptionSchema>;

export const terminalShellCatalogSchema = z.strictObject({
  platform: z.enum(['win32', 'linux', 'darwin', 'other']),
  options: z.array(terminalShellOptionSchema).max(64),
  wsl: z.strictObject({
    availability: shellAvailabilitySchema,
    distributions: z.array(distroName).max(64),
    reason: z.string().min(1).max(500).optional(),
  }),
});
export type TerminalShellCatalog = z.infer<typeof terminalShellCatalogSchema>;

/** Effective shell metadata returned with a terminal read/open result. */
export const terminalShellInfoSchema = z.strictObject({
  kind: terminalShellKindSchema,
  label: z.string().min(1).max(200),
  distro: distroName.optional(),
  notice: z.string().min(1).max(500).optional(),
});
export type TerminalShellInfo = z.infer<typeof terminalShellInfoSchema>;

export const TERMINAL_SHELL_DISTRO_NAME = distroName;
