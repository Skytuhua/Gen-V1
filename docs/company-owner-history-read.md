# Trusted owner-host history read

`packages/company-client/owner-history.ts` provides one explicit `OwnerHistoryClient`.
It is not registered in the normal CLI, browser host, company tools or manager engine.
It adds no room view, browser login, stream, cursor or operational mutation.

The implemented CONTROL checkpoint is `7a96002234aae799c23bef841353c8af0f557876`.
The additive [manifest](../packages/company-contracts/communications/owner-history-read-candidate.1/manifest.json)
is pinned to raw SHA-256
`7022869daf40871777f8bd5368b2c75481f3cd4a1ce81bb737f2c92e0e6e60f3`.
These are source pins, not runtime negotiation or a deployment claim. The existing
history manifest/schema/goldens, read schema and historical integration guards are unchanged.

## Fixed operation

A trusted host explicitly constructs the client with an exact
`https://127.0.0.1:<port>` origin, `role: 'owner'`, its separate owner service credential
callback and operator-selected CA material. The class clones the trust material and
always verifies the certificate and hostname with TLS 1.2 or newer. It cannot accept
arbitrary hosts, paths, headers, agents, insecure TLS overrides or redirects.

```ts
const reader = new OwnerHistoryClient({
  origin: operatorOrigin,
  role: 'owner',
  ca: operatorCaPem,
  credential: readOwnerServiceCredential,
});
const history = await reader.readHistory(
  {company_id: 'leo-company', scope: {kind: 'project', id: approvedProjectId}},
  independentlyKnownConversationId,
); // independently resolved default limit: 20
```

The only request is a body-free GET to
`/company/v1/conversations/{lowercase-uuid}/messages?project_id={exact-project}`,
with an optional explicit integer limit from 1 to 50. No Content-Type or Origin is
sent. The bearer remains in the trusted host. A role label and expected query data
do not authenticate a browser or grant permission; current registry, coordinator,
project, room and `comms_read` checks remain authoritative in CONTROL.

Company/project context is copied before awaiting credentials. The existing strict
[history decoder](company-owner-note-history.md) validates the complete response;
the returned head must also match the independently retained conversation ID.
The client never substitutes response echoes for expected scope, room or limit and
never converts unavailable/corrupt records into empty history.

The response cap is 262,144 raw bytes. One deadline covers credential lookup, TLS,
headers, body and validation: 3 seconds by default, explicitly configurable from
1 to 10,000 milliseconds. An AbortSignal closes this read's socket; it does not
cancel company work. Reads use unpooled connections with no retry or fallback.
Malformed JSON/UTF-8, unsupported media/encoding headers, overflow, mismatched status/error codes,
credential reflection and inconsistent data return fixed private errors. Known
service errors retain the manifest's exact closed code/status mapping.

## Proof and limits

The first focused run failed collection because the client did not exist. The
implemented client passed 35 focused TLS/request/response/deadline/cancellation
cases. A separate actual HTTPS test used the pinned CONTROL fixture: default 20,
explicit limit 1, canonical raw bytes, exact denials, rejected unrelated trust,
unchanged Store rows, normal process exit and temporary Store removal. Independent
code review repeated those 36 cases; independent security review ran the 35 client
cases and inspected the actual fixture path. Both approved the production source.

A fixture-only `Socket`/`Duplex` typing correction followed those runs. Its emitted
JavaScript is byte-identical to the tested version; the original source and reports
are retained. Final `pnpm typecheck` passed. This does not retime or replace any earlier source phase.

Fresh evidence is isolated under `.harness-company-evidence/owner-history-client-20261102/`
and uniquely named `owner-history-https-*` directories. Source custody covers the
enumerated paths only, not all Python/configuration/dependency inputs. The opt-in
integration test uses `GEN_COMPANY_OWNER_HISTORY_FIXTURE_ROOT`; it opens no company
database or registry and supplies no operator credentials. The fixture's public test
certificate/key remain test-only, byte-pinned material and are never production trust.

This proves one same-host owner-host read. Remote browser owner sessions, C06 decisions,
C07 snapshot/replay/SSE, C08 gateway/employee tooling, C09 rooms, native authentication,
effective settings, accounting, cloud employees, the three-machine pilot and full221
acceptance remain open. Missing historical evidence remains missing.
