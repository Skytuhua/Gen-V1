# Personal account regression verification — 2026-11-02

The three frozen failures have been investigated. One expectation assumed an obsolete synthetic child identifier. The parent corrected the native directory guard and strengthened Stop so its successful response confirms native cancellation while logical run authority is revoked immediately.

## Findings and changes

| Frozen failure | Cause | Result and proof |
| --- | --- | --- |
| `account-parity.test.ts`: delegated session prefix | `PlanningCoordinator` now creates a persisted UUID child thread instead of a synthetic `${parent}:agent:` identifier. The thread records its parent and job explicitly. | Replaced the incidental string-prefix check with persisted `kind: delegate`, `parentThreadId`, account/model inheritance, distinct child identity, returned job/child identity, and completed child state. Existing checks still prove the future default never receives the run and the parent remains active. |
| `account-profile.test.ts`: missing writable directory resolves | Native `Acquire` skipped a missing final nonleaf component, permitting entry without holding the requested directory. | The original rejection expectation remains unchanged. Added rejection checks for missing and file-valued writable directories when the ancestor scope is implicit. The parent owns the native guard correction; this worker did not edit guard source. |
| `accounts.test.ts`: provider mismatch receives teardown busy | Previously, `run.stop` returned before asynchronous native cancellation finished, so a caller awaiting Stop could still receive teardown busy on its next resume. | The parent makes Stop await actual cancellation after immediate epoch revocation. Gated checks prove the stop promise remains pending, the logical thread is stopped, account leases and resume admission remain held, and no discovery/start occurs while cancellation is pending. After release and awaiting Stop, the original provider-mismatch rejection is immediate and the account/model pin is unchanged. Failed cancellation must reject Stop and retain the account lease and admission hold until confirmed cleanup. |

The relevant current contracts are `packages/core/planning.ts` (`childThreadId` and persisted delegate creation), `packages/core/service.ts` (`cancelRun`, `assertNoOtherRun`, `resume`, and `binding`), and `packages/core/windows-path-guard.ps1` (`Acquire`).

## Red and green evidence

Frozen baseline: `test-results/company-full-unit-20261102.json` contains all three failures named above.

Before worker edits, this command exited 1 with **34 passed, 2 failed**:

```powershell
pnpm exec vitest run tests/account-parity.test.ts tests/account-profile.test.ts tests/accounts.test.ts --maxWorkers 1 --reporter=json --outputFile=test-results/account-regression-red-20261102.json
```

The remaining failures were the session-prefix assumption and the teardown/provider-check ordering. The profile case was already green because the parent corrected the guard during this shared-workspace run; the frozen full-run receipt preserves its original red result.

The initial test changes passed **37/37** before the parent's stronger Stop response contract:

```powershell
pnpm exec vitest run tests/account-parity.test.ts tests/account-profile.test.ts tests/accounts.test.ts --maxWorkers 1 --reporter=json --outputFile=test-results/account-regression-green-20261102.json
```

The stronger Stop contract made three old test flows invalid: two awaited their intentionally gated Stop before releasing the gate, and one expected a failed native cancel to resolve. Their targeted pre-adaptation red run exited 1 with **3 failed, 13 skipped**:

```powershell
pnpm exec vitest run tests/accounts.test.ts -t 'keeps a thread account immutable|retains account use after Stop|keeps failed cancellation' --maxWorkers 1 --reporter=json --outputFile=test-results/account-stop-contract-red-20261102.json
```

The adapted tests start Stop without awaiting it, inspect logical stopped state and retained holds during the gate, then release and await successful Stop. Failed native cancellation instead requires a rejected Stop and preserved holds.

Final verification against the parent's completed guard and Stop changes exited 0 with **37 passed, 0 failed** (11 parity, 10 profile, 16 accounts):

```powershell
pnpm exec vitest run tests/account-parity.test.ts tests/account-profile.test.ts tests/accounts.test.ts --maxWorkers 1 --reporter=json --outputFile=test-results/account-stop-contract-green-20261102.json
```

`git diff --check -- tests/account-parity.test.ts tests/account-profile.test.ts tests/accounts.test.ts` exited 0 after the final test edits.

## Scope and remaining checks

This worker changed only:

- `tests/account-parity.test.ts`
- `tests/account-profile.test.ts`
- `tests/accounts.test.ts`
- `account-regression-report.md`

Generated receipts are the account regression and account Stop contract JSON files under `test-results`.

The parent narrowed the native guard correction to `(!leaf && allowChildWrites)`, preserving absent ordinary write destinations while requiring writable directory namespaces to exist. This worker did not modify guard or Service source. The account check alone does not establish general file-write compatibility.

The parent must independently review these changes. No full suite, install, build, live provider authentication, native model request, or desktop acceptance was run by this worker. Existing synthetic account routing checks acquire real Windows directory guards; they do not prove provider authentication or native session behavior.
