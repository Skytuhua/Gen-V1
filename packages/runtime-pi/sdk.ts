import { HarnessError } from "../contracts/index.ts";

export type PiSdk = typeof import("@earendil-works/pi-coding-agent");
export async function loadSdk(): Promise<PiSdk> {
  try { return await import("@earendil-works/pi-coding-agent"); }
  catch { throw new HarnessError("PI_UNAVAILABLE", "Pi SDK 1.4.0 is unavailable. Complete pnpm install, then restart the harness."); }
}

/** Never forward provider credentials, authorization headers, or OAuth redirects. */
export function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Pi runtime failed";
  return message.replace(/https?:\/\/\S+/gi, "[URL withheld]")
    .replace(/Bearer\s+\S+|sk-[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted]")
    .replace(/((?:access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|code_verifier)["']?\s*[:=]\s*["']?)[^\s,}"']+/gi, "$1[redacted]").slice(0, 1200);
}
