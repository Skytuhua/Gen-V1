# Curated summary — vitest-background-work-r3.log

Original raw output removed per CONTRIBUTING shared-evidence rules; preserved byte-for-byte out of source.

- Command: `pnpm exec vitest run tests/background-work-v3.test.ts --maxWorkers=1`
- Observed result: **PASS 0**
- Log stats: 1 passed; 51 lines, 5671 bytes
- Original sha256: `21b02569985b53306f01b58080cb0e78235506e1dc8ba046bf264a88a22de214`
- What: background-work suite on the captured post-merge cut (see receipts for exact SHA/argv).

## Terminal tail (bounded excerpt, paths redacted)

```
     [33m[2m✓[22m[39m admission rejects malformed command specs and non-read-only idle kinds [33m 6443[2mms[22m[39m
     [33m[2m✓[22m[39m G03: rollback stops owned running commands and preserves their receipts [33m 3705[2mms[22m[39m

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m43 passed[39m[22m[90m (43)[39m
[2m   Start at [22m 03:11:37
[2m   Duration [22m 263.78s[2m (transform 65.02s, setup 0ms, import 69.07s, tests 188.99s, environment 0ms)[22m

```
