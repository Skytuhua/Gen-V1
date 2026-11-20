# M10 Windows lane — follow-up: pinned prerequisite recovery + packaging rerun

Same verifier thread and worktree as `win-verifier-report.md`
(`t3-thread://v2/17662262-856e-45f7-98fb-56c92cacfa8f/mcp:launch:26d517050bbdc5deb6d809892770f014e64161daca9195c3328ee6ae092b7a20`,
model gpt-6.1-sol, runs 2–3 on 2026-11-18T18:59–19:23Z; run 2 interrupted at a
~95-min silent hang, run 3 reported observed state without retrying).
Instruction: recover `.harness-hermes-python-deps` and the other declared
packaging inputs using ONLY the repository's pinned, hash-verified steps
(`.github/actions/setup/action.yml` python:true + the installed-memory job's
staging steps in `.github/workflows/ci.yml` at ff38c62c), then rerun
`desktop:package` and `verify-installed-desktop.ts`.

Pinned HEAD remained `ff38c62c3b0f8856e08f528f3c2ea8b1c1fea199` (#501/#786
ancestry verified run 1); worktree clean; no commits/pushes/flags.

## Verbatim verifier report (run 3)

| Command / declared step | Exit / outcome | Observed time | Result |
|---|---|---:|---|
| CPython identity probe | 0 | 0.34s | **PASS:** CPython 3.14.3 x64 (`C:\Users\<redacted>\AppData\Local\Python\pythoncore-3.14-64\python.exe`, used as `HARNESS_HERMES_PYTHON`; default `python` is 3.10.11) |
| Hermes `pip --target .harness-hermes-python-deps -r third-party/hermes-agent/runtime-requirements.txt` | 0 | 50.11s | **PASS: 33/33 distributions** |
| Integration-wheel staging via `pwsh -NoProfile` | KILLED before script entry | 135.15s | Shell startup stalled; no wheel directory created |
| Authorized `cmd`-equivalent wheel staging (Python 3.14; same URLs/SHA-256/filename checks/timeouts) | 0 | 14.56s | **PASS: 91/91 archive hashes** |
| Integration `pip --require-hashes` into `.harness-integrations-python-deps` | 0 | 16.40s | **PASS: 91 distributions** |
| Git/gh tool-bundle staging per `third-party/git-tools/manifest.json` | 0 | 6.49s | **PASS:** both archive hashes + 386 file size/hash checks |
| `collectGitTools` check | 0 | 0.76s | **PASS:** 386 files, 147,868,460 bytes |
| `pnpm desktop:package --output-root .harness-installed-package` | **KILLED; no normal completion** | 530.81s to wrapper termination | **UNSUPPORTED_ENV_STALL** |
| `verify-installed-desktop` | **NOT_RUN** | — | No artifacts |
| Run-1 vitest — preserved, not rerun | 0 | prior | **83/83 PASS** |
| Run-1 browser — preserved, not rerun | 0 | prior | **12/12 PASS** |

**Exact failing declared step:** `packaging child powershell.exe stalled
(environment)` — the internal Node-zip `Expand-Archive` invocation inside
`scripts/package-desktop.ts` (`C:\Windows\System32\WindowsPowerShell\v1.0\
powershell.exe`). The spawned child was observed stalled 161.45s with an
empty extraction directory before termination was requested; the wrapper's
recorded forced exit code was 1 (not a normal packaging result) and the
PowerShell process object remained termination-pending at last inspection.
The same powershell-startup stall previously stalled the verifier's own
pwsh/powershell shells on this box — an environment defect, not an M10 or
packaging defect. (Owner-reported wall time of the hung lane was ~95 min;
the instrumented durations above are the verifier's own.)

**Worktree dir facts after staging:**

| Directory | Exists | Regular files |
|---|---|---:|
| `.harness-hermes-python-deps` | Yes | 5,342 |
| `.harness-integrations-python-deps` | Yes | 7,619 |
| `.harness-tool-bundles` | Yes | 386 |
| `.harness-installed-package` | Yes | 92,871 (partial staging only) |

Release directory empty: **no Setup.exe, no `win-unpacked`, no artifact
hashes**. Install / owned launch / CDP identity revalidation / UI
acceptance / uninstall all **NOT_RUN**.

Verifier artifacts on box:
`C:/Users/<redacted>/AppData/Local/Temp/m10-windows-followup-2026-11-18T19-00-28-208Z/`
(observed-followup-results.json, first-failure.txt).

Supervisor/fork remain **HELD**. No feature flags or reviewerApproval set.
