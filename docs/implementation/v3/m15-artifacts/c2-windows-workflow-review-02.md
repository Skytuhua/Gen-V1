# C2 Windows workflow amendment review

This read-only amendment review preserves `c2-windows-workflow-review.md` and its original reviewed workflow hash. The current workflow adds target-browser coverage for the shared Popover change required by the UI policy repair.

Current `.github/workflows/m15-evidence.yml` SHA-256: `dfc1581e089e05659338d3f4bdb1f22215ccd2deb5005eaf11c0a5f26deb0748`.

Current Git blob identity: `477c72a3a02f38b879104dedb70a2dc6855ffe26`.

## Exact amendment

Two independent steps were added to the exact-PR-head browser job:

| Suite | Receipt ID prefix | Declared browser |
| --- | --- | --- |
| `ui-shell-overlays` | `c2-windows-ui-shell-overlays` | Installed Microsoft Edge (`channel: 'msedge'`) |
| `ui-shell-controls` | `c2-windows-ui-shell-controls` | Installed Microsoft Edge (`channel: 'msedge'`) |

Both names exist in `scripts/browser-suites.ts`; their dedicated Playwright configurations select the corresponding specs. Their local web-server ports are distinct, and each runs with one worker and failure traces retained.

Removing exactly those two step blocks from the current file reproduces the original reviewed SHA-256 `2af146f08c79dac96ecb29cd870fe60cf1c1f0ec5061308ee371ed761484980a` byte for byte. The prior checkout, source assertions, baseline, other tests, and upload definitions are unchanged.

Both additions use the already-reviewed recorder with the absolute `(Get-Command node).Source` child executable, followed by `--import tsx scripts/test-browser.ts --suite ...`. Receipt IDs retain run ID and run attempt. Each step uses `!cancelled()` plus successful setup/build prerequisites, so a failed earlier browser suite does not suppress it and its failure does not suppress later independently gated suites. The runner's absolute JSON and failure-artifact output paths remain under the uploaded `test-results/browser` tree; recorder JSON/logs retain their existing upload path. Exit propagation remains the same as in review 01.

No additional concrete workflow defect was found in this amendment. This review did not execute either suite or establish an Edge/Windows pass. The original candidate-build/baseline dependency limitation and target-execution requirements remain unchanged. The pre-UI full-repository result belongs to its preserved earlier source cut, not this amended workflow and UI implementation.
