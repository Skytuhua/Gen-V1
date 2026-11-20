<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1034 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META

- Feature: M17 production remote transport + input gate qualification — verification procedure (no code fix)
- Repo: `skytuhua-org/Gen-V1`, issue #1034 (M-series coordinator issue)
- Plan revision: 1, 2026-11-20. Baseline: `main@7ef0710c90a479233f8dd9fe484a296f8c3c86d3`
- Links: PR #836 merged `16fa007e6ea9bd230cd880815fd24dc6e3c9e510`; M17 Windows run `44411458571` (pass on `f7622531`); gate #774; coordinator checkpoints 014/054.
- Status: BLOCKED — owned-test loopback transport proven only; production endpoint config, M02 authority, M09 durable input all unproved. Flags `remote.readSyncV1`, `remote.submitInputV1` remain false.
- Provenance: M17 handoff + requirements.json + checkpoints; plan by `devin-a-cloud-4f7c1e` (review/planning, no code changes).

### OBJECTIVE

Discharge or keep-blocked each completion criterion with source-bound evidence: an approved production TLS/auth endpoint configuration (T01), independent M02 authority + M09 durable-input proof (T02), and a documented release decision preserving default-off flags until both are satisfied (T03). Success = each criterion marked VERIFIED with digests/run IDs, or remains explicitly BLOCKED naming its missing dependency.

### REQUIREMENTS

- In scope: recording the approved endpoint/TLS/auth configuration when it exists; running the owned verification commands and collecting digests; writing the release-disposition record in this issue.
- Out of scope: deploying a production listener, enabling flags, admitting remote input, code changes, cert generation for production.
- Hard constraints: no plain-HTTP fallback may ever be introduced; `REMOTE_TRANSPORT_DISABLED` fail-closed path is preserved; test-owned TLS proof never counts as production acceptance; flags stay false until T01+T02 are VERIFIED and independent review lands.
- Evidence rules: every receipt binds exact executable/test source, package/installer/exe digests, platform, and run ID; `NOT_RUN` is a valid recorded state — never fabricate.

### REPO_MAP (verified on `main@7ef0710c`)

- `apps/server/device-pairing.ts` — `DevicePairingHost`, remote transport gate, `buildRemoteReadSyncServer` (TLS-only, refuses with `REMOTE_TRANSPORT_DISABLED` without config; `/remote/input/submit` and `/remote/operations/approve` fail closed `REMOTE_INPUT_DISABLED`).
- `packages/core/read-sync.ts` — `ReadSyncHost` (HMAC-SHA-256 cursor key in Store `hostSecret`, bounded pages, pre-emission grant recheck) and `ReadSyncClient` (OFFLINE/RESYNCING/STALE/SYNCED).
- `packages/contracts/paired-device.ts` — `DeviceGrantV1`, `SyncCursorV1`, `PairingRequestV1`, `RemoteTransportConfigV1`, denial codes.
- Flag registry: `remote.readSyncV1`, `remote.submitInputV1` (owner `m17`, default false, host-test injection only — verified present in `apps/server/device-pairing.ts` + `packages/core/service.ts` references).
- Tests: `tests/device-pairing-v3.test.ts` (12), `tests/read-sync-v3.test.ts` (16), `tests/read-sync-decisions-v6.test.ts` (6), `tests/remote-transport-v3.test.ts` (owned-test TLS lifecycle).
- Docs: `docs/implementation/v6/M17/{requirements.json,handoff.md,logs/}`; `docs/implementation/v3/M17-verification.json`.

### DESIGN

Verification procedure, three gates in dependency order. Nothing proceeds past a gate without its evidence.

