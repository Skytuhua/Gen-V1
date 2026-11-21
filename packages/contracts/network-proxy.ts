import { z } from 'zod';

/**
 * #1531 T02 — network proxy management DTOs (strict; never echo raw values).
 * Public url is always credential-free; credentials live only in the
 * host-private protected blob.
 */

export const networkProxyPublicStateSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  /** Sanitized endpoint without userinfo; null = Not configured. */
  url: z.string().nullable(),
  /** Canonicalized user bypass entries (host or .suffix, optional :port). */
  bypass: z.array(z.string()),
  /** Mandatory local bypass (always effective; shown separately). */
  mandatoryBypass: z.array(z.string()),
  hasCredentials: z.boolean(),
  secretStorageAvailable: z.boolean(),
});
export type NetworkProxyPublicState = z.infer<typeof networkProxyPublicStateSchema>;

export const networkProxySaveSchema = z.strictObject({
  baseRevision: z.number().int().nonnegative(),
  /** Full proxy URL, optionally carrying percent-encoded userinfo; null clears endpoint+bypass+credentials. */
  url: z.string().max(4096).nullable(),
  bypass: z.array(z.string().max(200)).max(64).default([]),
  clearCredentials: z.literal(true).optional(),
});
export type NetworkProxySave = z.infer<typeof networkProxySaveSchema>;

export const networkProxyDeleteSchema = z.strictObject({
  baseRevision: z.number().int().nonnegative(),
});
export type NetworkProxyDelete = z.infer<typeof networkProxyDeleteSchema>;
