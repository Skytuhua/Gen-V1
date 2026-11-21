import { describe, expect, it } from "vitest";
import { scanDiff, maskedPreview, fingerprintFor, SECRET_SCAN_FILE_CAP_BYTES } from "../packages/workspace/secret-scan.ts";

const KEY = Buffer.alloc(32, 7);
const OPTS = { scope: "commit" as const, fingerprintKey: KEY };

function diffFor(path: string, added: string[], start = 1): string {
  const lines = added.map((l) => `+${l}`);
  return `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +${start},${lines.length} @@\n${lines.join("\n")}\n`;
}

// Runtime-generated fixture values: no realistic token literal is committed.
// Stride 37 is coprime with 62 so generated values cycle through the whole
// alphanumeric pool — entropy stays above the medium-rule thresholds and
// every character is valid inside the token charsets.
const POOL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const gen = (n: number, off = 0) => Array.from({ length: n }, (_, i) => POOL[(i * 37 + off) % POOL.length]).join("");

const RULE_FIXTURES: { id: string; positive: () => string; negative: () => string }[] = [
  { id: "aws-access-key-id", positive: () => `key = "AKIA${gen(16).replace(/[a-z]/g, "Z")}"`, negative: () => `key = "AKIA${gen(10).replace(/[a-z]/g, "Z")}"` },
  { id: "aws-secret-key", positive: () => `aws_secret_key = "${gen(40)}"`, negative: () => `aws_secret_key = "example-${gen(20)}"` },
  { id: "github-token", positive: () => `t = "ghp_${gen(36)}"`, negative: () => `t = "ghp_${gen(10)}"` },
  { id: "github-fine-grained", positive: () => `t = "github_pat_${gen(60)}"`, negative: () => `t = "github_pat_${gen(20)}"` },
  { id: "gitlab-token", positive: () => `t = "glpat-${gen(20)}"`, negative: () => `t = "glpat-${gen(8)}"` },
  { id: "slack-token", positive: () => `t = "xoxb-${gen(11)}"`, negative: () => `t = "xoxb-${gen(4)}"` },
  { id: "slack-app-token", positive: () => `t = "xapp-1-${gen(10)}"`, negative: () => `t = "xapp-1-${gen(3)}"` },
  { id: "slack-webhook", positive: () => `u = "https://hooks.slack.com/services/TAAAAA/BBBBB/${gen(24)}"`, negative: () => `u = "https://hooks.slack.com/services/TAAAAA/BBBBB/${gen(8)}"` },
  { id: "stripe-live", positive: () => `k = "sk_live_${gen(24)}"`, negative: () => `k = "sk_test_${gen(24)}"` },
  { id: "openai-key", positive: () => `k = "sk-proj-${gen(44)}"`, negative: () => `k = "sk-ant-api03-${gen(84)}"` },
  { id: "anthropic-key", positive: () => `k = "sk-ant-api03-${gen(84)}"`, negative: () => `k = "sk-ant-api03-${gen(20)}"` },
  { id: "google-api-key", positive: () => `k = "AIza${gen(35)}"`, negative: () => `k = "AIza${gen(10)}"` },
  { id: "private-key", positive: () => `-----BEGIN RSA PRIVATE KEY-----`, negative: () => `-----BEGIN PUBLIC KEY-----` },
  { id: "npm-token", positive: () => `t = "npm_${gen(36)}"`, negative: () => `t = "npm_${gen(10)}"` },
  { id: "huggingface-token", positive: () => `t = "hf_${gen(36)}"`, negative: () => `t = "hf_${gen(10)}"` },
  { id: "sendgrid-key", positive: () => `k = "SG.${gen(22)}.${gen(43)}"`, negative: () => `k = "SG.${gen(5)}.${gen(5)}"` },
  { id: "vault-token", positive: () => `t = "hvs.${gen(24)}"`, negative: () => `t = "hvs.${gen(8)}"` },
  { id: "digitalocean-token", positive: () => `t = "dop_v1_${"a1b2c3d4".repeat(8)}"`, negative: () => `t = "dop_v1_${"a1b2".repeat(4)}"` },
  { id: "databricks-token", positive: () => `t = "dapi${"ab12cd34".repeat(4)}"`, negative: () => `t = "dapi${"ab12".repeat(4)}"` },
  { id: "jwt", positive: () => `t = "eyJ${gen(20)}.eyJ${gen(20)}.${gen(20)}"`, negative: () => `t = "eyJ${gen(5)}.eyJ${gen(5)}.${gen(5)}"` },
  { id: "url-credentials", positive: () => `u = "https://user:${gen(12)}@host.example/path"`, negative: () => `u = "https://user:\${TOKEN}@host.example/path"` },
  { id: "generic-assignment", positive: () => `api_key = "${gen(24)}"`, negative: () => `api_key = "aaaaaaaaaaaaaaaaaaaa"` },
];

describe("secret-scan rules", () => {
  for (const { id, positive, negative } of RULE_FIXTURES) {
    it(`${id}: reports positive, ignores negative`, () => {
      const hit = scanDiff(diffFor("src/config.ts", [positive()]), OPTS);
      expect(hit.findings.map((f) => f.ruleId), JSON.stringify(hit.findings)).toContain(id);
      const miss = scanDiff(diffFor("src/config.ts", [negative()]), OPTS);
      expect(miss.findings.map((f) => f.ruleId), negative()).not.toContain(id);
    });
  }
});

