# Curated summary — typecheck-r3.log

Original raw output removed per CONTRIBUTING shared-evidence rules; preserved byte-for-byte out of source.

- Command: `pnpm typecheck`
- Observed result: **FAIL 134 (V8 heap OOM under load)**
- Log stats: n/a; 23 lines, 769 bytes
- Original sha256: `c97d58fa2e71a4a1ddd4932e153bd273c197425ac5e80cdbed8fc0da0b49caf1`
- What: typecheck attempt 3 on the captured post-merge cut (see receipts for exact SHA/argv).

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
