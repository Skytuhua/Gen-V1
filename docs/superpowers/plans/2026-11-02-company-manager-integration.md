# Gen company-manager integration plan

> For agentic workers: execute bounded tasks against the pinned specification, using tests first and independent review. Coordinate ownership before shared changes.

**Goal:** Make Gen V1 the company's working interface and proposed E01 outer harness,
retaining Hermes and integrating the existing deterministic Maritime service.

**Architecture:** Company Control remains the sole operational authority. Gen owns a
versioned client, isolated tools, company UI and consumer conformance tests. The current
read-only client is separately hosted and never constructs the personal Gen Service.

**Tech stack:** Existing TypeScript/React/Fastify/Zod application, Node HTTP client,
Maritime-owned Python service, JSON Schema 2020-12, Vitest and Playwright.

**Spec:** [Exact supplied requirements](../../company/requirements.md),
[221-row backlog](../../company/feature-backlog.json), and the jointly pinned candidate manifest.

## Fixed boundaries

- Preserve 32 employees and 16 departments. Current target is 18 Hermes engines and 14 native Codex; proposed E01 is Gen with Hermes retained, only after explicit cutover acceptance.
- Preserve `gpt-6.1-sol`, E01 `max`, staff `xhigh`, subscription-only operation and no fallback.
- Maritime owns all business records, scheduling, admission, budgets, approvals, execution and publishers. Gen never opens/copies its database.
- No automatic merge, deployment, purchases or external sending. X/Reddit/website drafts remain distinct from publication; YouTube/Instagram/TikTok remain deferred.
- Keep ongoing personal Gen work intact. No commit, push, infrastructure activation or E01 migration is part of this checkpoint.

## Sequenced implementation

1. **Stabilize and reconcile.** Preserve source bytes and every acceptance row; pin request/auth baseline and candidate manifest; coordinate the two existing development threads. Record tests against the actual current working tree, without calling it a committed or deployed candidate. Covers MGR/ORG/EMP/LRN/AUTH/COST/OPS/EVAL.
2. **Read-only integration.** Implement exact typed transport, employee-only read tools, separate local owner host, authoritative portfolio/roster/campaign/observation views, explicit unsupported states and persistent owner edits. Verify scope/identity/credential separation with synthetic HTTP and browser fixtures and the actual Python service on a task-owned database. Covers MGR/ORG/EMP/INT/DAG/COM/MEM/CTX/LRN/APR/TLS/SEC/GUI/VIEW/OBS/EVAL as partial integration, without claiming their full acceptance.
3. **Manager and bounded context.** Compose the isolated retained Hermes engine with separate employee reads, trusted per-request admission and unsubmitted typed proposals. Persist only local interaction identities, notes and recovery state. Add the separately pinned two-read owner context candidate, disabled until authenticated ingress evidence exists. Consume Maritime-owned mandate/intake/proposal/knowledge APIs when exact contracts and durable receipts exist; local UI records cannot replace them.
4. **Small engineering delivery.** After Maritime supplies tested private transport and native capability APIs, integrate approved task proposals, two specialist machines plus E01, independent review, bounded stop/reconciliation and central draft PR delivery. Preserve exact versions and evidence. Covers RUN/DIST/SCH/GIT/QA/AUTH/SEC/COST/OPS plus shared task/UI areas. Missing APIs or live gates remain blocked; do not invent endpoints.
5. **Concurrent-project reliability.** Consume jointly versioned events and scoped knowledge only after those contracts exist. Prove Alpha/Beta overlap, third-project/company-ops rules, retained uncertain occupancy, budget reservation, restart/partition/wake/restore and independent stopping. Company Control implements the scheduler and durable execution protocol.
6. **Marketing and departments.** Consume real-build capture, E29 edits, independent media review, curated inert playbooks, X/Reddit/website drafts, owner metrics exports and non-code acceptance packages. Covers MKT/PUB/BUS and their DAG/QA/APR/COST/UI boundaries. Public sending is a distinct exact-item live gate.
7. **Measured adoption.** Freeze comparable fixtures and thresholds; measure accepted outcomes, unsupported claims, owner effort and reliability against Hermes with equal infrastructure. Expand staffing only when useful delivery and resource gates pass. E01 cutover drains/fences/reconciles the old manager and preserves identity/history; rollback is explicit. Covers EVAL and remaining P0/P1 acceptance.
8. **Measured improvements.** Complete the 19 P2 rows through observed bottlenecks: retrieval/context, simulation, procedure evaluation, timelines/diagnostics, creative templates and optional engine changes. Preserve all operational contracts while comparing equal permissions and model settings.

## Review and acceptance

- Validate exact manifest bytes, eight routes and shared request schemas; distinguish local pinning from runtime negotiation.
- Deny extra keys, invalid project identifiers, wrong identities, owner credentials in employee tools, personal API access, redirects and credential reflection.
- Preserve unknown/stale/oversized states; no synthetic package can become live-ready or company-accepted.
- Keep owner notes and selection through refresh/reload and service failure; render returned fields as text and retain narrow-screen/keyboard access.
- Run focused tests, actual task-owned Python HTTP conformance, TypeScript, application build, browser fixtures and the existing regression suite. Record failures/skips and independent code/security review.
- Live machine/model/private-transport/containment/publication/demo evidence remains necessary for later activation. A planned or partially integrated backlog row is never a passed acceptance check.
