# Final M12 unit regression assessment

The after-review candidate has **zero candidate-only failed assertions** against the accepted base. Its full unit command still exits 1 with 269 failed assertions and four recorded unhandled rejections. This comparison records the inherited failure evidence; it does not turn the full command into a passing gate.

| Observation | Total assertions | Passed | Failed | Skipped |
|---|---:|---:|---:|---:|
| Accepted base fcaa52f | 3,355 | 3,036 | 273 | 46 |
| Candidate before packaging fixes | 3,589 | 3,269 | 274 | 46 |
| Candidate after review | 3,591 | 3,276 | 269 | 46 |

## Exact identity comparison

All 269 final failed assertions match failed baseline assertions by exact relative file path and full name. Four baseline failures now pass. The 46 skipped assertions remain skipped; no failing assertion was converted to a skip.

The exact comparison reports 237 added passing names and one removed passing name. One unchanged parameterized test embeds `Date.now() + 60000` in its `%j` title, so its expiry value changes between runs. Both observations passed. The matcher retains this one removed/added identity without normalizing the title. Net additional assertions are 236.

| Baseline failure now passing | Exact full name |
|---|---|
| tests/dev-plugin-runtime.test.ts | prepares widgets and shared runtime before dev children, serves the trusted frame, and closes owned children |
| tests/hermes-service.test.ts | never supplies completed-write custody for unapproved or failed effects |
| tests/project-trust-v3.test.ts | reading an ordinary granted text file still works while execution approval stays distinct |
| tests/service.test.ts | thread and UI integrity a generated operation button leads to native approval and cannot approve by its label |

## Candidate-only failures found and resolved

The first candidate had five failures absent from the baseline failure set. Four were M12 export omissions in `tests/public-source.test.ts`: browser spec coverage, local import closure, staged browser bundling and staged host/worker bundling. The finite manifest now includes 42 explicitly reviewed source paths, of which 17 are runtime sources. These include the JavaScript child worker, all three Python assets, TS host/provider/contracts/read modules, UI/CSS, browser inputs, verification fixtures and the exact tokenizer dependency-review JSON used by the exported benchmark. Unknown source denial, sorted uniqueness, runtime subset and closure checks remain intact. All 13 focused packaging cases pass, and all four originally failing packaging cases pass in the final full run.

The fifth first-run failure was the 1440px plug-in dock case. It reached the existing 60-second test timeout; the baseline passed it in about 1.14 seconds. It passes in the final full run. This agent changed no dock source, and the first JSON stack did not establish a failed geometry assertion.

## Failure-message limits

Of the 269 matching failures, 211 failure messages are identical after replacing only the two worktree roots. Another 58 messages differ further. Seventeen raw first lines differ, including path-specific messages and tests that reached a later failing operation after the ordinary-file read prerequisite was repaired. The report therefore establishes matching failed test observations, not an identical root cause for every failure. Both full original messages are retained in `unit-baseline-comparison.json`.

## Unhandled errors

The final sidecar records four unhandled rejections: the account-login successor-lease test and the GitHub private-write cancellation, replacement and expiry tests. These same four tests timed out around 60 seconds on the accepted base. Current source shows the existing Linux directory guard rejects before each test enters the awaited callback or temporary-write gate. The relevant test, login/auth and guard implementations are unchanged from the accepted base; the existing `withPathGuard` implementation is unchanged.

The baseline JSON reporter omitted unhandled events. The baseline log provides no count, so its unhandled-error count is **unknown**, not zero. The final sidecar is preserved separately as `candidate-vitest-unhandled-after-review.json`.

## Evidence identities

| Artifact | SHA256 |
|---|---|
| Final candidate JSON | `b31e751366e883b1de30047d7964dad420ae2ae4d5e0d482428623a3d06ddcdc` |
| Final comparison JSON | `b0c18596f2bd9db2d3a277db0b7f6958a0a895eda58779d5ba2a2a93ad5b2af2` |
| Final unhandled-error sidecar | `00d4b7ee17a9a433fbd004ae9ebf89c3e3405023e7ee16d61fd67e929cc45416` |
| Comparison before packaging fixes | `8d6c08266ce294bf10760d8c4414ab666326cb1e30ec9891ce9696a44f1f36e7` |
| Structured final assessment | `85e508e67c7c06bb6db7e622210a16c5a12a31a31bdc4bb61c30f726511cf5b7` |

The original candidate JSON, baseline artifacts and comparison before packaging fixes remain unchanged. No source or test was edited after the final full run by this agent.
