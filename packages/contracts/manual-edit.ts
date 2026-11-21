import { z } from "zod";
export const MANUAL_EDIT_LIMITS = { bytes: 1024 * 1024, bodyLimit: 2 * 1024 * 1024 } as const;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const manualEditCapabilityV1 = z.strictObject({
  available: z.boolean(),
  checkpoints: z.boolean(),
  reason: z.enum(["flag_off", "no_project", "thread_kind", "archived"]).optional(),
});
export const manualEditFileStateV1 = z.strictObject({
  editable: z.boolean(),
  reason: z.enum(["binary", "not_utf8", "too_large", "protected", "not_regular"]).optional(),
  bom: z.boolean(),
  lineSeparator: z.enum(["lf", "crlf", "mixed"]),
});
export const manualEditSaveRequestV1 = z.strictObject({
  threadId: z.string().regex(/^[a-zA-Z0-9:_.-]{1,200}$/).optional(),
  path: z.string().min(1).max(1024),
  text: z.string(),
  expectedSha256: sha256,
});
export const manualEditSaveResponseV1 = z.strictObject({
  sha256,
  bytes: z.number().int().nonnegative(),
  checkpoint: z.enum(["captured", "excluded", "unavailable", "disabled"]),
  checkpointId: z.string().optional(),
});
export type ManualEditCapabilityV1 = z.infer<typeof manualEditCapabilityV1>;
export type ManualEditFileStateV1 = z.infer<typeof manualEditFileStateV1>;
export type ManualEditSaveRequestV1 = z.infer<typeof manualEditSaveRequestV1>;
export type ManualEditSaveResponseV1 = z.infer<typeof manualEditSaveResponseV1>;
