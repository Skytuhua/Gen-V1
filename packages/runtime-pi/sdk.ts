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
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----|\b(?:Bearer|Basic)\s+\S+|\bsk[-_][\w-]{2,}|\beyJ[\w-]+\.[\w-]+\.[\w-]+|\b(?:ABIA|ACCA|AGPA|AIDA|AIPA|AKIA|ANPA|ANVA|APKA|AROA|ASCA|ASIA)[0-9A-Z]{16}\b|\bAIza[\w-]{30,}|\bya29\.[\w-]+|\bgh[pousr]_[\w]{20,}|\bgithub_pat_[\w]{20,}|\bglpat-[\w-]{8,}|\bxox[a-z]-[\w-]{10,}|\bxapp-[\w-]{10,}|\bwhsec_[\w]{8,}|\bdop_v1_[a-f0-9]{20,}|\bnpm_[\w]{30,}|\bhf_[\w]{30,}|\bSG\.[\w-]{15,}\.[\w-]{15,}|\bhvs\.[\w-]{15,}|\bdapi[a-f0-9]{20,}/gi, "[redacted]")
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s/:@]*:[^\s/@]+@/g, "$1[redacted]@")
    .replace(/((?:access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|auth[_-]?token|token|api[_-]?key|api[_-]?secret|authorization|code[_-]?verifier|client[_-]?secret|private[_-]?key|signing[_-]?key|session[_-]?key|secret[_-]?key|access[_-]?key|session[_-]?id|session|secret|signature|password|passwd|pwd|passphrase|cookie|sid)["']?\s*[:=]\s*["']?)[^\s,}"']+/gi, "$1[redacted]").slice(0, 1200);
}
