# M04 core dependency slice

Base: `fcaa52f7fcdc9f39420118a79f9a8250ba83c563` on isolated branch `agent/m04-core-dependency`.
Reviewed donor: M04 draft PR 326 head `ee2c7ad1d8137a355ae907ef0a340b04c8cb7c38`. The donor remains unchanged. This slice does not claim completion of the original M04 bundle, whose complete prompt is not present in the available repository or related uploads.

## Scope

Reuse the exact reviewed request-context contract and pure compiler, with their behavioral fixtures. Add a host-issued preparation token with a persistent per-thread generation, bound to the exact draft prompt and current owner, account, model, workspace, instruction, source, and grant cut. Tokens survive from preview through send. Claimed tokens cannot be edited or reused. Final metadata receipts are immutable and retained through dispatch. Preparation failure prevents runtime submission.

Expose trusted constructor hooks for another bundle to prepare and finalize supplemental evidence. The hooks receive the actual admitted `StartRun` at finalization. No memory-specific code or model/provider call belongs to this dependency slice. Preserve original native history, existing task notes, M01/M02 authority and all user-owned worktrees.

## Sequence

1. Record source identities and run current M01/M02 contract baselines.
2. Record compiler and request-custody failures before adding implementation.
3. Implement bounded token, generation, claim, finalization, and receipt custody.
4. Integrate Service preparation and exact-token send/dispatch with final binding, source and grant validation.
5. Test changed prompt/owner/model/account/workspace/source/grants, token reuse/expiry, restart generation, cancellation and hook failure, immutable payloads, and exact identity through dispatch.
6. Register files in source inventory, run focused contracts and typecheck, and record scoped evidence. Root independently reviews and owns publication/acceptance.

## Acceptance scope

Only the M04 core request custody dependency is proposed for acceptance. Composer source-pin controls, progressive tool disclosure, oversized result custody, native history caches, native compaction CAS, and M04 live-provider experiments remain outside this slice. The `context.compilerV1` host flag remains default off. No partial draft is represented as a completed M04 bundle.

## Completed local result

Compiler and Service failures were recorded before implementation. The native session/settled queued-token defect was reproduced and repaired. The final focused regression passed 109 tests across nine files; strict TypeScript and the public source import/packaging checks passed. Root independently reviewed the production source and reran 35 custody/compiler cases. The complete scoped report and command ledger are in `docs/implementation/v3/M04-core-dependency.md` and `M04-core-verification.json`. Exact-head remote CI and publication remain with the parent task.
