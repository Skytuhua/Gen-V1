import { randomUUID } from 'node:crypto';
import { HarnessError } from '../contracts/index.ts';
import { secretRefV1Schema, type SecretDestinationV1, type SecretRefV1 } from '../contracts/execution-profile.ts';

/** SecretRefV1 custody. A reference exposes only its opaque id, purpose, owner
 * and permitted destination. Resolution happens inside the authorized executor
 * after a single-use, destination-bound, expiring approval. Secret values,
 * raw environment dumps and low-entropy secret hashes never enter model
 * context or public journals; resolvers are host-side only. */

export type SecretResolver = () => string | Promise<string>;
export interface SecretApproval {
  nonce: string;
  refId: string;
  destination: SecretDestinationV1;
  expiresAt: number;
  actor: string | null;
}
export interface SecretResolution {
  env?: Record<string, string>;
  headers?: Record<string, string>;
}
export interface SecretRefMetadata {
  refId: string;
  purpose: string;
  owner: string;
  destination: SecretDestinationV1;
  revoked: boolean;
}

interface Entry { ref: SecretRefV1; resolver: SecretResolver; revoked: boolean }
interface IssuedApproval extends SecretApproval { consumed: boolean }

const MAX_SECRET_BYTES = 8192;
const DEFAULT_APPROVAL_TTL_MS = 60_000;
const MAX_APPROVAL_TTL_MS = 300_000;

function sameDestination(a: SecretDestinationV1, b: SecretDestinationV1): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'process-env' && b.kind === 'process-env') return a.executableSha256 === b.executableSha256 && a.envName === b.envName;
  if (a.kind === 'http-header' && b.kind === 'http-header') return a.origin === b.origin && a.header === b.header;
  return false;
}
const denied = (code: string, message: string) => new HarnessError(code, message);

export class SecretReferenceLedger {
  private readonly entries = new Map<string, Entry>();
  private readonly approvals = new Map<string, IssuedApproval>();
  constructor(private readonly now: () => number = Date.now) {}

  /** Register metadata plus a host-side resolver. The resolver is invoked only
   * inside resolve(), after approval, and its value is never stored here. */
  register(ref: SecretRefV1, resolver: SecretResolver): void {
    const parsed = secretRefV1Schema.parse(ref);
    if (this.entries.has(parsed.refId)) throw denied('SECRET_REF_CONFLICT', 'A secret reference with this id is already registered.');
    if (typeof resolver !== 'function') throw denied('INVALID_INPUT', 'A secret reference requires a host-side resolver.');
    this.entries.set(parsed.refId, { ref: parsed, resolver, revoked: false });
  }

  /** Metadata only — never values, resolvers or digests of values. */
  list(): SecretRefMetadata[] {
    return [...this.entries.values()].map(entry => ({
      refId: entry.ref.refId, purpose: entry.ref.purpose, owner: entry.ref.owner,
      destination: structuredClone(entry.ref.destination), revoked: entry.revoked,
    }));
  }

  /** Issue a single-use approval bound to the exact permitted destination. */
  approve(refId: string, destination: SecretDestinationV1, options?: { ttlMs?: number; actor?: string }): SecretApproval {
    const entry = this.entries.get(refId);
    if (!entry) throw denied('SECRET_REF_UNKNOWN', 'The secret reference is not registered.');
    if (entry.revoked) throw denied('SECRET_REF_REVOKED', 'The secret reference was revoked.');
    const requested = secretRefV1Schema.shape.destination.parse(destination);
    if (!sameDestination(requested, entry.ref.destination)) {
      throw denied('SECRET_REF_DESTINATION', 'Secret resolution requires the exact permitted destination.');
    }
    const ttl = Math.min(Math.max(options?.ttlMs ?? DEFAULT_APPROVAL_TTL_MS, 1), MAX_APPROVAL_TTL_MS);
    const approval: IssuedApproval = {
      nonce: randomUUID(), refId, destination: structuredClone(entry.ref.destination),
      expiresAt: this.now() + ttl, actor: options?.actor ?? null, consumed: false,
    };
    this.approvals.set(approval.nonce, approval);
    const { consumed: _consumed, ...publicApproval } = approval;
    return publicApproval;
  }

