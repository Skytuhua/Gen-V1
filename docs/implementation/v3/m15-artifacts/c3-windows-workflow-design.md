# Private C3 Windows evidence design

## Trigger and source identity

The M15 evidence workflow changes from `pull_request` to branch-filtered `push`. Every checkout and measured source record uses the event's exact `${{ github.sha }}`. Its only branch is `agent/m15-v3`, and it retains separate jobs for native contracts, browser contracts, accepted-base root comparison and four full-repository shards. This removes duplicate M15 push/PR executions because M15 has only one trigger.

Ordinary `ci.yml` is unchanged. Its PR jobs continue to test the merge tree when GitHub can create one. Those jobs and the M15 push jobs have distinct source identities and serve distinct checks. The push evidence remains available if main advances again and a PR conflict prevents merge-tree checks. It does not resolve or excuse the conflict with accepted main 49, and does not establish compatibility with a later main commit.

GitHub documents that pull-request workflows do not run while the PR has merge conflicts, and that the ordinary PR SHA identifies its merge result. A branch push is a separate event. No privileged target event, dispatch, secret access, new runner provisioning or account change is needed for this design. The actual push workflow run must still be observed after publication; this private draft is not execution evidence.

Sources: [GitHub workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) and [GitHub workflow trigger troubleshooting](https://docs.github.com/en/enterprise-cloud%40latest/actions/how-tos/troubleshoot-workflows).

## Existing CI setup preserved

The existing ordinary CI test job is a four-way matrix (`1,2,3,4`) with `fail-fast: false`, two Vitest workers per shard, a 30-minute job deadline, `pnpm build`, and `pnpm test --maxWorkers=2 --shard=N/4`. Its test launcher builds the Windows credential helper and widgets before unfiltered Vitest. The private M15 full-repository job uses that same setup and command contract, adding the recorder and JSON output. The matrix is not replaced by the focused native list.

The repository's composite setup already provides:

| Component | Existing setup |
| --- | --- |
| pnpm | Pinned `10.30.3`; frozen-lockfile installation |
| Node | Pinned `24.22.2` |
| Python | Python `3.14`, x64 when requested |
| Hermes dependencies | Requirements in `third-party/hermes-agent/runtime-requirements.txt`, isolated target directory |
| Integration wheels | Validated wheel names, HTTPS wheel source and pinned SHA-256 hashes from `PYTHON_LOCK.json` |
| Worker interpreter | `HARNESS_HERMES_PYTHON` set to the installed Python executable |
| Playwright | Version read from the installed package, browser cache keyed by runner OS/version, pinned Chromium installed |
| Build | Existing web/widgets/plugin-runtime build command |

Native and full jobs request both Python and Playwright. Browser and paired root jobs request Playwright; their current suite selection is unchanged. Edge-specific suites require the installed Edge channel and preserve their existing declarations. The workflow checks and records Edge's executable/version before browser execution. Chromium-only suites remain identified by their configurations.

The M15 runners are pinned to Windows 2022. Ordinary CI's `windows-latest` label stays unchanged. Source records retain runner/image/runtime information so these targets are not conflated.

## Full-repository recorder semantics

The fixed child PowerShell script is:

```powershell
$ErrorActionPreference = 'Stop'
pnpm test --maxWorkers=2 --shard=N/4 --reporter=default --reporter=json --outputFile=test-results/m15/full-results.json
exit $LASTEXITCODE
```

`m15-record.mjs` spawns the resolved `pwsh.exe` directly with `-NoLogo -NoProfile -NonInteractive -Command` and that script as one argument. PowerShell resolves the existing pnpm command. This avoids trying to spawn a `.cmd` shim with Node's `shell:false`, and retains the canonical package test script including its native/widget setup. An external command failure reaches the recorder through the final explicit exit. A command-resolution error terminates because `ErrorActionPreference` is Stop. The C3 ingester checks the exact argument vector and script, so file/name filters, changed workers or a different shard do not count as this full run.

No test or assertion timeout is changed. Tests are not rerun until green. A failed shard retains its failure, other shards continue, and all available artifacts are uploaded with attempt-specific names. A job timeout or early setup failure may leave no receipt or result; ingestion records this as incomplete evidence.

## Evidence layout and acceptance

All seven job instances share the same workflow run and pushed SHA, while retaining distinct artifacts. Each artifact name binds head, run ID and attempt. Root comparison additionally records actual accepted main 49 head/tree/lock values from its separate checkout. Both complete root runs retain independent command results even if one fails.

The pure checkout record is written before dependency setup so setup failure can still be associated with the tested commit. Runtime source records are separate and carry the actually observed Node, pnpm, Python/Playwright/Edge values relevant to the job. Uploads retain source files, JSON results, bounded command logs/receipts and available browser traces.

Full-suite acceptance requires all four shard artifacts from the same run and attempt. Their exact source trees, unfiltered command contracts and complete job/result observations must agree. The focused native suite cannot substitute for a missing full shard. Count summaries preserve failures, skips and unhandled-error evidence; successful byte ingestion never grants a test PASS.

C3 ingestion is a separate copy. Its changes are limited to push identity, accepted main 49/tree, run/attempt artifact names, new checkout records, C3 command IDs, and full-shard source/command/result validation. ZIP path validation and byte preservation are unchanged from C2. Existing PR-only discovery convenience tooling cannot be assumed to return these push runs, so run selection uses the documented general workflow-run GET route.

## Private validation performed

The YAML parsed successfully. Static checks verified trigger/branch, exact source checkout, four shards, always-retained outputs, artifact names against the ingester, and the exact full-shard here-string against its command validator. Existing native/browser commands remain unchanged apart from the C3 receipt prefix, and the accepted root base changes to 49. Independent AST comparison confirms the inherited publication validation and ZIP extraction logic remains unchanged. Synthetic helper checks passed. No PowerShell runner, Windows job, real artifact transfer or publication was exercised by this preparation.
