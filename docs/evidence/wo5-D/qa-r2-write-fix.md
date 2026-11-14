# QA r2: capture descriptor writes

The sole r2 major is fixed in the capture writer. Main 8db06df was merged normally before implementation; its credential-lease build script and the integration browser runner alias were both retained. No backend/server route implementation was changed by this fix.

Reports, screenshots and frame strips now share writeCaptureFile. Playwright returns image buffers instead of writing paths. The writer rechecks containment and every directory component at write time, creates files exclusively, uses O_NOFOLLOW where supported, checks regular-file identity against the opened descriptor, and writes only through that descriptor. It verifies the parent and leaf again after writing and closes all handles on failure.

Linux pins parent directory descriptors and resolves child creation through /proc/self/fd, preventing an ancestor swap from redirecting file creation. Windows uses O_EXCL without O_NOFOLLOW, per-component lstat/realpath checks and post-open descriptor identity checks; the fallback branch is covered by unit tests on Linux. Native Windows execution remains unverified.

Reproduction: after extracting the unchanged write path, two tests failed with 33 passing: a validated screenshot directory swapped to an outside symlink, and a substituted output-file symlink. Both passed after the fix. Additional cases cover a swapped root, a directory swap during open, a last-moment leaf swap during the fd write, report/binary bytes, no overwrite, path escape and the Windows fallback. All fixture destinations and outside targets used temporary directories; no test wrote to the ledger.

Final verification: typecheck PASS; UI lint 465 sources/zero violations; relevant capture, browser-runner and public-source Vitest **10 files / 236 PASS**. The writer subset has **40 PASS**. A typecheck caught the obsolete resolve import after removing direct path writes; it was removed before the final passing checks. No browser suite or dev server was needed or run for this filesystem-only fix. All commands were bounded below five minutes and did not use QA's lock. This pnpm version rejects --store-dir for exec/run, so the supported explicit --config.store-dir=/home/box/.local/share/pnpm/store option was used; no dependency installation occurred.

Logs were copied in this separate explicit step after verification to `/home/box/gen-company/ledger/WO-5/fe/validation-D/qa-r2-130-_xgr80pt`. Current QA r1 screenshots remain historical UI evidence; this round changes only capture output I/O. Backend retains ownership of PR #129.

skills: ponytail, ponytail-review, engineering-team-process. The process skill was loaded from its workflow SKILL.md because the requested tools path is absent.