  /** Resolve for the smallest authorized destination only, inside the executor.
   * The approval is single-use, expiring and bound to refId + exact destination. */
  async resolve(refId: string, destination: SecretDestinationV1, approval?: SecretApproval): Promise<SecretResolution> {
    const entry = this.entries.get(refId);
    if (!entry) throw denied('SECRET_REF_UNKNOWN', 'The secret reference is not registered.');
    if (entry.revoked) throw denied('SECRET_REF_REVOKED', 'The secret reference was revoked.');
    const requested = secretRefV1Schema.shape.destination.parse(destination);
    const issued = approval ? this.approvals.get(approval.nonce) : undefined;
    if (!approval || !issued || issued.consumed) throw denied('SECRET_REF_APPROVAL', 'Secret resolution requires a current approval.');
    if (issued.expiresAt <= this.now()) throw denied('SECRET_REF_APPROVAL', 'The secret approval expired.');
    if (issued.refId !== refId || !sameDestination(issued.destination, entry.ref.destination) || !sameDestination(requested, entry.ref.destination)) {
      throw denied('SECRET_REF_DESTINATION', 'Secret resolution requires the exact permitted destination.');
    }
    issued.consumed = true;
    const value = await entry.resolver();
    if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > MAX_SECRET_BYTES || value.includes('\0')) {
      throw denied('SECRET_REF_INVALID', 'The secret resolver returned an invalid value.');
    }
    if (entry.ref.destination.kind === 'process-env') {
      return Object.freeze({ env: Object.freeze({ [entry.ref.destination.envName]: value }) });
    }
    return Object.freeze({ headers: Object.freeze({ [entry.ref.destination.header]: value }) });
  }

  /** Revocation prevents subsequent use. Values already delivered to an
   * external destination cannot be retroactively undisclosed. */
  revoke(refId: string): boolean {
    const entry = this.entries.get(refId);
    if (!entry || entry.revoked) return false;
    entry.revoked = true;
    for (const approval of this.approvals.values()) if (approval.refId === refId) approval.consumed = true;
    return true;
  }
}

/** Children start from an explicit environment allowlist, never a copy of
 * process.env. Injected secrets appear only under their approved names. */
export function buildChildEnvironment(
  base: Readonly<Record<string, string | undefined>>,
  allowlist: readonly string[],
  injections: readonly { name: string; value: string }[] = [],
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of allowlist) {
    const value = base[name];
    if (typeof value === 'string') env[name] = value;
  }
  for (const injection of injections) env[injection.name] = injection.value;
  return env;
}

/* ------------------------------------------------------------------ */
/* Structured redaction. Best-effort, declared-scope only: it covers   */
/* registered known values (raw, JSON-escaped, percent/base64 encoded,  */
/* ANSI-split, multiline) plus explicitly declared secret field names.  */
/* It is not a universal scrubber and never claims to be.               */
/* ------------------------------------------------------------------ */

const MIN_TRACKED_SECRET_LENGTH = 8;
const REDACTED = '[REDACTED]';
const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()#][0-9A-Za-z]|\x1b[=>]/g;

export interface SecretRedactor {
  redact(text: string): { text: string; redactions: number };
  readonly tracked: number;
}

export function createSecretRedactor(secrets: Iterable<string>, options?: { fields?: readonly string[] }): SecretRedactor {
  const variants = new Set<string>();
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < MIN_TRACKED_SECRET_LENGTH) continue;
    variants.add(secret);
    variants.add(JSON.stringify(secret).slice(1, -1));
    variants.add(encodeURIComponent(secret));
    variants.add(Buffer.from(secret, 'utf8').toString('base64'));
    variants.add(Buffer.from(secret, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  }
  // Match complete JSON string values, including escaped quotes and backslashes.
  const fieldPatterns = (options?.fields ?? []).map(field =>
    new RegExp(`("${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*")((?:\\\\.|[^"\\\\])*)(")`, 'g'));

  function redact(text: string): { text: string; redactions: number } {
    // Match on an ANSI-stripped view so escape-split secrets still redact,
    // then map every match range back onto the original text.
    const clean: string[] = [];
    const origin: number[] = [];
    let cursor = 0;
    for (const match of text.matchAll(ANSI_PATTERN)) {
      const index = match.index ?? 0;
      for (let i = cursor; i < index; i++) { clean.push(text[i]!); origin.push(i); }
      cursor = index + match[0].length;
    }
    for (let i = cursor; i < text.length; i++) { clean.push(text[i]!); origin.push(i); }
    const cleanText = clean.join('');

    const ranges: [number, number][] = [];
    for (const variant of variants) {
      if (!variant) continue;
      let at = cleanText.indexOf(variant);
      while (at !== -1) {
        ranges.push([at, at + variant.length]);
        at = cleanText.indexOf(variant, at + Math.max(variant.length, 1));
      }
    }
    for (const pattern of fieldPatterns) {
      pattern.lastIndex = 0;
      for (const match of cleanText.matchAll(pattern)) {
        const start = match.index + match[1]!.length;
        ranges.push([start, start + match[2]!.length]);
      }
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const [start, end] of ranges) {
      const last = merged[merged.length - 1];
      if (last && start <= last[1]) last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
    }
    if (!merged.length) return { text, redactions: 0 };
    let out = '', at = 0, redactions = 0;
    for (const [start, end] of merged) {
      const from = origin[start] ?? text.length;
      const to = (origin[end - 1] ?? text.length - 1) + 1;
      out += text.slice(at, from) + REDACTED;
      at = to; redactions++;
    }
    return { text: out + text.slice(at), redactions };
  }

  return Object.freeze({ redact, tracked: variants.size });
}