describe("secret-scan parsing", () => {
  it("tracks new-side line numbers across hunks and files", () => {
    const diff =
      `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,3 @@\n const a=1;\n+token = "ghp_${gen(36)}"\n const b=2;\n@@ -40,1 +41,2 @@\n+key = "glpat-${gen(20)}"\n` +
      `diff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -0,0 +1,2 @@\n+const x=1;\n+pwd = "hvs.${gen(24)}"\n`;
    const r = scanDiff(diff, OPTS);
    expect(r.findings).toHaveLength(3);
    expect(r.findings[0]).toMatchObject({ path: "a.ts", line: 2 });
    expect(r.findings[1]).toMatchObject({ path: "a.ts", line: 41 });
    expect(r.findings[2]).toMatchObject({ path: "b.ts", line: 2 });
  });

  it("ignores /dev/null deletions and removed lines", () => {
    const diff = `diff --git a/old.ts b/old.ts\n--- a/old.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-token = "ghp_${gen(36)}"\n-x = 1;\n`;
    expect(scanDiff(diff, OPTS).findings).toHaveLength(0);
  });

  it("honors the gen-secret-scan: allow inline marker", () => {
    const line = `token = "ghp_${gen(36)}" // gen-secret-scan: allow`;
    expect(scanDiff(diffFor("a.ts", [line]), OPTS).findings).toHaveLength(0);
  });

  it("skips medium rules on lock/minified/map/svg paths but keeps high rules", () => {
    const medium = `password = "${gen(24)}"`;
    expect(scanDiff(diffFor("pnpm-lock.yaml", [medium]), OPTS).findings).toHaveLength(0);
    expect(scanDiff(diffFor("dist/bundle.min.js", [medium]), OPTS).findings).toHaveLength(0);
    const high = `t = "ghp_${gen(36)}"`;
    expect(scanDiff(diffFor("pnpm-lock.yaml", [high]), OPTS).findings).toHaveLength(1);
  });

  it("scans synthesized patches for untracked files", () => {
    const diff = `diff --git a/new.ts b/new.ts\nnew file mode 100644\nindex 0000000..2222222\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,1 @@\n+key = "npm_${gen(36)}"\n`;
    const r = scanDiff(diff, OPTS);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].ruleId).toBe("npm-token");
  });

  it("records binary files as skipped", () => {
    const diff = `diff --git a/logo.png b/logo.png\nindex 111..222 100644\nBinary files a/logo.png and b/logo.png differ\n`;
    const r = scanDiff(diff, OPTS);
    expect(r.skipped).toEqual([{ path: "logo.png", reason: "binary" }]);
  });

  it("flags files over the per-file cap", () => {
    const big = `x = "${gen(SECRET_SCAN_FILE_CAP_BYTES + 16)}"`;
    const r = scanDiff(diffFor("big.ts", [big]), OPTS);
    expect(r.skipped).toEqual([{ path: "big.ts", reason: "too-large" }]);
    expect(r.incomplete).toEqual({ reasons: ["file-cap"] });
  });
});

describe("preview and fingerprint", () => {
  it("preview never exposes more than 6 chars of the value", () => {
    const value = `ghp_${gen(36)}`;
    const p = maskedPreview("github-token", value);
    for (let i = 3; i < value.length - 2; i++) {
      expect(p).not.toContain(value.slice(i, i + 4));
    }
    expect(p.startsWith(value.slice(0, 4))).toBe(true);
    expect(p.endsWith(value.slice(-2))).toBe(true);
    expect(maskedPreview("private-key", "x")).toBe("-----BEGIN … PRIVATE KEY-----");
    expect(maskedPreview("github-token", "short")).toBe("••••••••");
  });

  it("fingerprint is stable and path-sensitive", () => {
    const a = fingerprintFor(KEY, "github-token", "a.ts", "v1");
    expect(a).toBe(fingerprintFor(KEY, "github-token", "a.ts", "v1"));
    expect(a).toHaveLength(32);
    expect(a).not.toBe(fingerprintFor(KEY, "github-token", "b.ts", "v1"));
    expect(a).not.toBe(fingerprintFor(KEY, "github-token", "a.ts", "v2"));
    expect(a).not.toBe(fingerprintFor(KEY, "gitlab-token", "a.ts", "v1"));
  });
});

describe("performance", () => {
  it("each rule completes a 100KB adversarial line in <50ms", () => {
    const adversarial = "+" + "a".repeat(100 * 1024) + "ghp_" + "!".repeat(200) + "\n";
    const diff = diffFor("a.ts", [adversarial.slice(1)]);
    const start = performance.now();
    scanDiff(diff, OPTS);
    expect(performance.now() - start).toBeLessThan(50);
  });

  it("scans a 256KiB diff in <150ms", () => {
    const lines = Array.from({ length: 8192 }, (_, i) => `const v${i} = "${gen(8, i)}";`);
    const diff = diffFor("big.ts", lines);
    expect(diff.length).toBeGreaterThan(200 * 1024);
    const start = performance.now();
    scanDiff(diff, OPTS);
    expect(performance.now() - start).toBeLessThan(150);
  });
});
