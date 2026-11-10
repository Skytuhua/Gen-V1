# Existing company reads: access-denial recovery

The owner's communication design §17.4 requires withdrawing cached reads after
access revocation. Section 13.4 permits clearly labeled cached observations during
ordinary outages and preserves local unsent edits. These presentation invariants
use existing read-only APIs; native activation is not a prerequisite.

Previously, a denied refresh left company, project and task records visible,
including context continuation and prerequisite controls. The non-planning host
can return HTTP 503 while preserving `COMPANY_AUTH` or `COMPANY_FORBIDDEN` in its
error envelope, so HTTP status alone cannot distinguish denial from an outage.

The company client now recognizes those existing `ApiError` codes, plus a remaining
`AUTH_REQUIRED` after the existing session retry. Status or context denial clears
the remote snapshots and connection state. The existing request generation and
abort control fence an in-flight status read; unmounting the dossier aborts and
fences context reads. Availability-read denials use the same invalidation callback.
Local notes and view selection remain intact. Fresh observations require another
authorized read; no cached page or cursor is restored on reconnect.

Ordinary context failures retain the previous observations with an explicit
freshness warning. This changes no server permission, role, authentication rule,
endpoint, schema, journal, scheduler or company authority.

Six new browser regressions first failed against the old behavior. They cover
three existing denial codes, both late-response race directions, and ordinary
outage retention. The implementation passed all 14 context cases and typecheck;
independent code and security reviews found no findings. The adjacent company-mode,
manager and context run is recorded separately under
`test-results/company-denial-final-20261102*` after the coordinated dependency update.

The tests use intercepted read-only HTTP fixtures and actual browser UI behavior.
They do not establish live service authorization, remote revocation delivery,
canonical communications persistence/SSE, full C09 or company acceptance. Reviewed
C01 and historical contracts remain unchanged. No activation or publication occurred.
