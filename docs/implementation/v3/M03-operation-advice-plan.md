# Recorded operation advice and execution status

Original M03-S10 requires advisory classifier, model, version and uncertainty
metadata after the deterministic decision. M03-U03 requires its Advisory label
below that decision. M03-U02 requires the actual backend/policy and an honest
blocked-stage explanation when an isolation backend is missing.

The production consumers in scope are the existing `repository.test` and
`integration.context7` operations. Their actual runners use unrestricted host
privileges. This work records those facts; it does not create an execution
profile, select a backend, enable a host flag or supply platform proof.

Record the existing deterministic classifier's output in the same synchronous
Store transaction as operation preparation. `REQUIRE_APPROVAL` is provenance
from that preparation, never the current authority decision. The private source
comparison uses the existing effect ledger commitment and is omitted from
public projections and events. No new key or public secret-derived hash is
introduced. An unavailable computation records only a bounded unavailable state.

Expose a strict authenticated metadata GET for a current operation target. It
reports the current recorded lifecycle/approval separately, marks changed owner,
action, state or trust as stale, and explicitly says that bytes/authority have
not been revalidated by this read. Native trust, approval and dispatch checks
remain the authority. The read must not resolve credentials, launch a child,
issue approval or write another event.

Use a separate UI change to show recorded advice below the deterministic
decision, with model/version/uncertainty and its historical status. Advice never
feeds approval readiness. Show the actual host runner and unrestricted policy;
the isolated-execution stage stays blocked without an approved backend/proof.

Dependency-only source composition: #717, the one-file #705 layout follow-on
86811387f4553901c92695cbef811cb15ce27047, and #727. The diagnostic Service merge
7408e5cc is not an ancestor. Product/data and UI changes remain separate PRs.
