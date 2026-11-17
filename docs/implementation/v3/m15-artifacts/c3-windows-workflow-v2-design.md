# C3 v2 Windows evidence proposal

This proposal is outside the repository and has not been applied or executed on Windows. It extends the reviewed C3 v1 workflow and ingestion contract. The v1 workflow, helpers, self-test report and independent reviews remain unchanged in the parent directory. Publication transport helpers are unchanged.

## Bounded workflow change

The existing Windows browser job retains its pinned setup, build, 45-minute limit, exact pushed head, source records, run/attempt artifact name and all eleven existing commands. Five new commands run before its existing artifact upload. No suite deadline, assertion, test file, or required case is removed. Each new command remains eligible after an earlier test fails when setup/build succeeded and the job was not cancelled.

| Added command | Complete selection | Browser |
| --- | --- | --- |
| `--suite workspace-host` | Existing workspace-host configuration | Its declared `msedge` channel |
| `--suite saved-layout-chooser` | Existing saved-layout configuration | Its declared `msedge` channel |
| `--suite usage-app-integration` | Usage App, shell-error-ownership and mobile-navigation specs together | Their declared `msedge` channel |
| `--suite desktop-surfaces` | Existing desktop-surfaces configuration | Bundled Chromium, as declared |
| Split browser Vitest command | Both `tests/split-workspace-renderer.test.ts` and `tests/split-app-browser.test.ts`, with one worker and no case filter | Explicit supported `GEN_TEST_BROWSER_CHANNEL=msedge` override |

The split command sets `GEN_SPLIT_RENDERER_BROWSER=1` and `GEN_SPLIT_APP_BROWSER=1` inside its recorded child command. It also records the explicit `msedge` override. This is not the ordinary CI default: without that override the split renderer uses its default Chromium launch, while the actual-App split test defaults to Chrome. The new command uses the Edge executable already checked by the browser job.

`split-browser-command.ps1` is the exact private command source embedded in the YAML and ingestion helper. The recorder launches absolute `pwsh.exe`; that script resolves absolute Node, records head/tree/event/ref/run/attempt, the actual three flag values, Edge identity and both selected test files, then launches the existing Vitest JavaScript entry. It propagates `$LASTEXITCODE`. No `.cmd` file is passed to a shell-free spawn.

The existing Playwright timeouts remain 20 seconds for workspace-host, 15 seconds for saved-layout and usage App, and 30 seconds for desktop-surfaces. Existing Vitest deadlines also remain unchanged. Static source counts are 38 workspace-host, 13 saved-layout, 9 usage App plus 2 shell-error and 1 mobile, 26 desktop, 11 split-renderer and 23 split-App declarations. These are not executed test counts or runtime measurements.

The 45-minute job budget is an explicit limit, not a verified Windows runtime guarantee. Failure-heavy execution can exhaust it. Hard interruption can omit later receipts, JSON results or the artifact itself. Such evidence remains missing or incomplete. Keeping the existing job avoids another setup/build and preserves the requested bounded extension; it does not imply that every failure path completes within the limit.

## Ingestion changes

The browser artifact now requires sixteen receipts. The five new receipt labels are `workspace-host`, `saved-layout-chooser`, `usage-app-integration`, `desktop-surfaces` and `split-browser`. The four named-suite receipt argument vectors must call their complete registered suite through absolute Node. The split receipt must contain the exact recorded PowerShell command, including both activation flags, explicit Edge override, both test files, JSON reporting and exit propagation. Only line-ending normalization is allowed for that script.

The additional source record is `test-results/m15/split-browser-source.json`. Its head/tree/run/attempt/event/ref/Windows identity follows the existing source contract. Its actual flags, selected files and worker count must match the command contract, and its observed Node/Edge identities must be present.

The additional result is `test-results/m15/split-browser-results.json`. It must identify both selected files. Missing files, missing results, empty assertions, or skipped/todo guarded bodies are reported as INCOMPLETE. Failed test results and command/job/run conclusions remain failed. PRESENT means that the required result material is present; it does not prove successful browser execution. `BYTES_VERIFIED` remains byte custody, with no test PASS granted by ingestion.

ZIP validation/extraction, raw byte preservation, bounds, metadata identity, full-shard command validation, accepted-base root comparison and existing artifact naming are unchanged. The manifest identifies the helper revision as `c3-v2`. The CLI is unchanged:

```sh
python /workspace/scratch/1b47eb428672/m15-publication/c3/v2/ingest-ci-artifact.py \
  --zip EXACT_DOWNLOADED_ZIP \
  --run-json RUN_METADATA_JSON \
  --artifact-json ARTIFACT_METADATA_JSON \
  --jobs-json EXACT_ATTEMPT_JOBS_JSON \
  --run-id RUN_ID --attempt RUN_ATTEMPT \
  --head EXACT_PUSHED_HEAD --tree EXACT_TESTED_TREE \
  --kind browser --out NEW_OUTSIDE_REPOSITORY_DIRECTORY
```

## Verification and review boundary

`ci-ingestion-self-test-01.json` records synthetic offline archives only. It covers all sixteen receipts, every newly required receipt omission, disabled flags, wrong channel, filtered split command, wrong named suite, CRLF command text, missing split source/results, skipped bodies and a missing test file. Previous byte/provenance/full-shard/root-baseline/unsafe-ZIP cases remain present.

`proposal-validation-01.json` records static YAML/command equality, unchanged existing jobs/steps and core extraction routines, target configuration identities, and the preserved v1 seals. Neither report is a Windows, PowerShell, Edge, installed-desktop or connector-transfer execution. The desktop-surfaces suite remains a scripted browser bridge fixture.

Apply only after independent review. Ordinary `.github/workflows/ci.yml`, the active M15 workflow, repository sources/index and the five frozen C3 documents were not changed by this proposal.
