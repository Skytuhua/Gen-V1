# Curated summary — vitest-background-work-r2.log

Original raw output removed per CONTRIBUTING shared-evidence rules; preserved byte-for-byte out of source.

- Command: `pnpm exec vitest run tests/background-work-v3.test.ts --maxWorkers=1`
- Observed result: **FAIL 1 (load-flake, retried)**
- Log stats: 42 passed, 1 failed; 66 lines, 6835 bytes
- Original sha256: `8fd581bf5a6990ede2aee738b32ffaa4a8000dbe26cd1871bfb99c3cdfa34c0c`
- What: background-work suite attempt 2 on the captured post-merge cut (see receipts for exact SHA/argv).

## Terminal tail (bounded excerpt, paths redacted)

```
[31m[2m⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯[22m[39m


[2m Test Files [22m [1m[31m1 failed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[31m1 failed[39m[22m[2m | [22m[1m[32m42 passed[39m[22m[90m (43)[39m
[2m   Start at [22m 02:56:39
[2m   Duration [22m 395.68s[2m (transform 15.66s, setup 0ms, import 17.71s, tests 377.09s, environment 0ms)[22m

```
