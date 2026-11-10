# Bounded owner discussion query

The separate trusted-owner-host client discovers the existing owner-only project
discussion without a message ID, command or receipt. It adds no room UI, engine tool,
CLI registration, stream or remote owner session. Current authentication, project
access, sole-owner audience and canonical records remain CONTROL-owned.

The implemented producer checkpoint is
`06dd3273f9238b830fed0a6e65b08eb9f1cc73fa`. Exact additive files are pinned under
[`owner-discussion-thread-candidate.1`](../packages/company-contracts/communications/owner-discussion-thread-candidate.1/manifest.json):

| File | SHA-256 |
| --- | --- |
| manifest.json | `cd386b8a084f2619868219a673be2b718802be95bc90cfca96258e13e5c0f6d8` |
| thread.schema.json | `442ed5428659ce3336639efd89d651bea54bb4db03bec1b0ca285700c8a173b4` |
| examples.json | `6e9ba136bcf3fca5e235201120441b59fc5a983397c6e978f800000e2c872427` |

These pins identify files, not runtime negotiation or activation permission. Existing
notes/history and owner-discussion append/exact-read-back code and contracts are unchanged.

## Fixed client

[`OwnerDiscussionThreadClient`](../packages/company-client/owner-discussion-thread.ts)
takes an exact `https://127.0.0.1:<port>` origin, explicit CA, trusted owner credential
callback and bounded timeout. The role label is descriptive; the service authenticates
every call. The client verifies the CA and hostname without installing system trust.

`readThread(expectedContext, limit?, signal?)` makes one GET to
`/company/v1/projects/{project_id}/owner-discussion/thread`. The host independently retains
the permitted company/project and resolves the expected limit before credential work:
absent means 20, otherwise an exact integer 1 through 50. Only the optional canonical
`?limit=n` is sent. No body, known room/message ID, command, receipt or cursor is accepted.
There is no redirect, automatic retry, polling or credential fallback.

[`validateOwnerDiscussionThread`](../packages/company-contracts/communications/owner-discussion-thread.ts)
binds the page to that retained context and resolved limit. A separately validated current
head identifies the discovered room; every newest-first item retains its own historical
Conversation, Message, receipt and full typed references. Record, item and page digests,
scope, visibility, sequence, observation and coverage are checked. Parsed data is frozen.

Per-item command reconstruction uses returned receipt identity and stored text solely
for internal consistency. It is not independently retained proof of the original append
input. The sealed exact-read-back API keeps its original input requirements. Returned
principal IDs, receipts and observations do not grant authority.

## Partial results and failure handling

The strict decoder caps the entire raw response at 262144 UTF-8 bytes. The service returns
the longest whole newest prefix that fits; escaping, head, envelope, references and digests
all count. The earlier 32768-byte command boundary is unchanged.

Coverage is always partial, with `none_observed`, `item_limit` or `byte_limit` omission
metadata. Totals, `has_more` and cursor stay null; continuation and snapshot are explicitly
unavailable. A timestamp or head revision does not establish a replayable snapshot. The
client never fabricates continuation or combines separate reads into complete history.

An authenticated observed absence returns null head and no items. Missing capability,
incompatible setup or corrupt selected records produce an unavailable error; they cannot
be presented as empty history. CONTROL validates selected records before byte omission,
using its existing bounded index and authority. Gen does not inspect its Store or private
claim/journal tables.

One deadline covers credential lookup, TLS, body collection and validation. Abort closes
the local request. Errors contain fixed codes; HTML, reflected service details and tokens
are not rendered or returned. No read initializes a room, migrates storage, wakes workers
or invokes a model.

## Focused verification

```text
pnpm exec vitest run tests/company/owner-discussion-thread.test.ts tests/company/owner-discussion-thread-client.test.ts --maxWorkers=1
```

The opt-in `tests/company/owner-discussion-thread-service-integration.test.ts` uses
`GEN_COMPANY_OWNER_DISCUSSION_THREAD_FIXTURE_ROOT` and the pinned CONTROL checkout's
existing locked Python. Separate disposable `regular`, `empty` and `byte` TLS fixtures
exercise discovery, independent 20/1/50 limits, historical records, actual encoded-byte
truncation, authorization denials and normal process cleanup. The regular fixture's stdin
append/revocation controls are private test controls, not new API operations. Gen never
reads a fixture DB. Outputs use unique `.harness-company-evidence/` directories.

This checkpoint proves local synthetic conformance only. Full C02/C03/C07, owner browser
access, UI, streams, native sign-in, cloud employees and the pilot remain open. It includes
no build, installer execution, publication or live activation.
