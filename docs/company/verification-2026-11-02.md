# Read-only company integration verification

Local, uncommitted development checkpoint. All 221 requirement assessments remain unassessed/disabled. This is not live-company acceptance.

- Full unit suite: **1139 passed, 1 explicit skip, zero failures**, using two workers.
- Actual Python LocalServer conformance: **1 passed**, using only a task-owned temporary synthetic database and fingerprint registry. Alpha-only authorization and unchanged full database dump digest were verified.
- Browser fixtures: **4 passed**, including local notes, selection, refresh/reload, failure state, inert source text and narrow layouts.
- TypeScript, application build and catalog integrity checks passed.
- Independent code/security findings were fixed through observed RED/GREEN cases; final fixture/decoded-response review found no further issues.

The default highly parallel unit run failed with broad timeouts. A four-worker run retained one auth-start timeout; that test passed alone, and the entire final two-worker run passed without extending timeouts. Earlier failures remain in the JSON receipt.

Pinned backend checkpoint: bcb9ee7c6196243b2647e917a1ccb7b1d0793770. Request/auth baseline:770b56620a6a8587a8c9e8e321e8c731cbb35807. Manifest SHA-256:80fcc2f4cddafaeb7811eb3d195f908ff974f06e79e3ca79d680188e4b1aad4c. Exact manifest and three request/auth source hashes match committed backend blobs. These are file pins, not runtime negotiation.

No E01 cutover, real credential, employee task, native model request, cloud activation, PR publication, merge or deployment was performed. Status and conditional inert previews are the only service operations exposed by the isolated owner host. Export downloads, stateful review and all mutations stay unavailable.

Two failed-fixture temporary folders remain because automatic approval review rejected removal with the reason 'blocked by policy'. Native child results remain visible because T3 task metadata could not satisfy the required archive gate. Exact paths, commands, file hashes and proof limits are in [the JSON receipt](verification-2026-11-02.json).
