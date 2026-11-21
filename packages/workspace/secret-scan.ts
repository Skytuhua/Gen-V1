// Pure secret scanner for unified diffs (issue #1331, plan r1 §2).
// Scans only added lines; produces masked findings — the preview and the
// fingerprint are the only representations of a matched value that leave
// this module. No I/O, no git calls, no network.

import { createHmac } from "node:crypto";

export const SECRET_SCAN_RULES_VERSION = 1;
const LONG_LINE_LIMIT = 4096;
export const SECRET_SCAN_FILE_CAP_BYTES = 1024 * 1024;
export const SECRET_SCAN_TOTAL_CAP_BYTES = 16 * 1024 * 1024;

export interface SecretScanRule {
  id: string;
  label: string;
  confidence: "high" | "medium";
  regex: RegExp;
  capture?: 1;
  minEntropy?: number;
}

// §2.2 rule table. Regexes are case-sensitive unless noted, anchored on
// literal prefixes or \b, with no nested quantifiers (ReDoS by construction).
const RULES: readonly SecretScanRule[] = [
  { id: "aws-access-key-id", label: "AWS access key", confidence: "high", regex: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g },
  { id: "aws-secret-key", label: "AWS secret key", confidence: "high", regex: /aws.{0,20}(?:secret|private).{0,20}['"=:\s]([A-Za-z0-9/+=]{40})\b/gi, capture: 1, minEntropy: 4.0 },
  { id: "github-token", label: "GitHub token", confidence: "high", regex: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { id: "github-fine-grained", label: "GitHub token", confidence: "high", regex: /\bgithub_pat_[A-Za-z0-9_]{60,255}\b/g },
  { id: "gitlab-token", label: "GitLab token", confidence: "high", regex: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { id: "slack-token", label: "Slack token", confidence: "high", regex: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { id: "slack-app-token", label: "Slack token", confidence: "high", regex: /\bxapp-[0-9]-[A-Za-z0-9-]{10,}\b/g },
  { id: "slack-webhook", label: "Slack webhook URL", confidence: "high", regex: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{20,}/g },
  { id: "stripe-live", label: "Stripe live key", confidence: "high", regex: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g },
  { id: "openai-key", label: "OpenAI API key", confidence: "high", regex: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{40,}\b/g },
  { id: "anthropic-key", label: "Anthropic API key", confidence: "high", regex: /\bsk-ant-(?:api|admin)[0-9]{2}-[A-Za-z0-9_-]{80,}\b/g },
  { id: "google-api-key", label: "Google API key", confidence: "high", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: "private-key", label: "Private key", confidence: "high", regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g },
  { id: "npm-token", label: "npm token", confidence: "high", regex: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: "huggingface-token", label: "Hugging Face token", confidence: "high", regex: /\bhf_[A-Za-z0-9]{34,}\b/g },
  { id: "sendgrid-key", label: "SendGrid API key", confidence: "high", regex: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g },
  { id: "vault-token", label: "HashiCorp Vault token", confidence: "high", regex: /\bhvs\.[A-Za-z0-9_-]{24,}\b/g },
  { id: "digitalocean-token", label: "DigitalOcean token", confidence: "high", regex: /\bdo[por]_v1_[a-f0-9]{64}\b/g },
  { id: "databricks-token", label: "Databricks token", confidence: "high", regex: /\bdapi[a-f0-9]{32}(?:-[0-9])?\b/g },
  { id: "jwt", label: "JSON Web Token", confidence: "medium", regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { id: "url-credentials", label: "Password in URL", confidence: "medium", regex: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s/:@'"]{1,64}:([^\s/@'"]{6,128})@[^\s/'"]+/g, capture: 1 },
  { id: "generic-assignment", label: "Possible secret value", confidence: "medium", regex: /\b(?:api[_-]?key|apikey|secret|client[_-]?secret|access[_-]?token|auth[_-]?token|private[_-]?key|password|passwd)\b["']?\s*[:=]\s*["']([^"'\s]{16,256})["']/gi, capture: 1, minEntropy: 3.5 },
];

// §R07(c): generic (medium) rules skip generated/minified files; high rules
// still apply there.
const MEDIUM_SKIP_PATH = /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$|\.lock$|\.min\.js$|\.map$|\.svg$/i;

const PLACEHOLDER_NEEDLES = [
  "example", "sample", "dummy", "placeholder", "changeme", "your_",
  "<", ">", "${", "{{", "process.env", "os.environ",
];

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function isRepeatedOrSequential(value: string): boolean {
  if (value.length < 6) return false;
  let repeated = true;
  let sequential = true;
  for (let i = 1; i < value.length; i++) {
    if (value.charCodeAt(i) !== value.charCodeAt(0)) repeated = false;
    if (value.charCodeAt(i) !== value.charCodeAt(i - 1) + 1) sequential = false;
    if (!repeated && !sequential) return false;
  }
  return true;
}

// R07(a): placeholder filter applied to the captured value (or full match).
function isPlaceholderValue(value: string): boolean {
  const lower = value.toLowerCase();
  if (PLACEHOLDER_NEEDLES.some((needle) => lower.includes(needle))) return true;
  return isRepeatedOrSequential(value);
}

// §2.4 masked preview — never exposes more than 6 chars of the value.
export function maskedPreview(ruleId: string, value: string): string {
  if (ruleId === "private-key") return "-----BEGIN … PRIVATE KEY-----";
  if (value.length >= 12) return value.slice(0, 4) + "…" + "•".repeat(Math.min(8, value.length - 6)) + value.slice(-2);
  return "•".repeat(8);
}

// §2.5 fingerprint; caller supplies the 32-byte key.
export function fingerprintFor(key: string | Buffer, ruleId: string, path: string, value: string): string {
  return createHmac("sha256", key).update(`${ruleId}\0${path}\0${value}`).digest("hex").slice(0, 32);
}

export interface SecretFindingV1 {
  id: string;
  ruleId: string;
  ruleLabel: string;
  confidence: "high" | "medium";
  path: string;
  line: number;
  preview: string;
  fingerprint: string;
  commit?: { sha: string; subject: string };
}

export type SecretScanIncompleteReason =
  | "file-cap"
  | "total-cap"
  | "commit-cap"
  | "unreadable"
  | "long-line-truncated";

export interface SecretScanResultV1 {
  version: 1;
  rulesVersion: 1;
  scope: "commit" | "push";
  findings: SecretFindingV1[];
  skipped: { path: string; reason: "binary" | "not-utf8" | "too-large" }[];
  incomplete: false | { reasons: SecretScanIncompleteReason[] };
}

export interface SecretScanOptions {
  scope: "commit" | "push";
  fingerprintKey: string | Buffer;
  commit?: { sha: string; subject: string };
  fileCapBytes?: number;
  totalCapBytes?: number;
  preSkipped?: { path: string; reason: "binary" | "not-utf8" | "too-large" }[];
  preIncomplete?: SecretScanIncompleteReason[];
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const DIFF_GIT = /^diff --git a\/.+ b\/(.+)$/;
const NEW_FILE = /^\+\+\+ b\/(.+)$/;

export function scanDiff(input: string, options: SecretScanOptions): SecretScanResultV1 {
  const findings: SecretFindingV1[] = [];
  const skipped: SecretScanResultV1["skipped"] = [...(options.preSkipped ?? [])];
  const reasons = new Set<SecretScanIncompleteReason>(options.preIncomplete ?? []);
  const fileCap = options.fileCapBytes ?? SECRET_SCAN_FILE_CAP_BYTES;
  const totalCap = options.totalCapBytes ?? SECRET_SCAN_TOTAL_CAP_BYTES;

  let path = "";
  let pendingPath = "";
  let skipFile = false;
  let fileAddedBytes = 0;
  let totalAddedBytes = 0;
  let newLine = 0;
  let capped = false;

  for (const rawLine of input.split("\n")) {
    if (capped) break;
    const fileHeader = DIFF_GIT.exec(rawLine);
    if (fileHeader) {
      pendingPath = fileHeader[1];
      path = pendingPath;
      skipFile = false;
      fileAddedBytes = 0;
      continue;
    }
    const newFile = NEW_FILE.exec(rawLine);
    if (newFile) {
      path = newFile[1];
      continue;
    }
    if (rawLine.startsWith("+++ /dev/null")) {
      // Deletion: no new side to scan.
      skipFile = true;
      continue;
    }
    if (/^Binary files .+ differ$/.test(rawLine) || rawLine === "GIT binary patch") {
      if (path) {
        skipped.push({ path, reason: "binary" });
        skipFile = true;
      }
      continue;
    }
    const hunk = HUNK_HEADER.exec(rawLine);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (rawLine.startsWith("-") || rawLine.startsWith("\\") || rawLine.startsWith(" ")) {
      if (rawLine.startsWith(" ")) newLine++;
      continue;
    }
    if (!rawLine.startsWith("+") || rawLine.startsWith("+++")) continue;
    if (skipFile) { newLine++; continue; }
    const lineNo = newLine;
    newLine++;

    const added = rawLine.slice(1);
    fileAddedBytes += added.length;
    totalAddedBytes += added.length;
    if (fileAddedBytes > fileCap) {
      skipped.push({ path, reason: "too-large" });
      reasons.add("file-cap");
      skipFile = true;
      continue;
    }
    if (totalAddedBytes > totalCap) {
      reasons.add("total-cap");
      capped = true;
      break;
    }
    // R07(b): inline marker disables the line in any comment syntax.
    if (added.includes("gen-secret-scan: allow")) continue;

    const truncated = added.length > LONG_LINE_LIMIT;
    const text = truncated ? added.slice(0, LONG_LINE_LIMIT) : added;
    for (const rule of RULES) {
      if (rule.confidence === "medium" && MEDIUM_SKIP_PATH.test(path)) continue;
      rule.regex.lastIndex = 0;
      for (const match of text.matchAll(rule.regex)) {
        const whole = match[0];
        const value = rule.capture ? match[1]! : whole;
        if (rule.id === "openai-key" && whole.startsWith("sk-ant-")) continue;
        if (rule.minEntropy !== undefined && shannonEntropy(value) < rule.minEntropy) continue;
        if (isPlaceholderValue(value)) continue;
        if (truncated && match.index! + whole.length >= LONG_LINE_LIMIT) {
          reasons.add("long-line-truncated");
          continue;
        }
        const fingerprint = fingerprintFor(options.fingerprintKey, rule.id, path, value);
        const id = fingerprint.slice(0, 12) + "-" + lineNo + (options.commit ? "-" + options.commit.sha.slice(0, 7) : "");
        findings.push({
          id, ruleId: rule.id, ruleLabel: rule.label, confidence: rule.confidence,
          path, line: lineNo, preview: maskedPreview(rule.id, value), fingerprint,
          ...(options.commit ? { commit: { sha: options.commit.sha, subject: options.commit.subject.slice(0, 80) } } : {}),
        });
      }
    }
  }

  findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  return {
    version: 1,
    rulesVersion: SECRET_SCAN_RULES_VERSION,
    scope: options.scope,
    findings,
    skipped,
    incomplete: reasons.size === 0 ? false : { reasons: [...reasons] },
  };
}
