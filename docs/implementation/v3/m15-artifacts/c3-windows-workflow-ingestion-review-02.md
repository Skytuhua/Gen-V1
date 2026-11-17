# C3 v2 Windows workflow and ingestion: independent review 02

## Disposition

No material defect was found in the reviewed v2 delta. The change adds the omitted workspace, saved-layout, usage App and desktop-surface browser suites, then runs both guarded split-browser files with explicit activation and Edge selection. Existing native, root-comparison and full-shard jobs remain unchanged. This is a source review, not target-platform execution or a publication approval.

The sealed v1 review remains unchanged. This review applies to the frozen private proposal under `m15-publication/c3/v2/` at these identities:

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| `m15-evidence.push-draft.yml` | 27719 | `b44f440617d959f913c8238bf88cd5c7bcc7fd93e2ee845a387f03d02560cd58` |
| `ingest-ci-artifact.py` | 27299 | `1d2616a45c097afe53a46c78536972917683df23e20b9b30a1042afcd45c2ca8` |
| `test-ci-ingestion.py` | 21705 | `8791b6412bcdf535ee1bafadd8b2f940e937c74946683057fcd4a03e4a4458ff` |
| `split-browser-command.ps1` | 1440 | `17b457019a222eb6282360e8de57ac0e70040836a0785995f95f4e33ed70e7b8` |
| `ci-ingestion-self-test-01.json` | 1861 | `262e4bad01605687b69fb6d2ea61e53e99514869bedad9ba227069e42e47b549` |
| `proposal-validation-01.json` | 4444 | `296f664b31813bfc4687a90d996f1b6a43e0e40f6eff6b324e867a09943dea3a` |
| `README.md` | 6216 | `dee51dddbd17705e9577d4461d7274a118a3c8114891fecf84648fdb3010802f` |
| `v1-seal.json` | 487 | `4112d3f1bb4f48ca3a115777f0fc9969203f79fd7e662ab5269b530610c8d558` |

The companion JSON records exact relevant repository source hashes and the static comparison results. No product file, repository index, workflow, test, or existing review artifact was edited by this reviewer.

## Coverage and execution boundaries

| Added command | Selected scope | Declared browser and boundary |
| --- | --- | --- |
| workspace-host | Complete registered workspace-host spec | Installed Edge; 20-second existing test timeout |
| saved-layout-chooser | Complete registered saved-layout spec | Installed Edge; 15-second existing test timeout |
| usage-app-integration | Usage App, shell-error-ownership and mobile-navigation together | Installed Edge; 15-second existing test timeout |
| desktop-surfaces | Complete registered desktop-surfaces spec | Bundled Chromium and scripted desktop bridge; 30-second existing test timeout |
| split-browser | Both split-workspace-renderer and split-app-browser Vitest files, one worker, no case filter | Explicit supported `GEN_TEST_BROWSER_CHANNEL=msedge`; both `GEN_SPLIT_RENDERER_BROWSER` and `GEN_SPLIT_APP_BROWSER` set to `1` |

The four registered Playwright additions use the existing suite runner, which resolves the Playwright JavaScript CLI and launches it with `process.execPath`. Its registry includes all three usage App specs; shell-error ownership is not omitted. The split-App test's existing Vite child also uses `process.execPath` and the Vite JavaScript CLI. The browser job already installs the pinned Chromium runtime and checks the actual Edge executable before its suites. The desktop-surface label correctly avoids claiming Edge or installed desktop execution.

All sixteen browser receipt labels in the workflow exactly match the ingestion contract. Parsed YAML confirms that all eighteen prior browser steps are unchanged, only five steps were added, and the job's other properties remain unchanged. The native, root-browser and four-shard job definitions and the workflow event/permission/concurrency definitions are unchanged. The ordinary `ci.yml` remains byte-identical to accepted49 at SHA-256 `4ac906f2a1b060b47971267bab60f0b2b66fed846f3b71f9eabafc7cdc66dca2`.

