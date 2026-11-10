# Stop teardown barrier fixes - 2026-11-02

The delegated native teardown barrier, cancellation rejection drain, and side teardown admission findings in `.harness-gen-v1-workspace/review-stop-regressions.md` are addressed. Source and regression tests are frozen for the parent's independent review. This is scoped fixture evidence, not live provider, desktop, installer, or production acceptance.

## Changes

- `packages/core/planning.ts`: the existing `ActiveJob` now retains its factory, cancellation/teardown, and disposal promises. The abort listener, explicit cancel, shutdown, and `runJob` cleanup join the same per-job barrier. Cancellation and disposal each run once; disposal is still drained if cancellation rejects. Failed cleanup retains the active ownership/admission hold and remains observable to later cancel/shutdown calls. No manager or new authority source was introduced.
- Queued factories recheck the original parent authority and signal before invoking a factory or creating the imported runtime. A factory already entered before Stop retains its slot until its late adapter has been cancelled/disposed. That adapter never starts. `runJob` cleanup awaits the job barrier; the barrier does not await `runJob`, avoiding a self-await cycle.
- Coordinator cancellation drains every selected child with `allSettled`; shutdown also drains the running batches before reporting cleanup failures.
- `packages/core/service.ts`, only `cancelRun` and `assertNoOtherRun`: parent and planning cancellation still launch synchronously, with synchronous throws captured as rejections. Both branches are drained before one or multiple failures are reported. Pending/failed side teardowns block the same side thread and count toward the two-side-session limit. Existing exact native-owner contexts, immediate epoch/run revocation, Stop receipt replay, account binding, concurrent Stop All launch, and other workers' Service context edits are preserved.

## Regression coverage

`tests/service-workspace-admission.test.ts` adds real Service tests through the scripted `planningRuntimeFactory` seam for both Stop and Stop All. They gate child cancellation and then disposal, require logical revocation immediately, reject replacement admission during teardown, and require acknowledgment only after both gates release. Separate real delegated cancellation failures plus a gated parent prove errors are reported only after parent cancellation drains and failed admission remains held. The native child receives exactly its retained thread/run/epoch context.

`tests/side-chat.test.ts` adds pending and failed side cancellation tests. The same side cannot resume and a third side cannot consume the retained slot; successful cleanup releases admission. Fixture cleanup is explicitly idempotent and always closes temporary Store/filesystem state, including expected cleanup failures.

`tests/planning.test.ts` strengthens immediate startup cancellation to require no queued factory launch. A separate already-entered factory test preserves and extends the old late-adapter guarantee: abort, cancel and dispose stay pending through factory and disposal gates, share one cancellation/disposal, retain the active slot, and never start the adapter. The account-use gate is created before cancellation is invoked, retaining its original held-lease and eventual-release assertions. No account test file was edited.

## Receipts

RED, before source fixes, exit 1: **21 passed, 6 failed**. The failures reproduce early delegated Stop/Stop All acknowledgment, lost delegated cancellation errors, and pending/failed side replacement admission.

```powershell
pnpm exec vitest run tests/service-workspace-admission.test.ts tests/side-chat.test.ts --maxWorkers=1 --reporter=json --outputFile=test-results/stop-barrier-red-20261102.json
```

An intermediate four-file green receipt contains **51 passed, 0 failed** at `test-results/stop-barrier-green-20261102.json`. An adjacent account check then exposed a microtask-deferral regression in cancellation launch: `test-results/stop-barrier-account-green-20261102.json` preserves **26 passed, 1 failed**, including the unreleased-gate hook failure. The Service fix restored synchronous invocation while retaining `allSettled`; account tests were left unchanged. The earlier implementation attempt remains recorded at `test-results/stop-barrier-green-attempt-20261102.json`.

Final frozen verification, exit 0: **78 passed, 0 failed, success true**.

```powershell
pnpm exec vitest run tests/planning.test.ts tests/planning-service.test.ts tests/service-workspace-admission.test.ts tests/side-chat.test.ts tests/accounts.test.ts tests/account-parity.test.ts --maxWorkers=1 --reporter=json --outputFile=test-results/stop-barrier-final-green-20261102.json
```

| File | Passed |
| --- | ---: |
| planning.test.ts | 20 |
| planning-service.test.ts | 4 |
| service-workspace-admission.test.ts | 12 |
| side-chat.test.ts | 15 |
| accounts.test.ts | 16 |
| account-parity.test.ts | 11 |

`git diff --check -- packages/core/planning.ts packages/core/service.ts tests/planning.test.ts tests/side-chat.test.ts tests/service-workspace-admission.test.ts` exited 0. Git emitted only the repository's LF-to-CRLF notices for the two tracked test files.

## Freeze identities

SHA-256 of the final reviewed inputs. The Service hash includes preserved concurrent changes outside this worker's two methods.

| Path | SHA-256 |
| --- | --- |
| packages/core/planning.ts | DDD0C18E0E85EF2CAAB53DB2FCA32FE6E4C4CCA09453AD0BDDF84E74357914A8 |
| packages/core/service.ts | E4E8A110D80C5EDEF70D295A93C45DD1D6B8BFAFEAF876577B023BEB82553301 |
| tests/planning.test.ts | 088A7ADF9F799B78FBE021471058AFA83DCB520A9C64EDE502F29480D6EB35F0 |
| tests/side-chat.test.ts | 8FC56466CEE2E8117C71FB10FD2FF1AAC13F78772441BAFB0548179AD25B914C |
| tests/service-workspace-admission.test.ts | C210A166FB8F630A8CC23B503323B7BA31AAC49C234DC063B5584C21C3BD3E7A |
| test-results/stop-barrier-red-20261102.json | DF2B897AFF4FC5928FBE43B6E13A0A2AB7F7E2C2E729F677A764530A0368557C |
| test-results/stop-barrier-final-green-20261102.json | 80EAFC27832A4F8EF2ED222C14B7F3D80DCA02BAAFAFC802EF069571839C7C62 |

No full suite, build, dependency change, provider/model call, nested agent, commit, or push was performed. Independent review remains the parent's next gate. The parent owns acknowledgment and recoverable child-thread archival after confirming completed/result_available/no pending child runs using the actual returned task/thread identifiers.
