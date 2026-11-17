# C3 v2 browser receipt and artifact path review

**No material receipt-name or output-path mapping defect found** in the frozen v2 proposal. This is an independent read-only review of the 16 browser receipts and their actual output paths. It complements the host review of command, channel, deadline and ingestion semantics. No workflow, PowerShell, browser or ingestion self-test was executed, and no active repository file changed.

## Frozen inputs

| Input | SHA-256 |
| --- | --- |
| `v2/m15-evidence.push-draft.yml` | `b44f440617d959f913c8238bf88cd5c7bcc7fd93e2ee845a387f03d02560cd58` |
| `v2/ingest-ci-artifact.py` | `1d2616a45c097afe53a46c78536972917683df23e20b9b30a1042afcd45c2ca8` |
| `v2/split-browser-command.ps1` | `17b457019a222eb6282360e8de57ac0e70040836a0785995f95f4e33ed70e7b8` |

The hashes matched before and after inspection. The companion JSON records the inspected runner, registry, recorder, added suite configuration and split-test hashes.

## Receipt and path contract

All 16 receipt labels occur exactly once and in the same order in the workflow recorder calls and `KINDS['browser']['receipts']`: `workbench`, `workbench-app`, `saved-drafts`, `chat-view-modes`, `artifact-acknowledgment`, `scoped-conversation`, `ui-shell-overlays`, `ui-shell-controls`, `usage-context`, `agents-workspace`, `agents-actual-app`, `workspace-host`, `saved-layout-chooser`, `usage-app-integration`, `desktop-surfaces`, and `split-browser`.

| Command group | Actual output contract | Uploaded root |
| --- | --- | --- |
| 13 complete named Playwright suites | `test-results/browser/run-<timestamp>-<UUID>/<suite>/results.json` and `<suite>/artifacts/` | `test-results/browser/` |
| Explicit artifact acknowledgment | `test-results/m15/artifact-acknowledgment/results.json` and `artifacts/` | `test-results/m15/` |
| Explicit actual-App agents | `test-results/m15/agents-actual-app/results.json` and `artifacts/` | `test-results/m15/` |
| Enabled split Vitest files | `test-results/m15/split-browser-source.json` and `split-browser-results.json` | `test-results/m15/` |
| All recorder receipts and logs | `docs/implementation/v3/m15-logs/c3-windows-<label>-<runId>-<attempt>.{json,log}` | Matching `c3-windows-*` glob |

The named-suite runner passes explicit `--output` and `PLAYWRIGHT_JSON_OUTPUT_FILE` values, so the added configurations' fallback directories do not divert their Playwright results. Examined screenshots and the workbench benchmark use the Playwright output directory. The agents evidence spec separately uses the explicit `test-results/m15/agents-candidate` override, which is also uploaded.

Both split source/result paths match in the standalone PowerShell source, embedded workflow command and ingestion constants. The command names both split test files, enables both guarded suites, and explicitly selects supported `msedge`. Neither split Vitest file configures Playwright traces or screenshots. Its planned retained evidence therefore consists of the source record, Vitest JSON and recorder log; upload globs do not create missing trace evidence.

## Limits

The retained 45-minute deadline is an incomplete-evidence boundary, not a measured guarantee that all 16 commands finish. Cancellation can omit later receipts, results or upload. The ingestion contract preserves missing material as incomplete and grants byte custody rather than a test PASS. Actual job, command and JSON outcomes must still be read.

Windows, Edge and PowerShell execution remain pending. `desktop-surfaces` is a scripted browser bridge fixture, not installed-desktop execution. This static review does not change those scope limits.
