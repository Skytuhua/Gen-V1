# Run D resumed verification

Merged current #120–#124 item heads without rewriting history, including WIP 50415d4 and 2c880b6. #122 r2 b6ee532 is an ancestor. Sources: Find 5d1c3ac, checkpoints 50415d4, excerpts 9dcd09b, project search b320f42.

- Typecheck: PASS. UI lint: 455 sources, zero violations.
- Vitest: 17 files, 370 tests PASS. Includes five items, shared composer generation/recovery, journal, public-source, browser-runner and capture tests.
- Browser suites: Find 10, checkpoints 19, excerpts 9, project search 38, redundant UI 18, actual App 5: **99 PASS**. Each server ran as a bounded background job and was cleaned up.
- Capture: seven requested screens; 375/768/1024/1440; 160 captured images, four identical states, 254 motion rows, twelve strips, zero reduced-motion offenders. Output validation PASS. Saved drafts retains seven explicitly pending recipes (28 width/state entries).

The existing App Send regression failed first because the new controller API received no accepted excerpt generation (one chip remained). Both shared and fallback App sends now carry the captured generation. The checkpoint binary-status regression also caught an empty recorded-diff message after the shared presentation merge; non-text statuses now stand alone. The new output-boundary test failed before the CLI rejected external destinations and passed after the guard. Tests and capture scripts wrote only into temporary directories or test-results; this report and evidence were copied separately after automation finished.

One initial full excerpt run timed out waiting for xterm startup in the scoped fixture (8 passed/1 failed). Its trace is retained in the ledger. An isolated diagnostic passed, then the complete fresh suite passed 9/9; no functional change or automatic retry hid that timeout. The prior broader compatibility run's native Linux memory guard failed identically on clean main d720300; the scoped required suite is reported here, not a full-suite pass.

Remaining minor follow-ups: ordinary excerpt size; terminal fixture cache placement relative to its Playwright output directory; specific checkpoint validation-error assertions. Incoming search CR-only preview and checkpoint caption/motion/output fixes are preserved. Production host search and checkpoint Restore remain disabled, WO-5.2 remains run A's hook, and live host, packaged Windows, assistive technology and independent final QA remain unverified.

Full output and updated captures: /home/box/gen-company/ledger/WO-5/fe/before-after/D-integration/resumed-final-P71qfn. Original matched baselines remain in the parent before/ directory and the repository's before PNGs. Current App widths and 1024 feature examples are linked from README.md.

skills: ponytail, ponytail-review, engineering-team-process. The requested engineering-team-process tools path was absent; its workflow SKILL.md was read at /home/box/agent-data/workflows/engineering-team-process/SKILL.md. Earlier integration also used impeccable and emil-design-eng; no new design was introduced.