The unchanged four-shard job still invokes the unfiltered canonical `pnpm test` command, including its credential-lease and widget presteps. The new explicit browser command supplies the split flags separately. An unfiltered full-suite invocation is not a claim that every conditionally guarded body runs inside those four shards.

## Windows command and failure semantics

Each new Playwright recorder invocation passes the absolute executable returned by `(Get-Command node).Source`, followed by `--import tsx scripts/test-browser.ts --suite <name>`. The split recorder invocation passes the absolute PowerShell executable, with `-NoLogo -NoProfile -NonInteractive -Command` and one complete here-string argument. That child sets both flags and the Edge override, resolves absolute Node, records its source/runtime context, launches the existing Vitest JavaScript entry, then exits with `$LASTEXITCODE`. No new shell-free spawn targets a `.cmd` file.

The parsed YAML here-string, private PS1 source and ingestion command constant are identical after removal of the terminal newline. Their command-text SHA-256 is `414c2ae36cef9e596709ffb3e137502f55760c237964b7c22ff5ad2b4a8a84b7`. The ingester permits CRLF normalization while retaining exact flag values, selected files, worker count, reporting and exit propagation.

Each added test step uses the existing explicit condition requiring successful setup/build and a noncancelled job. Earlier test failure therefore does not suppress an otherwise eligible later suite. There is no added continue-on-error or success relabeling. Build remains before browser/test consumers, avoiding the earlier shared-output build overlap.

The approved browser job budget remains 45 minutes for sixteen sequential test commands. Static inspection does not establish Windows runtime sufficiency. Failure-heavy execution or hard cancellation can omit later commands, results or the upload itself. That is an explicit completion limit; it is not proof that all suites finish. Original suite deadlines and assertions remain unchanged.

## Source identity and retained artifacts

The inherited push-only checkout contract uses exact `github.sha`, records checkout and runtime head/tree/run/attempt, and retains accepted49 separately. The root comparison still measures accepted49 and uses the external candidate recorder from the baseline working directory. Native Windows guards, accepted-base separation, unfiltered four-shard commands and all-attempt artifact naming remain as reviewed in v1.

The new split child additionally checks measured HEAD against `GITHUB_SHA` and records the exact tree, event, branch, run/attempt, Windows runner, Node path/version, Edge path/version, actual activation flags, selected files and one-worker setting before invoking Vitest.

Registered browser output remains under `test-results/browser/run-<timestamp>-<UUID>/<suite>/`, including JSON and failure artifacts. New split metadata and JSON results are under `test-results/m15/`. The existing upload includes both trees and the recorder's `docs/implementation/v3/m15-logs/c3-windows-*` receipts/logs. Artifact names still bind the exact candidate head, workflow run and attempt. A hard timeout can prevent completion or upload; missing evidence remains missing.

## Ingestion and verification limits

The added ingestion checks require all sixteen browser receipts. The four named-suite argument vectors must select the full intended registered suite. The split receipt must contain the exact recorded PowerShell command. Its extra source record must match exact candidate head/tree/run/attempt/event/branch/Windows identity, both enabled flags, the Edge override, both selected test files, and worker count. Its result must identify both files. Missing files/results, empty assertions, skipped or todo bodies remain INCOMPLETE. A retained failing result can be PRESENT without being successful; no ingestion status grants a test PASS.

The source diff and AST comparison show that ZIP path normalization/extraction, byte preservation, metadata validation, full-shard command validation and root-baseline validation are unchanged. The synthetic offline report retains failure, omission, altered-command/channel/flag, CRLF, missing-result and skipped-body checks alongside the previous ZIP/provenance cases. Its PASS is limited to those synthetic fixtures and was not rerun by this reviewer.

No PowerShell, Windows, Edge, installed-desktop, real artifact download, connector transfer, or end-to-end CI ingestion was executed for this review. The final repository application, exact pushed source/tree, target execution and artifact ingestion remain distinct required observations.
