# C2 Windows evidence workflow review

Reviewed at 2026-11-16 00:55:34 UTC. This is a read-only review of workflow composition and its local command/configuration dependencies. It does not establish Windows execution or acceptance.

## Reviewed identity

| File | SHA-256 |
| --- | --- |
| `.github/workflows/m15-evidence.yml` | `2af146f08c79dac96ecb29cd870fe60cf1c1f0ec5061308ee371ed761484980a` |
| `scripts/m15-record.mjs` | `971842beaeb9e0f1571afbe68407282603bbfef5b28aaab3df949af58e524cd6` |
| `scripts/test-browser.ts` | `6aba884457c135fc19cec841a3060b76a5c75ac90afbe19ce425fbe0fcada513` |
| `.github/actions/setup/action.yml` | `fe4863de534c4b8c3a61fceab21a9b00f5bcf0a4387fe457d3c544e90fc2d5ab` |

The workflow was an unstaged new file at review time; its Git blob identity is `5129d6cb95a65a26e24b6f56f7abc936b2e82262`. The hash above identifies the reviewed bytes independently of the pending commit. The accepted comparison base is `138b1356495bb3a2c9b35020240513f8faa84964`.

## Findings corrected and rechecked

The direct actual-App agents command previously relied on a relative `outputDir` from a Playwright configuration under `tests/e2e`. Playwright resolves configuration-relative output beneath that directory, outside the uploaded root evidence tree. The final command passes `--output test-results/m15/agents-actual-app/artifacts`; CLI output resolves from the command working directory and is included in the upload.

The agents evidence spec writes `process.env.GITHUB_SHA` into its metrics. A workflow `env` assignment to a reserved default `GITHUB_*` variable did not reliably establish the checked-out source identity. The final PowerShell step sets its child-process `$env:GITHUB_SHA` from `git rev-parse HEAD` before launching the recorder. The job's separate source record also measures and asserts the requested PR head.

The final baseline build additionally measures and asserts the accepted base, retaining its actual HEAD, tree, and lockfile SHA-256 in `test-results/m15/root-baseline-source.json`. Root artifact paths explicitly include both candidate and baseline `docs/evidence/ui-clarity-20261031/stats-dark-confirm.png`. Those paths match the screenshot write in `clarity-data-work.spec.ts` at the accepted base and in the candidate.

## Checked boundaries

- All three jobs check out the requested PR head and assert measured HEAD before their build. The baseline checkout uses the immutable accepted commit and asserts it separately. Native source/runtime, browser source/runtime, and comparison metadata are retained.
- Recorder invocations pass `(Get-Command node).Source` as the child executable. The recorder uses `spawn(..., {shell: false})`, so it executes Node directly instead of attempting a `.cmd` child. The native argument array and direct Playwright arguments preserve distinct CLI arguments; the referenced Vitest and Playwright CLI files exist in the installed dependency layout.
- Setup pins Node 24.22.2 and pnpm 10.30.3, installs locked dependencies, and installs the selected Python/browser prerequisites. Application builds precede the tests; the native job additionally requires the native credential-helper build. The Windows file and real Hermes source tests are explicitly selected.
- The external baseline recorder uses only Node built-ins and derives its working-directory identity from the baseline process. The baseline browser runner and dependencies resolve from that checkout. Its receipt and complete browser outputs are uploaded from the baseline tree separately from the candidate.
- Baseline install and build each check `$LASTEXITCODE` before copying the recorder. The recorder waits for child `close`, writes the command outcome, and preserves nonzero exit status. GitHub's built-in PowerShell wrapper propagates native command exit status. Later browser steps use explicit `!cancelled()` conditions tied to successful prerequisites, so an earlier suite failure does not silently suppress the remaining selected suites. The candidate root step also runs after a baseline test failure.
- Receipt IDs include a distinct operation plus run ID and run attempt. JSON reports, failure artifacts, both root output trees, metrics, and recorder JSON/logs lie beneath the uploaded paths. Uploads use `always()` and report an error if no files are found.
- The existing four-shard CI test job remains separate. The M15 selection does not replace its full regression coverage.

## Disposition and limits

No remaining concrete defect was found in the reviewed workflow composition. No test job, browser session, PowerShell runtime experiment, or Windows execution was performed during this review. Windows native execution, Edge behavior, installed desktop behavior, and actual uploaded artifact contents require their corresponding target-run results.

If the candidate application build fails, the baseline checkout/build is skipped by the workflow's default step-success condition. That run has no baseline comparison and remains failed; it must not be reported as a complete comparison. Cancellation or setup/build failure can likewise prevent dependent evidence from being produced. A recorder command pass on Linux collection with a platform-skipped native case is not a Windows pass.

GitHub semantics were checked against the official [workflow shell documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsshell), [status-check expressions](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#status-check-functions), and [default environment variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables#default-environment-variables). Local Playwright output-directory resolution, reporter paths, suite configuration, recorder exit handling, and screenshot producers were inspected directly.