1. **T01 endpoint gate.** Input required: a formally approved `RemoteTransportConfigV1` (exact TLS identity, client-auth method, bind address, cert chain source) supplied by the maintainer. Procedure when supplied: build the real `buildRemoteReadSyncServer` against a staging endpoint with that config; verify handshake rejects wrong-CA clients, bearer gate returns 401 unauthenticated, no HTTP listener exists (port scan shows TLS only), claim→confirm→bounded read→resnapshot→advance cycle passes, `REMOTE_INPUT_DISABLED` on both input routes, `DEVICE_GRANT_REVOKED` after revoke. Record: endpoint config identity, server + package digests, run ID, per-case PASS/FAIL. If no config is supplied: T01 stays BLOCKED, record the missing item verbatim.
2. **T02 input-authority gate.** Depends: T01 VERIFIED. Input required: independent M02 authority binding + M09 durable-input proof (external evidence supplied by their owners). Procedure: verify the referenced proof artifacts exist, are source-bound (SHA + digests), and cover (a) who may submit input and (b) durable ordering/queueing semantics equivalent to the AFTER_CURRENT contract; then run the remote input admission path against the approved endpoint and record `queuedDispatch` + `providerNetworkCalls` actually measured. If proof absent: T02 stays BLOCKED; `remote.submitInputV1` stays false.
3. **T03 release decision.** Depends: T01, T02. Procedure: an independent reviewer signs the record in this issue; the disposition comment states flag states (`remote.readSyncV1`, `remote.submitInputV1`), the approved endpoint identity, evidence links, and whether read-sync may be enabled — a separate explicit decision, never implied by T01/T02 passing. Any failure or missing dependency ⇒ keep flags false and record the hold.

### EXECUTION_DAG

- **T01** — Record approved production TLS/auth endpoint configuration. Deps: maintainer-supplied config. Steps: obtain config identity; run remote-transport acceptance steps above on a staging endpoint; post checkpoint with run IDs + digests. Done-when: all cases PASS and bound to exact SHA, or BLOCKED + named missing input. Owner: deployment-decision maintainer + verifying worker.
- **T02** — Obtain M02 authority + M09 durable-input evidence. Deps: T01 + external proof artifacts. Steps: locate and cite the artifacts (SHA-pinned); run input-admission verification; record measured traffic or `NOT_RUN`. Done-when: both proofs verified source-bound, else BLOCKED. Owner: M02/M09 acceptance owners.
- **T03** — Independent release disposition. Deps: T01, T02. Steps: reviewer posts signed disposition with flag states; if approved, flag change happens in a separate reviewed PR (not this issue). Done-when: disposition comment + review recorded; flags unchanged until then.

### VALIDATION

- Baseline re-verification (repo root): `pnpm exec vitest run tests/device-pairing-v3.test.ts tests/read-sync-v3.test.ts tests/read-sync-decisions-v6.test.ts tests/remote-transport-v3.test.ts --maxWorkers=1` — expected 35/35; records the still-valid owned-test proof on the audited SHA.
- Production checks (when T01 config exists): TLS-only listener (reject on plain HTTP connect), wrong-CA reject, 401 unauth, full claim→confirm→read→advance cycle, `REMOTE_INPUT_DISABLED` on input routes, revoke ⇒ `DEVICE_GRANT_REVOKED`. Each recorded with run ID + digests.
- Acceptance matrix: T01 approved-config identity recorded | T02 M02+M09 artifacts cited with SHA | T03 signed disposition comment | flags still false unless T03 approves.
- Release gate: independent review is mandatory; self-verification never discharges T03.

### STATE

- Verified: owned-test TLS lifecycle (`tests/remote-transport-v3.test.ts`) PASS on merged cut; pairing/read-sync/decision suites green; Windows run `44411458571` on `f7622531`.
- Blocked: T01 (no approved endpoint config), T02 (no M02/M09 proof), T03 (no disposition). Current flags: `remote.readSyncV1=false`, `remote.submitInputV1=false`, `reviewerApproval=false`.
- Risks: none beyond the holds — procedure is additive documentation only.
- Next step: T01 — record the exact missing endpoint/contract decisions with owners (coordinator next action already stated in checkpoint 054).

### REFERENCES

- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1034
- PR #836 merge: https://github.com/skytuhua-org/Gen-V1/commit/16fa007e6ea9bd230cd880815fd24dc6e3c9e510
- M17 docs: `docs/implementation/v6/M17/{requirements.json,handoff.md}` @`5cde22a7`
- Gate: https://github.com/skytuhua-org/Gen-V1/issues/774
- Baseline `main@7ef0710c90a479233f8dd9fe484a296f8c3c86d3`

