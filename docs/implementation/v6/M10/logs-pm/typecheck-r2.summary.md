# Curated summary — typecheck-r2.log

Original raw output removed per CONTRIBUTING shared-evidence rules; preserved byte-for-byte out of source.

- Command: `pnpm typecheck`
- Observed result: **FAIL 134 (V8 heap OOM under load)**
- Log stats: n/a; 23 lines, 1023 bytes
- Original sha256: `42313d1f5bd6f2fe67184ff66946cd2e381595fe808c32623345e3c57a00c522`
- What: typecheck attempt 2 on the captured post-merge cut (see receipts for exact SHA/argv).

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
