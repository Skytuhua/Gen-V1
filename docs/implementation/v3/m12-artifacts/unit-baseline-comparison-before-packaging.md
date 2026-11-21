# Accepted-base and candidate unit comparison

This report compares existing JSON observations and launches no tests. Exact identity is relative file path, full test name and duplicate occurrence. The full JSON retains both original failure messages, every status transition and duplicate-name limitations.

Baseline: 3355 assertions, statuses `{"failed": 273, "passed": 3036, "skipped": 46}`.
Candidate: 3589 assertions, statuses `{"failed": 274, "passed": 3269, "skipped": 46}`.

| Classification | Count |
|---|---:|
| inheritedFailingAssertions | 269 |
| candidateOnlyFailures | 5 |
| baseOnlyFailures | 4 |
| candidateAddedAssertions | 235 |
| candidateRemovedAssertions | 1 |
| sharedNotExecuted | 46 |
| candidateNewlyNotExecuted | 0 |
| baselineNotExecutedNowExecutedOrAbsent | 0 |

Matching failed assertions do not by themselves prove an identical root cause. Inherited failure message comparisons: `{"CHANGED": 58, "FIRST_LINES_CHANGED": 17, "FIRST_LINES_EQUAL": 252, "WORKTREE_ROOT_ONLY": 211}`. Only worktree roots are normalized in the labelled secondary comparison.

## Status transitions

| Baseline | Candidate | Assertions |
|---|---|---:|
| ABSENT | passed | 235 |
| failed | failed | 269 |
| failed | passed | 4 |
| passed | ABSENT | 1 |
| passed | failed | 5 |
| passed | passed | 3030 |
| skipped | skipped | 46 |

## Candidate-only failures requiring source diagnosis

| File | Exact test name | Transition | First failure line |
|---|---|---|---|
| tests/plugin-tools-dock.test.ts | keeps tools, diagram controls and readable inspector separate at 1440px, including recovered free placement | passed → failed | Error: STACK_TRACE_ERROR |
| tests/public-source.test.ts | reviewed public source allowlist admits every browser suite spec and configuration with complete spec coverage | passed → failed | AssertionError: expected [Function] to not throw an error but 'Error: Browser spec coverage: missing…' was thrown |
| tests/public-source.test.ts | reviewed public source allowlist admits the local import closure of exported TypeScript and JavaScript inputs | passed → failed | AssertionError: expected [ …(9) ] to deeply equal [] |
| tests/public-source.test.ts | reviewed public source allowlist resolves the staged browser entry using only admitted public sources | passed → failed | Error: Build failed with 1 error: |
| tests/public-source.test.ts | reviewed public source allowlist resolves the staged host and worker entries using only admitted runtime sources | passed → failed | Error: Build failed with 7 errors: |

## Base-only failures

Failures that became skipped or absent are shown separately from failures that now pass.

| File | Exact test name | Transition | First failure line |
|---|---|---|---|
| tests/dev-plugin-runtime.test.ts | prepares widgets and shared runtime before dev children, serves the trusted frame, and closes owned children | failed → passed | AssertionError: expected [ 503, 503 ] to deeply equal [ 200, 200 ] |
| tests/hermes-service.test.ts | never supplies completed-write custody for unapproved or failed effects | failed → passed | HarnessError: File access check failed — the folder could not be opened safely for this action |
| tests/project-trust-v3.test.ts | reading an ordinary granted text file still works while execution approval stays distinct | failed → passed | HarnessError: File access check failed — the folder could not be opened safely for this action |
| tests/service.test.ts | thread and UI integrity a generated operation button leads to native approval and cannot approve by its label | failed → passed | HarnessError: File access check failed — the folder could not be opened safely for this action |

## Unhandled errors

Baseline observation: `UNKNOWN`, count `None`.
Candidate observation: `RECORDED`, count `4`.
Unhandled-error inheritance: `UNDETERMINED`. The installed Vitest JSON reporter omits these errors, so an absent baseline sidecar cannot establish zero.

## Source report identities

Baseline SHA256: `2696989e018fdc7b77e0147df876bdff7f04b51d3995b9b452b74f1c00728cf4`.
Candidate SHA256: `398aa209753139d7ce2e8989bc29b6d7cbf013eb18735acfee43a3d1dcbe840d`.
