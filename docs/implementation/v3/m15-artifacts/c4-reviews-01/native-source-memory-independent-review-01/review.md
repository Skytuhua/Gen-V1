# Combined M05/M15 native fixture review

No material static fixture defect was found. This review launched no tests and changed no repository files. The proposed body remains unexecuted by this reviewer.

Reviewed addition SHA-256: `2a2f0c48186beee784e76ad21044de7cc0592e3009f8dc55c286c7e7d0999725`. Proposed complete test SHA-256: `21a8fc6e282809d51632ba21547a0715ab45acf0ba92a762f6e0cfe2f07eee35`. Existing test SHA-256: `426c80e3f443dffb10dc797c8618155a260dc740daad53d33262bf982de722b5`. The exact delta is two imports and one appended test; the prior native case is unchanged.

## Real execution boundary

Only the native model transport factory/catalog is scripted. No createClient, workerPath, Python command, Store, source guard or history override is supplied. Observing runtime.start/followUp forwards each unchanged input to the bound original method. Source: addition.ts 20-58; runtime-hermes index.ts, client.ts, task-pool.ts.

## Project/account consent

Both seeded threads receive the explicit null account and selected model before project memory is initialized. The physical project root and existing ProjectMemory configure/propose/accept APIs establish the memory scope. Only the source thread is eligible for extraction, so the distinct recipient cannot create a background extraction job through scheduleSettled. Source: addition.ts 10-18; tests/project-memory-fixture.ts; project-memory-host.ts scheduleSettled.

## Effective request-context activation

memory.projectV1 enables production request custody even with context.compilerV1 false and requestContextEnabled:false. The explicit M05 preparation ID is forwarded through the real message.send path. Source: addition.ts 10-13,58,92-105; service.ts requestContextEnabled and prepareProjectMemory.

## Exact source and memory frames

The test captures an actual granted file range, parses the quoted envelope, prepares accepted M05 evidence, and compares the exact dispatched input to real model/history envelopes. Reference segment hashes include the selected-source frame. Memory contentRef hashes the injection without its supplemental header, while injectedBytes includes that header, matching the production contracts. Source: addition.ts 61-81,89-112; source-workbench.ts prepareSend; request-custody.ts framing; project-memory-host.ts sources/view.

## Settlement, replay and persistence

Assertions wait for handled enteredRuntime outbox state, ready thread, source settled event and drained source/review activity before observing history. Both exact command replays must return the original receipt without another model call. The SQLite Store is closed and reopened before checking the exact outbox, capture and command receipts. Source: addition.ts 82-137; Store receipt/all/close and Hermes settlement/history.

## Retained file integrity

The second turn edits the real granted file, observes the old reference as stale, then explicitly retains the capture. Original source rows and grant equality, forbidden fresh/unselected text checks, and two user frames in the persisted Python session bind the retained source bytes. Source: addition.ts 89-93,115-130.

## Limits

Static review is not an executed Windows result. No test, typecheck or native process was launched by this review.

The current test is gated to Windows. Linux collection or skip cannot establish its body or the native guard.

The new test owns a 180000ms deadline; the original 150000ms native test remains unchanged. No latency conclusion follows.

The recipient starts explicitly bound to the null account with a seeded model. First unbound or non-null account admission, queue/race semantics and rollback require separate tests.

The fixture checks capability negotiation and a required memory checkpoint contract, but it does not force compaction or execute a checkpoint round trip.

The accepted memory is seeded through the real review API. The fixture does not prove extraction, consolidation, live-provider access, installed-desktop behavior or a renderer flow.

Usage is checked after accepted dispatch and after reopening. This case alone does not prove absence of pre-acceptance usage accounting.

Review JSON SHA-256: `a44606f96d3d8228fa86c587682d001a37f2c63b56bcdd4c8f7f65f2d199844a`.
