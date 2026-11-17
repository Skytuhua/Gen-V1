# C3 Windows workflow and ingestion review

## Disposition

No material static defect found in the sealed private workflow or ingestion adaptation. This is a read-only source review. It does not establish a Windows, Edge, PowerShell, native Hermes, installed-desktop or CI execution result. No test or browser jobs were run by this reviewer, and no active repository source, tests, plans, documentation or index entries were changed during this review.

The full workflow, its complete diff, the full ingestion helper, its exact diff, the fixture source and the retained synthetic fixture report were read. Both supplied diffs were independently recomputed and matched exactly. The existing recorder, browser runner, setup action, ordinary CI, package scripts and each selected browser configuration were inspected.

## Reviewed identities

| Private file | SHA-256 |
| --- | --- |
| m15-evidence.push-draft.yml | 2f760bcf58d23c4923395687b8bc7891d75285282d6df04ef2db5a3cb254e4a0 |
| m15-evidence.push-draft.yml.diff | 2bd665bb51fafa4d773e9b78c91f10e8d3b2d588b214cc6959b250dce1eb98f4 |
| ingest-ci-artifact.py | 971bc3ce8cfde7c44d9176c61d6b0a2a9b20a085cb7b2c0d48fc7d0f4a8ae18f |
| ingest-ci-artifact.py.diff | 34205f911a2a15d92377d32ea153753ab8d594e517678ab33b21e9b2f559b8aa |
| test-ci-ingestion.py | e0789d260c064791daf943cc9bc67667319a13459c95ffca0f38d9452d4e0ef3 |
| ci-ingestion-self-test-01.json | c6336f686d2f88ecc0a5aaeb23374669228e5a3cf30a55009f6fe36eca887e2f |

The companion JSON records the exact supporting source hashes. Ordinary `.github/workflows/ci.yml` is byte-identical at accepted138, accepted49 and the reviewed working source: `4ac906f2a1b060b47971267bab60f0b2b66fed846f3b71f9eabafc7cdc66dca2`. The setup action and browser runner are also identical at those revisions. The candidate publication and actual run identity remain future inputs.

## Source and target binding

The workflow is triggered only by pushes to `agent/m15-v3`. Every job independently checks the event/ref and checks out `github.sha`. It measures and asserts Git HEAD, records the tree, run ID, attempt, Windows runner, reviewed base and lock digest before toolchain setup. The browser job now captures this early record before Edge preflight, so a preflight or setup failure can retain source identity.

The native job installs the existing pinned Python/Playwright toolchain and builds runtime assets and the credential helper before its declared test selection. The actual Windows-only host and Hermes cases keep their platform guards. Their inclusion is not evidence that they have executed successfully.

The browser job requires installed Edge. Scoped conversations, shared overlays, shared controls, usage/context and both agents paths use configurations with `channel: 'msedge'`; absence of the requested browser cannot silently select Chromium. Workbench, production App workbench, saved drafts, chat layout, root and artifact acknowledgment use bundled Chromium. The preflight path/version describes an installed Edge executable, not a recorded browser process launch. This workflow must not be described as every suite running in Edge or as installed-desktop testing.

The root comparison separately checks out accepted49, `49cd633273a3f61c14a4191a9877e99ab23ec88f`, and measures/asserts that HEAD. Its tree is `2ecdb4c95fc6b604159257a125064ad585b966e5`. It installs that checkout's locked dependencies, builds that checkout and runs its root suite from that checkout. The candidate recorder is copied to RUNNER_TEMP because accepted49 has no recorder; its dependency-free implementation retains the baseline working directory, so the receipt and log are written beneath baseline and remain separate from candidate output.

## Windows launchers and failures

Every native/browser recorder child is `(Get-Command node).Source`, followed by a real JavaScript CLI path or `--import tsx scripts/test-browser.ts`. Neither pnpm.cmd nor a tsx shim is passed directly to the recorder's `shell: false` spawn. The pinned Vitest and Playwright CLI paths exist in the local dependency tree. The browser runner itself starts Playwright with `process.execPath`, retains output per suite and returns a nonzero status for failed or interrupted child execution.

Each full-suite shard uses absolute `pwsh.exe` as the recorder child. Its single `-Command` argument contains the unchanged canonical package command with `--maxWorkers=2 --shard=N/4` plus default/JSON reporters and a retained JSON output path. The here-string does not interpolate PowerShell variables prematurely. The child script explicitly exits `$LASTEXITCODE`; the recorder records that exit and propagates failure. The package test script still runs credential-helper build, widget build and unfiltered `vitest run`. There are no test-file or test-name filters, no test exclusion added by this workflow and no continue-on-error. Matrix fail-fast is false. Each job builds before testing within its own runner, avoiding the shared dist/web build/test overlap diagnosed in C2.

Browser suite steps use explicit setup/build-success conditions with `!cancelled()`, so an earlier suite failure does not falsely skip later independent suites. Candidate root execution is independently conditioned on its build success even if the baseline suite fails. The baseline checkout/build still have default success gating after candidate build; a failed candidate build therefore prevents baseline execution. That remains an explicit incomplete-comparison limit rather than evidence of a passing baseline.

## Artifact and ingestion contract

All job artifacts include exact candidate HEAD, run ID and attempt in their names. Full-shard names also include the shard number and total. Every command receipt uses a unique c3 Windows ID with run/attempt. Upload uses always(), preserves existing results and bounded logs, and errors on no files. Root output includes both candidate/baseline trees and the two explicit root screenshot paths. Browser output includes the runner's per-suite traces/screenshots/JSON and actual-App agents/artifact output. The full matrix retains source/runtime records, command receipt/log and full Vitest JSON for each shard. Abrupt cancellation or timeout can still leave a missing receipt; no source code here claims otherwise.

The ingestion helper requires a completed push run on the exact branch/head, matching repository/workflow, exact artifact name/run/attempt, and one exact completed job from that attempt. It checks both early checkout and runtime source records against the supplied head/tree. Baseline validation requires accepted49 and its exact tree. Missing source, receipt or full-result records remain explicitly incomplete.

Each full-shard receipt must contain the expected pwsh executable basename, exact flags and exact unfiltered command string for shard 1 through 4. Its JSON result shape matches the installed Vitest 4 reporter's retained results. Counts and reported test-file names are retained as reported; nested describe-suite totals are not relabeled as file counts. The helper does not award full-suite PASS or combine incomplete shards into a pass.

The ZIP safety and byte-preservation implementation is unchanged from the sealed C2 helper. It validates all entries before extracting, rejects traversal/absolute/drive/backslash paths, links, special files, collisions and reserved names, bounds archive/member/expanded size and compression ratio, verifies copied archive metadata/digest when available, and records exact extracted SHA-256/Git blob identities. Raw GitHub metadata and the original ZIP bytes are retained. Receipt/log headers, digests, attempt paths, exit/status relations and timing are checked. A failed job, failed command or missing record remains visible beneath BYTES_VERIFIED ingestion; that status describes retained bytes only.

The synthetic fixture report was read and its helper hash independently confirmed. Its PASS describes generated offline ZIP fixtures. This reviewer did not rerun it. No real upload/download/connector transfer or actual Windows execution was available for review.
