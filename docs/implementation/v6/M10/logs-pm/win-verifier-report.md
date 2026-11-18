# M10 Windows/installed-native verification report

Verifier: isolated T3 thread on linked Windows env WIN-M0N0V07LGM1
(`t3-thread://v2/17662262-856e-45f7-98fb-56c92cacfa8f/mcp:launch:26d517050bbdc5deb6d809892770f014e64161daca9195c3328ee6ae092b7a20`,
model gpt-6.1-sol, run 2026-11-18T18:26:38Z -> 18:42:02Z).
Worktree `C:\Users\user\.t3\worktrees\Generative Harness\t3-bda7e1cb-57082b926f0db7f0`
(branch `t3/bda7e1cb`), verification-only: no commits, pushes, docs edits,
or flag changes; final `git status` clean.
This file reproduces the verifier's final report verbatim; supporting artifacts
remain on the box at `C:/Users/user/AppData/Local/Temp/m10-windows-2026-11-18T18-29-57-729Z/`.

---

Windows verification: **83/83 Vitest tests and 12/12 browser tests passed. Installed lane: UNSUPPORTED — ENV_MISSING.**

Source was fetched and detached at the requested cut:

```text
git rev-parse HEAD       → ff38c62c3b0f8856e08f528f3c2ea8b1c1fea199
git log -1 --format=%H   → ff38c62c3b0f8856e08f528f3c2ea8b1c1fea199
```

Both ancestry commands exited **0**, confirming inclusion of **#501**
(`016738f7b57117ffe9dbbd756cb3cd173c01e202`) and **#786** (`1d65ae1e`).

Environment: Windows 11 Home/Core 25H2, build **10.0.26200.9974**, x64; Node
**v24.14.0**; pnpm **10.30.3**. Browser: Playwright's default bundled
**Chromium 141.0.7390.37**, with no channel override (Playwright 1.56.1).

| Command | Exit | Wall time | Passed/failed | Verdict |
|---|---:|---:|---:|---|
| `pnpm install` | 0 | 244.18s | — | PASS |
| `pnpm build:widgets` | 0 | 0.51s | — | PASS |
| `pnpm exec vitest run tests/background-work-v3.test.ts` | 0 | 28.28s | 43/0 | PASS |
| `pnpm exec vitest run tests/human-handoff-v3.test.ts` | 0 | 80.85s | 11/0 | PASS |
| `pnpm exec vitest run tests/external-intake-v3.test.ts` | 0 | 26.44s | 24/0 | PASS |
| `pnpm exec vitest run tests/background-contract-decisions-v6.test.ts` | 0 | 6.41s | 5/0 | PASS |
| `pnpm test:browser --suite background-work` | 0 | 45.61s | 12/0 | PASS |
| `pnpm desktop:package` | 1 | 31.17s | — | UNSUPPORTED: ENV_MISSING |

First three failure identities: **none in any test lane**. Packaging had one
failure, `collectHermesPayload → ordinaryDirectory → lstat`:

```text
Error: ENOENT: no such file or directory, lstat 'C:\Users\user\.t3\worktrees\Generative Harness\t3-bda7e1cb-57082b926f0db7f0\.harness-hermes-python-deps'
```

No `{"artifacts":...}` output, Setup.exe, or `win-unpacked` was produced; the
reserved release directory was empty. The installed command, `pnpm exec tsx
scripts/verify-installed-desktop.ts "<absolute Setup.exe>" "<absolute
win-unpacked>"`, could not run. Its exit/time/counts are **N/A**, verdict
**UNSUPPORTED (ENV_MISSING)**. Install, owned process launch, CDP identity
revalidation, UI acceptance, and uninstall were all **NOT RUN**. No native
installed-verifier receipt exists.

Observer summary receipt:

```json
{"sha":"ff38c62c3b0f8856e08f528f3c2ea8b1c1fea199","contains501":true,"contains786":true,"vitest":{"passed":83,"failed":0},"browser":{"passed":12,"failed":0},"packaging":{"exitCode":1,"verdict":"UNSUPPORTED","classification":"ENV_MISSING","artifacts":[]},"installed":{"executed":false,"receiptProduced":false},"installedSupervisor":"HELD","forkApis":"HELD"}
```

Installed-supervisor and fork evidence remain **HELD**. No feature flags or
reviewerApproval were set. No source/docs edits, commits, pushes, or PR
changes; final worktree status is clean.
