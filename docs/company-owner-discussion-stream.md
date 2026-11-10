# Owner discussion snapshot and catch-up client

This additive trusted-owner-host client reads a complete discussion baseline and then
accepted **new** messages. It is pinned to CONTROL checkpoint
`10bc0d8d20ba55f95130bdb0724800850cbb0c06` and the raw
`owner-discussion-stream-candidate.1` bundle. The manifest SHA-256 is
`173f068fc1a01ad5e01c8f4a2d035a324ccc66508ee20af5cb612dbf55b6de30`;
the runtime schema is
`677d95b1d5d9ab95d2c479a3476cf9d8e0ad1f83d5bce91fb123d27738efc4ec`.
The producer reported a successful push, followed by an unavailable authenticated remote
reread. Consumer conformance pins local committed bytes; it does not establish remote state.

`OwnerDiscussionStreamClient` is explicitly constructed with an exact IPv4 loopback HTTPS
origin, copied CA trust and a separate owner credential callback. It is not registered in
the CLI, E01 engine, browser, company UI or personal runtime. Existing APIs remain pinned
to their original checkpoints. The service owns records, public event identities, floors,
authorization and cursor issuance.

Call `start(context, limit?)` once to begin an explicit new snapshot. Call
`continueSnapshot(context, result.state)` only while its mode is `snapshot`. The retained
baseline descends through exact historical records to sequence one. Only its validated
terminal state has mode `changes`. Call `changes(context, state)` once per explicit pull.
Each call makes at most one fixed GET; there is no polling, retry, resnapshot or model call.

The context and resolved limit are independently retained before awaiting credentials.
Page echoes and cursor possession grant no authority. Current registry, Store, project and
sole-owner permissions remain server checks on every request. Cursors are opaque echo data.
On a validated 409 or 410 `RESYNC_REQUIRED`, discard the chain and explicitly begin a new
snapshot and projection. A current 401/403 withdraws access. The client does not splice a
new snapshot into old state or attempt to interpret a token's claims.

The baseline cut, coverage floor, persistent stream epoch, dual historical anchors and
watermark event remain fixed. A legacy baseline before the floor has no fabricated events.
An append committed while baseline pages are read belongs either to that cut or to later
catch-up. Catch-up returns ascending events after the retained position through the
response's observed upper position. An idle read is not an event; `caught_up` covers that
observed upper boundary only.

Retain the previous input state when a response may be lost. A repeated old cursor can
overlap and include a new tail. Validate against that old request state, then use
`await projectOwnerDiscussionChanges(latestState, validatedResult)` to merge into the latest
projection. Its `applied` array includes only previously unseen immutable event identities;
conflicting duplicate content and gaps reject. Advance the retained state only after the
whole validated projection succeeds. No command, task, approval or message text executes.

Pure validators enforce closed schemas, strict UTF-8/JSON integers, independent scope and
limit binding, exact historical refs, all nested digests, contiguous ranges and coverage.
The watermark event is reconstructed from its declared anchor and retained historical
record. This proves internal consistency, not independently retained append provenance.
Complete raw and canonical responses are limited to 262144 bytes; complete canonical event
items to 65536 bytes; each page to 50 items. The old 32768-byte command boundary is unchanged.

Caller-owned immutable state retains the full baseline and validated event records so
replayed projections can be checked without a cache, brand registry or database. Memory
and copying therefore grow with the explicit traversal. Discard state when the traversal
is no longer needed. There is no background storage or unbounded automatic fetching.

Focused tests and the opt-in disposable HTTPS conformance test provide local synthetic
evidence only. The fixture uses task-owned temporary Store state and public test credentials,
verifies the supplied CA and hostname, and must stop normally with cleanup confirmed.
Output belongs in a new `.harness-company-evidence` directory. No operator database or
credential is accepted. This does not complete C02/C03/C07, SSE, employee delivery, the
remote owner gateway, room UI, native authentication, cloud deployment or all 221 requirements.
