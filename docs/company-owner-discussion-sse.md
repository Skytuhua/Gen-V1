# Explicit owner discussion SSE

The isolated `OwnerDiscussionSSEClient` adds explicit streaming to the frozen
snapshot/catch-up client. Its descriptor is pinned to CONTROL
`3c2ec7acf393f86a59a4c70aaec672fb8bc34d80`, raw SHA-256
`2e2460b26be8463b671296590c2963bd68387a55ac133ab985b189387511b7c1`.
It reuses the existing EventPage/Error schemas and record/event authority unchanged.
The copied descriptor is a conformance fixture, not a runtime JSON import. No new
packaged schema asset, UI, CLI, engine or gateway registration is added.

Construct the client with an exact `https://127.0.0.1:port` origin, copied CA trust,
trusted-owner credential callback and optional `timeoutMs` (default 3000, max 10000).
That deadline covers credentials and response establishment/errors. After valid SSE
headers, the connection lifetime is controlled by the caller's required AbortSignal;
the default 15-second keepalive is not mistaken for a failed 3-second JSON read.

First obtain a complete baseline through the existing JSON snapshot client. Then
call `open(context, changesState, {signal})` and consume its async iterator. `open`
captures the independently permitted context, fixed limit and state synchronously;
the first `next()` explicitly begins network I/O. It makes one fixed GET using the
issued cursor in the query and the bearer only in its header. It does not accept raw
URLs, headers, query overrides, alternate providers or insecure TLS options.

The iterator yields either a connected/keepalive comment or a changes result with
exact complete `rawFrame` bytes. Comments have no cursor, domain event or progress.
Keep the last yielded changes `result.state`, whose page has passed the unchanged
full validator and pure projection. No id line, incomplete UTF-8 sequence or partial
frame advances it. A stricter 65536-byte whole-frame cap includes the id and framing;
the existing 262144-byte JSON and 32768-byte command caps remain unchanged. Input is
parsed incrementally, one frame at a time, with strict UTF-8 and exact LF grammar.
Unknown fields, retry directives, multiline data and CRLF are rejected for this
closed protocol. Backpressure follows sequential async iteration rather than an
application event queue. The parser retains at most 65536 pending frame bytes; Node,
TLS/OS buffers and the caller's growing projection are separate memory costs.

When explicitly replaying an older cursor, supply the separately retained latest
state as `{signal, projection: latestState}`. Each received page is checked against
the transport's original cursor chain, then merged into that latest projection.
An identical stable event identity/revision/content is applied once; conflicts and
gaps reject, and a delayed older response cannot regress the retained projection.
Message text and accepted-command metadata are data and never execute.

Abort the controller to close a pending read or credential wait. Breaking/returning
while suspended at a yielded value destroys and awaits closure of its owned request.
Native iterator `return()` queues behind an already pending `next()`: abort its signal
first, then await return. Return alone is not pending-read cancellation. Ordinary EOF discards the
incomplete tail and returns; the caller may explicitly reopen or use JSON catch-up
from the last fully applied state. There is no reconnect, polling timer or hidden
resnapshot. Do not abandon a pending iterator without aborting its signal.
Local request closure is not an acknowledgement of remote handler release. The finite
fixture uses one labeled cleanup grace and a host-only stats observation before reopening.

Closed HTTP/control errors are sanitized `OwnerDiscussionSSEError` values. A received
`RESYNC_REQUIRED` has `requiresSnapshot:true`; discard the chain and explicitly obtain
a fresh complete snapshot. Never bypass that failure with an old cursor or splice a
new snapshot into the old projection. Current authentication/scope denial withdraws
access. The client neither interprets HMAC claims nor grants authority from cursor
possession or response echoes. Server authorization remains current on every write.

The one finite regular counterpart uses a new synthetic temporary Store, public
fixture-only tokens/certificate and verified CA plus hostname. It retains only its
own isolated evidence and must confirm normal exit, zero stderr, stopped handlers,
removed temporary data and protected Beta/history invariance. Earlier failed producer
proof and missing historical receipts remain separate. This checkpoint does not
establish room UI, remote owner access, employee/native/model/account/cloud activation,
full C07 or completion of all 221 company requirements. Package04 remains historical.
