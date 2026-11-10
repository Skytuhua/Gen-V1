# Fixed owner discussion client

This checkpoint adds an explicit trusted-owner-host client for one informational note
and its exact historical read-back. It does not register a CLI route, browser gateway,
manager tool, employee action or room UI. The company service remains the sole authority
for current credentials, project access, owner audience, command identity and storage.

The producer is CONTROL commit `111214f5f535f982799fe9f1c178887a7b1dd385`.
The exact additive bundle is
[`owner-discussion-candidate.1`](../packages/company-contracts/communications/owner-discussion-candidate.1/manifest.json):

| File | SHA-256 |
| --- | --- |
| manifest.json | `0552e449d911f63ba4655a0745a2a93db2b98708f721a1ec37c67ced27ad009a` |
| discussion.schema.json | `4a6b6fdd8cda6d2f3e8c13a5bd5cb17b9996f83b91dd40925741e990f2bc7a8a` |
| examples.json | `f2bac10ee73fa274f18913e89fcb7262143117f9a4584ade067a16956284d7ea` |

These are file pins, not runtime negotiation or activation permission. Frozen notes,
history, `message.send` and earlier integration guards are unchanged.

## Explicit host use

[`OwnerDiscussionClient`](../packages/company-client/owner-discussion.ts) accepts only
an exact `https://127.0.0.1:<port>` origin, an explicit CA, an owner-host credential
callback and a bounded timeout. TLS verifies the CA and hostname. No system trust is
installed. The `role: 'owner'` label does not authenticate a principal or grant access.

The host independently retains the permitted company/project and the complete command
bytes, including its stable command ID. `append(context, rawCommand, signal?)` makes one
POST to `/company/v1/projects/{project_id}/owner-discussion/messages`. The closed command
contains only `schema_version: 1`, `action: 'owner.discussion.append'`, `command_id`,
`summary` and `body`; note kind and owner audience are server-derived. No head revision
is required for ordinary append.

The returned receipt is checked against the retained command, action, company, URL
project and independently recomputed request digest. `outcome: 'stored'` means the
discussion was stored. It does not claim delivery, employee consumption or task progress.
Principal and observation fields remain descriptive server data.

`readBack(context, rawCommand, receipt, signal?)` validates the retained receipt before
making one GET to its exact conversation/message route. It verifies the separately
validated historical Conversation and Message, complete typed references, record and
wrapper digests, author, sequence, timestamp and original text. A later append cannot
substitute the current conversation head. Invalid or missing receipt input fails before
credentials and cannot select POST.

## Bounds and recovery

The frozen strict codec rejects malformed UTF-8, duplicate decoded keys, unpaired
surrogates, unsafe/noninteger number tokens and unsupported fields. The complete raw
command is at most 32768 bytes; summary/body are at most 1024/8192 UTF-8 bytes. Responses
are independently capped at 262144 bytes. Returned data is deeply frozen.

One deadline covers preparation, credential lookup, TLS, body collection and validation.
Cancellation closes the owned local request. It does not undo an accepted write. A
timeout, abort, transport failure or malformed response after POST dispatch can leave
acceptance uncertain. The client never retries, creates a replacement command ID,
rebases or sends a compensating action. Reconcile explicitly using the retained exact
command and current authorization; identical accepted commands return the stored receipt.

Errors contain only fixed codes. Raw service details, HTML, token contents and credential
callback exceptions are not returned. Redirects, custom headers/agents, insecure TLS,
remote origins and credential forwarding are unavailable.

## Focused verification

```text
pnpm exec vitest run tests/company/owner-discussion.test.ts tests/company/owner-discussion-client.test.ts --maxWorkers=1
```

The opt-in `tests/company/owner-discussion-service-integration.test.ts` uses
`GEN_COMPANY_OWNER_DISCUSSION_FIXTURE_ROOT` pointing to the pinned CONTROL checkout and
its existing locked interpreter. It verifies enumerated working/committed source hashes,
then launches only the disposable public-credential TLS fixture. Gen never reads its DB.
Successful runs require exactly two Alpha messages/receipts/acceptances, protected Beta
invariance, current authorization denials, exact historical read-back and normal child
exit with temporary-store removal. All output uses unique `.harness-company-evidence/`
directories; failed attempts are retained.

This is local synthetic TLS conformance only. Remote owner sessions, employee delivery,
streams, UI, native sign-in, cloud machines and full C02/C03/C08 acceptance remain open.
No installer or package build is part of this checkpoint.
