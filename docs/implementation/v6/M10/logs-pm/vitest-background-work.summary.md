# Curated summary — vitest-background-work.log

Original raw output removed per CONTRIBUTING shared-evidence rules; preserved byte-for-byte out of source.

- Command: `pnpm exec vitest run tests/background-work-v3.test.ts --maxWorkers=1`
- Observed result: **FAIL 1 (load-flake, retried)**
- Log stats: 42 passed, 1 failed; 71 lines, 7313 bytes
- Original sha256: `576b38322900b1ac203ffa510e779f5dd689f3f78f9010bf1e776df5c17d262e`
- What: background-work suite attempt 1 on the captured post-merge cut (see receipts for exact SHA/argv).

## Terminal tail (bounded excerpt, paths redacted)

```
[31m[2m⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯[22m[39m


[2m Test Files [22m [1m[31m1 failed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[31m1 failed[39m[22m[2m | [22m[1m[32m42 passed[39m[22m[90m (43)[39m
[2m   Start at [22m 02:29:27
[2m   Duration [22m 283.40s[2m (transform 19.65s, setup 0ms, import 23.57s, tests 258.41s, environment 0ms)[22m

```
