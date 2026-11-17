# C4 5f evidence-plan decision

The attached plan is a frozen historical proposal for source cut `5f0de8a3c62b27685ac6a929f0d4fb0ec7c7d94f88bd9cc1f70ceafe1808e24a`, accepted base `b4aa2caa5a3cedb29a0fddb510e49b5abd802a73`, and incoming parent `eeda4a89879aa1f3baaa04e60dd4a2d9c520761c`. It has not been applied. Existing source, manifest, controller and index remain outside this preparation's mutation scope.

| 5f gate | Observed outcome |
| --- | --- |
| Final host selection | PASS: 404 passed, 2 Windows skips, 28 files |
| Selection completion | PASS: 3 passed |
| Typecheck, build, UI policy | PASS; UI policy 545 sources and zero violations |
| Empty-owner asynchronous handoff | FAIL: both guards started, zero READY, 66 source reads exceeded the 64-read sentinel |
| Full actual-App browser | FAIL: 22 passed, 4 failed |
| Full desktop bridge browser | FAIL: 26 passed, 5 failed |
| Full output browser / controlled renderer | PASS: 21 passed, no skips, flaky cases or report errors |
| C4 Windows native/browser/full/root | NOT_RUN |
| Final packaging/custody/controller | NOT_RUN |

The controller must derive **bundle FAIL** because current required phases failed. Integrity is separate and has not been executed for this proposal. The diagnostic does not establish the cause of every browser failure. Local controlled storage passes and the renderer measurement do not prove production handoff liveness, installed desktop, or Windows execution.

Fourteen explicit phases assign nine existing receipts once each. The controller automatically retains the other 305 actual receipts in `ATTEMPT_HISTORY`, preserving 183 PASS and 122 FAIL command outcomes. Its retention PASS does not relabel those failures. Historical C3 Windows run 43797606300/1 remains failed and bound to its own commit/tree/base49; it supplies no C4 target pass. Flag and reviewer approval remain false.

The measured snapshot has 1,651 changed paths, 86 non-documentation changes, and a public manifest of 3,275 source / 228 runtime entries. 669 changed paths still lack explicit source admission, including `tests/source-handoff-v3.test.ts` and `tests/source-workbench-memory-v3.test.ts`. These are preparation-time counts, not final caps or permission for blanket admission.

`additional-public-admissions.json` explicitly seals only the seven requested later review, fixed-call application and unaccepted-main5f files. The earlier 134-file admission remains immutable. No files are copied by this proposal. Private preparation records and inventories are not proposed for public admission.

A corrected cut must replace current phase membership with its actual new receipts while preserving this snapshot and all failed attempts. Future packaging/custody/evidence IDs are only declarations in the private schedule. Root can edit the next plan directly once receipts exist; no new controller or phase-update helper is needed. Final assembly must refresh after recorder receipts so its index includes them. Latest observed main `5f5276816deacdf896369f608045f993b00f2827` remains unaccepted, and PR390 remains draft and unmerged.
