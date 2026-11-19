# Curated summary — vitest-decisions.log

Original raw output removed per CONTRIBUTING shared-evidence rules; preserved byte-for-byte out of source.

- Command: `pnpm exec vitest run tests/background-contract-decisions-v6.test.ts --maxWorkers=1`
- Observed result: **PASS 0**
- Log stats: 1 passed; 17 lines, 1520 bytes
- Original sha256: `8caed8a34350467ee1321b236a719610303b1de62139f891fd387a4426869e46`
- What: decisions-v6 suite on the captured post-merge cut (see receipts for exact SHA/argv).

## Terminal tail (bounded excerpt, paths redacted)

```
     [33m[2m✓[22m[39m replays one delivery for the identical answer, conflicts on changed content, and grants no new approval [33m 2446[2mms[22m[39m
     [33m[2m✓[22m[39m wrong repository, repeated issue revision and injected commands create no executor call; an authorized new issue creates one proposal only [33m 2616[2mms[22m[39m

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m5 passed[39m[22m[90m (5)[39m
[2m   Start at [22m 03:15:28
[2m   Duration [22m 16.59s[2m (transform 1.58s, setup 0ms, import 2.01s, tests 14.19s, environment 0ms)[22m

```
