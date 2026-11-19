# Curated summary — build.log

Original raw output removed per CONTRIBUTING shared-evidence rules; preserved byte-for-byte out of source.

- Command: `pnpm build`
- Observed result: **PASS 0**
- Log stats: n/a; 106 lines, 8813 bytes
- Original sha256: `ce6d75a31a10e4947edf0b4df869308e91fab004d745e7a01b7780b83525199a`
- What: full build on the captured post-merge cut (see receipts for exact SHA/argv).

## Terminal tail (bounded excerpt, paths redacted)

```
../../dist/web/assets/pdf-CL8ynlU4.js                                        495.58 kB │ gzip: 151.29 kB
../../dist/web/assets/DesktopEntry-C4ZO4fjq.js                             1,243.81 kB │ gzip: 385.24 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1m 2s
```
