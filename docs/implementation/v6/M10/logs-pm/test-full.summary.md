# Curated summary — test-full.log

Original raw output removed per CONTRIBUTING shared-evidence rules; preserved byte-for-byte out of source.

- Command: `pnpm test --maxWorkers=2`
- Observed result: **FAIL 1 (330 env-bound failures, 0 M10-scoped)**
- Log stats: 435 passed, 1 failed; 6413 lines, 677534 bytes
- Original sha256: `b9c69a13f62770dca40c66e8f2f3bc19d957babd7e4ad40ec966842f7ea85795`
- What: full test run on the captured post-merge cut (see receipts for exact SHA/argv).

## Terminal tail (bounded excerpt, paths redacted)

```

[2m Test Files [22m [1m[31m59 failed[39m[22m[2m | [22m[1m[32m435 passed[39m[22m[2m | [22m[33m6 skipped[39m[90m (500)[39m
[2m      Tests [22m [1m[31m330 failed[39m[22m[2m | [22m[1m[32m5446 passed[39m[22m[2m | [22m[33m115 skipped[39m[90m (5891)[39m
[2m     Errors [22m [1m[31m4 errors[39m[22m
[2m   Start at [22m 03:27:51
[2m   Duration [22m 5911.05s[2m (transform 271.45s, setup 0ms, import 1034.18s, tests 10428.61s, environment 222ms)[22m

 ELIFECYCLE  Test failed. See above for more details.
```
