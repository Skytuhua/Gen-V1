# Employee information send and inbox

This isolated client consumes the additive existing-v1 employee-information boundary
at CONTROL `ea63ac3dbb668ff5c41e0d62c7fbfcbfbb7b0520`. Descriptor SHA-256:
`76e55347379d8adc9d4d17cb2f334c2636313eb1255c06bac31567ca14da2bd5`.
Runtime schema SHA-256:
`a0a90267037bdfa3a1a098a3a953be3374313a75ef4a902410dd3bdb5932082f`.
Old command, owner, history and stream modules and their original pins stay unchanged.
The C01 parser's `executable:false` still means validation grants no execution authority.

`EmployeeInformationClient` requires an exact loopback HTTPS origin, copied CA trust,
`role:'employee'` and its own protected employee credential callback. It has no owner
credential fallback and is not wired into a UI, CLI, employee engine or remote gateway.
It exposes only `send(expected, rawCommand, signal?)` and
`inbox(expected, limit?, signal?)`. Each explicit call makes at most one request.

Expected contexts are independently retained before credential lookup: company/project
and each relevant peer's stable principal, employee, machine, generation, task, attempt
and work-order IDs. Inbox context includes its recipient; send context includes both
sender and recipient. Task/attempt identifiers are existing opaque strict UTF-8 strings,
not assumed UUIDs. Generations are exact positive integers. Returned Actors are descriptive
records, never credentials or authorization. Their full input/binding/playbook/lease fields
are checked for internal consistency; no missing trusted metadata is invented.

Send retains and validates the complete original C01 `message.send` envelope, restricted
to one information-only project note for one other employee. It rejects observers,
artifacts, replies and response/action requests. Its 202 receipt must match the retained
command ID, action, scope and argument digest. That digest excludes only `command_id`.
The service remains responsible for current registry/Store/admission/assignment/lease
checks and atomic information acceptance. A receipt does not prove task execution,
delivery consumption, an ACK, a wake or inference.

Inbox reads are nonconsuming and have no cursor or snapshot. The default limit 20 is
resolved independently; a response echo cannot change it. Each item retains and validates
its full historical Conversation revision, Message, Delivery, Event and Receipt, with all
typed references, digests, correlations, actor snapshots and times. Accepted recipient
binding must equal current page recipient except for lease renewal; expiry remains the
original fixed minimum of both accepted leases and acceptance plus 900000 milliseconds.
Items are distinct and descend by recipient inbox sequence; expired rows and separate
rooms can create gaps. No global contiguity is inferred. Historical revisions are not
collapsed into a current-head reference. Reconstructed discovered commands prove internal
consistency only, not independently retained original-send provenance.

Commands remain bounded to 32768 raw UTF-8 bytes, summary 1024 and body 8192 UTF-8 bytes.
Complete raw and canonical responses are bounded to 262144 bytes, including all escaping,
records, actor context and digests. Actor opaque IDs have a separate 128-byte UTF-8 cap.
The client uses fixed headers/routes, TLS 1.2 or newer with hostname verification, one
overall validation/credential/request deadline, bounded reads and sanitized closed errors.
It does not follow redirects, retry, mint replacement IDs, poll or select another provider.
After an uncertain send, retain its exact pending envelope; any same-ID recovery is an
explicit caller action checked again by the service.

The disposable conformance recipe creates synthetic E10/E11 authority in a temporary
Store and uses public test-only TLS/credential material. It does not read/copy an operator
DB, admit real employees or run a model. Physical Store/listener reopen is not a producer
process restart. Generation advancement requires independently supplied current task/attempt
metadata; a returned inbox Actor is not used as its own expected authority.
Fixture-only checkpoint `5da24ef65e95554c433c5c81f662b38028be5d55` supplies generation2
task/attempt IDs directly from its actual Store claim via host-control metadata. The
canonical service/schema pin remains ea63. The known company example configuration
CRLF/LF difference is recorded separately; raw runtime inputs are not all Git-blob equal.

Use `tools/company/capture-command.mjs` for an authorized finite check so runner exit is
flushed before optional metadata and collector status stays separate. Historical failed
wrapper evidence and its unavailable pnpm exit remain untouched. Local synthetic contract/
TLS proof does not complete C01/C02/C03/COM-01, native auth/accounting, the cloud pilot or
all 221 requirements. No package/installer or activation follows from this module alone.
