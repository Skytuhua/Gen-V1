# FIFO handoff proposal

Production scope is one wrapper in `apps/web/src/workbench-recovery.ts`. The strict validator body is unchanged. Queue by `threadId`, capture a parsed full logical owner on every invocation, await the prior operation only for ordering, and invoke a new validator for each queued call. The rejected result of an earlier call remains visible to that caller. An identity check prevents an earlier completion from removing a newer queued operation.

The queue prevents duplicate validation reads from keeping each other pending. It does not establish a permanent ready state. A source operation, pending hydration, retained source or uncertain send appearing before a later invocation's validation is drained and checked by that invocation. Global recovery preprocessing barriers and original owner parsing, cold-recovery conditions, source failure handling, flush, conflict retention and read fences remain in the original loop.

The initial two empty-source regressions are observed red under the unchanged product. The additional four queued-call boundaries are sealed in `queued-validation-tests-v2.patch`; version 1 remains preserved and unexecuted. Production remains proposed until root applies the exact patch and records the normal gate. No timeout, fake native service, source text owner or journal transaction change is included.
