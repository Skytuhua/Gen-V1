# Explicit immutable-cut history traversal

This separate trusted-owner-host client retrieves older owner discussion records over a
declared immutable cut. It changes no first-page, append, exact-read-back or older history
API. It adds no room UI, stream, employee tool, CLI registration or remote owner session.
Current authentication, project/audience access, cursor signatures and authoritative
expiry remain CONTROL-owned.

Producer checkpoint: `d824991f24b5fd31805f90e528cefb1e05a126ae`.
The additive [manifest](../packages/company-contracts/communications/owner-discussion-history-candidate.1/manifest.json)
pins these exact raw files:

| File | SHA-256 |
| --- | --- |
| manifest.json | `59cecb824713b945f54f20d0cee595ff5300fc6542754c9c99228e8cf512c323` |
| history.schema.json | `ee7a862e0a4acb4c4f4a752762b8ddebf054da4d6d19d720ee82f39b19fcb93a` |
| examples.json | `b1c5d64082aac470f20cd75482d86a9ba85f0fbf04c46a779b427b7f9c3daa12` |

These are file pins, not activation permission or runtime negotiation.

## Two explicit calls

[`OwnerDiscussionHistoryClient`](../packages/company-client/owner-discussion-history.ts)
accepts only an exact `https://127.0.0.1:<port>` origin, an explicit copied CA, a trusted
owner-host credential callback and bounded timeout. TLS verifies CA and hostname. The
owner role label and returned principal references do not grant authority.

`start(expectedContext, limit?, signal?)` independently retains the permitted company,
project and normalized limit, then makes one fixed GET to
`/company/v1/projects/{project_id}/owner-discussion/history`. Absent limit means 20;
explicit limits are exact integers 1 through 50. Each start deliberately requests a new
cut. A lost initial reply is never silently retried.

The result is `{page, continuation}`. A partial result carries immutable caller-retained
context, fixed limit, full snapshot and watermark head, next sequence, opaque cursor and
seen message IDs. `continue(expectedContext, continuation, signal?)` copies that state
before credential work and issues one GET with the fixed limit and unchanged cursor.
The caller can explicitly repeat the same continuation after a discarded or lost reply.
There is no hidden advancement, cache, automatic fetch loop or automatic resnapshot.
Null/invalid continuation is rejected locally rather than interpreted as a new start.

## What validation proves

[`validateOwnerDiscussionHistory`](../packages/company-contracts/communications/owner-discussion-history.ts)
uses the frozen strict codec and closed additive schema. It binds independently retained
scope and normalized query, both exact cut anchors, snapshot/incarnation/access digest,
fixed limit and contiguous descending ranges. Every historical Conversation, Message,
receipt, typed reference and record/item/page digest is checked. Later appends cannot
replace the watermark head or enter the retained cut. Message IDs cannot repeat across
earlier pages, including nonadjacent pages. Per-item reconstructed commands verify only
internal stored-record consistency, not independently retained original append inputs.

Complete raw UTF-8 pages are capped at 262144 bytes, cursors at 4096 characters and raw
queries at 4160 characters. The existing 32768-byte command boundary is unchanged. The
next range follows the last whole item actually returned, including byte truncation.
Snapshot timestamps are integer UTC milliseconds; observed time describes issuance,
not response freshness. Client validation checks declared lifetime bounds without guessing
server expiry from the local clock or parsing cursor payloads/signatures.

Continuation memory and copying grow with the number of consumed message IDs. This
simple immutable state is O(total consumed IDs) per explicit call; it does not claim
constant traversal work. No full history bodies are retained by the client itself.

Terminal results have `continuation: null`, end at sequence 1 and are complete only for
the issued cut. An observed empty initial cut has null anchors/ranges and no items.
Neither result establishes current global history, event delivery or full C07 correctness.

## Resync and supported lifecycle

Closed service errors retain their fixed code and validated HTTP status. 409 and 410
surface as `RESYNC_REQUIRED`, distinguishing invalid/changed continuation from verified
expiry. The caller must discard the old traversal and explicitly call start for a fresh
cut; the client never splices cuts, changes a limit or restarts at the current head.
401/403 current-access denials remain service-owned and take precedence over cursor use.

Supported producer restore requires stopping the listener, restoring Store offline, and
creating a fresh listener/issuer. Old continuations then resync. Live replacement beneath
an active issuer and arbitrary access remove/regrant ABA are unsupported. The local
fixture's real backup restore is not lossless production recovery or general C17 proof.

One deadline covers preparation, credentials, TLS, body receipt and validation. Abort
closes the owned request without advancing retained state. Redirects, insecure trust,
custom transport overrides, raw exception reflection, credential fallback and retries are
unavailable. No callback or token gives the client authority over the Store or scheduler.

## Focused checks

```text
pnpm exec vitest run tests/company/owner-discussion-history.test.ts tests/company/owner-discussion-history-client.test.ts --maxWorkers=1
```

The opt-in `tests/company/owner-discussion-history-service-integration.test.ts` takes
`GEN_COMPANY_OWNER_DISCUSSION_HISTORY_FIXTURE_ROOT` pointing to the pinned CONTROL checkout
and existing locked Python. Separate disposable regular/byte/empty TLS processes use
public fixture credentials and no operator inputs. They exercise fixed-cut multi-page
retrieval, replay, byte limits, append exclusion, restart, actual offline restore, expiry,
access changes, revocation and normal cleanup. Gen never reads a fixture DB. All outputs
are isolated under `.harness-company-evidence/`.

This remains local synthetic conformance. No full C03/C07/221, SSE/events, employee/model,
native sign-in, account, cloud, pilot, package/installer or live company acceptance is
inferred. Existing native keeper approval remains independent and untouched.
