# Curated summary — typecheck.log

Original raw output removed per CONTRIBUTING shared-evidence rules; preserved byte-for-byte out of source.

- Command: `pnpm typecheck`
- Observed result: **FAIL 134 (V8 heap OOM under load)**
- Log stats: n/a; 23 lines, 990 bytes
- Original sha256: `134765f9d96be3493af36df134815cb762fe061c407d0b2861287cf4c4526c6b`
- What: typecheck attempt 1 on the captured post-merge cut (see receipts for exact SHA/argv).

## Terminal tail (bounded excerpt, paths redacted)

```
 4: 0xda7f1c  [node]
 5: 0xda7f4c  [node]
 6: 0xda82a4  [node]
 7: 0xdb7a44  [node]
 8: 0xdbb6a4  [node]
 9: 0x17a1ed4  [node]
Aborted (core dumped)
 ELIFECYCLE  Command failed with exit code 134.
```
