# PR #130 QA r1 frontend fixes

EM scope: fix majors 1, 3 and 4 and fixture-cache minor 5. **Major 2 is owned by Backend via PR #129 and is not implemented here.** Host project-wide search/checkpoint services remain unavailable; rich-reference restore and checkpoint writes remain disabled. No backend or frozen contract files changed relative to merged main.

Merged origin/main bef6239 normally (merge 895588d), then reviewed saved drafts 386176d (merge 5b509e2). #122 r2 remains included. The actual App's main/Canvas/embedded composer uses the owner-bound local library. Browser profile/origin storage, thread account, thread/project and the actual working-copy context form the library key; unknown context disables the action. Scoped readers retain the optional explicit-owner seam rather than inventing missing account metadata.

Checkpoint detail/review preserve exact frozen path bytes and use the existing displayFilePath helper for escaped labels. Capture validates physical existing ancestors before output, rejects external links and requires empty output to avoid following old child links. The named runner passes its actual output directory to fixture Vite caches; default configs use their own output directory. Direct CLI overrides must pass GEN_BROWSER_OUTPUT_DIR as documented.

## Verification

- Typecheck PASS; UI lint 464 sources, zero violations.
- Targeted Vitest: **19 files / 416 PASS**, including all six items, shared composer, journal, browser-runner, public-source, Chat View layout and capture tests.
- **118/118 WO-5 browser tests**: saved drafts 14, checkpoints 20, excerpts 9, Find 10, project search 38, redundant UI 18, actual App 9. The App tests exercise save/replace/recovery/reload/delete at 1440/1024/768, exact account/working-copy/thread fences, no Send, and retained destinations. Leaf tests cover insert/caret, stale restore and disabled rich references.
- Supplemental existing Chat View suite: **21/21 PASS** with an isolated temporary wrapper and a 10-second initial assertion wait; source assertions unchanged. Its full-page dimensions now use client sizes so the existing 150% zoom pointer route remains reachable.
- Output-guard tests also pass from a temporary checkout: **33/33**. CLI probes reject both an ancestor escaping link and nonempty output with a linked screenshots child before any external output is created.
- All seven Vite fixture caches were verified beneath the runner's actual overridden output directory. Timed background servers were cleaned up; owned ports 5491 and 5521–5527 were closed.
- Capture PASS at 375/768/1024/1440: **191 captured entries, 1 identical state, 197 motion rows, 12 strips**, zero failures and zero reduced-motion offenders. Saved drafts covers all 28 width/state cells with no skips. 375 remains tooling coverage; WO-5 primary evidence is 1440/1024 and secondary 768.

Repro first: five initial unit failures (three exact control paths, escaping symlink, missing runner/cache handoff), two additional valid filename cases and one actual-App missing Drafts action. These regressions pass after the fixes. The first post-integration App attempt also found a test editing before Save completed and the main-merge zoom sizing problem; both are corrected. A supplemental Chat View attempt passed 20/21 with an initial-render timeout before the clean pass. The first capture attempt exposed missing synthetic bootstrap routing for the new App fixture; the fresh full capture after registration passes. The failed/partial attempt log is retained as historical evidence. An inode-exhausted browser attempt stopped before test execution; only disposable earlier run-D caches/archive were removed.

All automated outputs were produced in tmp/test-results or Playwright output directories. **This evidence was copied separately after automation completed** to `/home/box/gen-company/ledger/WO-5/fe/before-after/D-integration/qa-r1-130-YsehnH`. Synthetic fixture images may show Reconnecting for the stubbed event stream; the actual App flow screenshots use the normal synthetic host. No provider, live host, full accessibility or packaged Windows acceptance is claimed. The historical baseline native Linux recovery failure remains a separate known limitation.

Remaining minors: ordinary excerpt size (QA 6), bounded CR-heavy preview rendering (QA 7). Cwd-dependent guard test (QA 8) is resolved with the symlink/output work. Independent final QA remains pending.

skills: engineering-team-process, ponytail, ponytail-review. The requested engineering-team-process tools path is absent; the workflow SKILL.md at /home/box/agent-data/workflows/engineering-team-process/SKILL.md was applied.
