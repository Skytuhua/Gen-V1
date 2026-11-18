# Curated summary — lint.log

Original raw output removed per CONTRIBUTING shared-evidence rules; preserved byte-for-byte out of source.

- Command: `pnpm lint`
- Observed result: **PASS 0**
- Log stats: n/a; 5 lines, 214 bytes
- Original sha256: `c035c4112e75813d5c06b9ed92244cbbeb487ab0761a876ba8ae9f4a370167bd`
- What: lint on the captured post-merge cut (see receipts for exact SHA/argv).

## Terminal tail (bounded excerpt, paths redacted)

```

> gen-v1@0.6.5 lint <worktree-root>/gv1-m10-v6-pmcheck
> tsx scripts/lint-ui.ts --check

UI guard: 615 sources; 0 violations; 39 inventoried legacy/geometry occurrences (not primitive approvals); 0 retired entries.
```
