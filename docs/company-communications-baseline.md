# Company communications: C00 Gen baseline

This records the Gen part of C00 from the owner's [authoritative communication
design](superpowers/plans/2026-11-02-gen-company-communications.md). It specializes,
and does not replace, the [221 company requirements](company/requirements.md).
The design was read in full. No design-blocking conflict was found. This checkpoint
adds source custody and a prerequisite baseline; it enables no communication API.

## Source and workspace custody

| Item | Observed reference |
| --- | --- |
| Owner communication design | 147,064 bytes; SHA-256 `0831d2f2e52cd9f9c832e895e3b739322ee07eda4c6074ea5deda020faedea09`; 1,618 UTF-8 lines. |
| Original company requirements | SHA-256 `7ee0b8ee083ce9e91963e3ec5272f266a44802c7b64626f911b1771b379640bf`; all 221 requirements preserved. |
| GEN | `C:/Users/user/Documents/Generative Harness`; existing branch `feat/generative-harness`; inspected HEAD `7035f665f6527b5ae1be88f444558b4c4ba145ed`, with concurrent uncommitted source. |
| CONTROL | `C:/Users/user/Documents/Maritime/hermes-swarm-control`; existing `setup/maritime-company` branch; inspected clean HEAD `f2f2ffbcd31c8d83b7180d107dbf54c7b43e5959`. CONTROL owns its preflight and later commit evidence. |
| Published Gen baseline | `6d32290f4d0e4c820e6ed0c3eb56a4bd14f7891c`; publication/source sync was not performed. |
| Legacy service contract | Historical request/auth `770b56620a6a8587a8c9e8e321e8c731cbb35807`; raw manifest `80fcc2f4cddafaeb7811eb3d195f908ff974f06e79e3ca79d680188e4b1aad4c`. |
| Two-read contract | Issue-time `aca8ec09de5cda73b014a348a05a8f05b43f465b`; manifest `fb4e7d2eba19275c5d4013576a01d90984c9f716ce9f0d6e1d1b31a15d46a033`. Actual local fixture ingress proof remains pinned separately to `99df4862dabe556fa83ee201b8e4c31a3a78d5dc`. |
| Planning command candidate | Issue-time `b4317f308ca84a26de5cd647706b3f9997cddfd3`; manifest `8ae1a4821077c457173c1231c739df595ffdacc27a75c06e73de66afe0f52bfc`; documentation-only clarification `f2f2ffbcd31c8d83b7180d107dbf54c7b43e5959`. Ingress/persistence remains unimplemented. |

No new repository, database, scheduler, publisher or employee was created. The owner
plan is copied byte-for-byte, protected by an exact-path `-text` attribute. Its
historical plan-only wording does not override the owner's later instruction to
implement it locally; deployment, credential enrollment and external writes remain
separate gates. Source references in the plan are provenance, not current CI proof.

## Preserved targets and limits

The target outer applications are **one Gen E01, 17 standalone Hermes employees and
14 native Codex employees**, across **32 permanent employees and 16 departments**,
each with its own persistent computer, plus the separate control plane. Keeping
Hermes inside Gen gives **18 Hermes inner engines**, consistent with the frozen
status contract. These targets do not attest any deployed machine or manager cutover.

| Preserved constraint | Value |
| --- | --- |
| Model and reasoning | Subscription-only `gpt-6.1-sol`; E01 `max`, staff `xhigh`; no implicit fallback. |
| Active delivery projects | 3; explicit company operations is not a wildcard project. |
| Staff capacity | 8 tasks total, 3 per project, 1 foreground task per employee. |
| Manager/review capacity | Separate single E01 slot; 2 review/integration/repair slots within the 8 staff slots, with existing borrowing policy. |
| Marketing capacity | 2 tasks and 1 render, both within staff capacity. |
| Work bounds | 12 tasks per work order; 2 execution attempts; 2 review rounds; 8 handoff hops; absolute 1,800-second attempt deadline. |
| External effects | No automatic merge/deploy/default-branch update, force push, repository deletion, purchase or permission expansion. |
| Channels | X/Reddit/website scope; YouTube/Instagram/TikTok deferred; no external notification channel enabled. |
| Cost policy | Existing $100 account/$80 proposed target/$20 reserve/no-overage policy retained as design inputs; balances, rates and entitlements are unverified. |

## Dependency availability and authority

| Dependency | Existing evidence and current limitation | Owner |
| --- | --- | --- |
| Organization/projects/scheduler/budgets | Existing deterministic service and synthetic/local tests. Gen displays/proposes; no separate queue or company Store. No live employee admission follows. | CONTROL |
| Principal authentication | Separate owner/employee credentials and exact local scope checks exist. No production registry was supplied; protected remote owner HTTPS/session access is unavailable. Loopback `/api/bootstrap` is not remote authentication. | CONTROL/gateway |
| Artifacts/reviews/publishers | Existing conditional service capabilities; immutable metadata reads have limited fixture proof. No new artifact download, live independent review, GitHub integration or publication authority. | CONTROL |
| E01 runtime | Isolated retained-Hermes composition, exact requested Sol/max route, three scoped employee read tools and local unsubmitted proposals. Real protected account/admission/effective reasoning remains unavailable. No owner bearer reaches the engine. | GEN + CONTROL admission |
| Supervisor/native containment | CONTROL reports a local delegated-cgroup host test. That is separate from harness/tool/project isolation, protected native authentication, real fleet execution and the three-machine pilot. No machine is declared admitted here. | CONTROL |
| Communication records/policy | A reviewed partial C01 strict codec and closed discussion envelope now have a pinned Gen consumer. All results are non-executable; current-generation/audience/artifact authorization and conversation/delivery/request/decision records remain unsupported. Existing mailbox/planning records are not substitutes. | CONTROL, C01-C06; GEN consumer |
| Communication transport | Current Gen client is fixed POST over IPv4 loopback HTTP. No approved remote HTTPS gateway, inbox/receipt query, scoped SSE, opaque cursor or fixed-watermark snapshot contract exists. | CONTROL; GEN consumer |
| Projection and drafts | Existing Gen UI state/journal and bounded reads are reusable. Communication caches still need principal/visibility/incarnation binding and revocation invalidation. | GEN, after C01/C07 |
| Knowledge and GitHub | No communication-scoped knowledge/search or company GitHub link integration is enabled. `read_link_only` is the proposed enrolled-repository default; no enrollment/write is performed. | CONTROL integrations/knowledge |
| Wake/accounting/recovery | Trusted quota/cost/disk/wake observations, private ingress, protected native renewal and full restore reconciliation remain live gates. Missing evidence stays unavailable. | CONTROL/native operators |

Current company evidence remains **32 planned/unverified identities, zero demonstrated
live employees, no E01 cutover and no company acceptance**. A successful local host or
synthetic transport test cannot supply those missing dependencies.

## Combined candidate evidence: HOLD

The one combined window used personal source manifest
`925485082315b9440a3c787c751b5ddbcd945123593a03f2a42426f2d5f685ec`
(1,606 source/test/script/vendor hashes) and company manifest
`3e0fbe4ad62e180326d9d2b80437fb27bada0ce690764581b07e6260fea230b6`
(nine files). All recorded source hashes were unchanged during that window.

| Check | Observed result and proof scope |
| --- | --- |
| TypeScript/application/desktop builds | Each exited 0 on the nominated frozen source. |
| Full units | 1,459 passed, **3 failed**, 2 explicit real-service opt-in skips across 158 files; exit 1. The failures are `tests/path-access.test.ts` Git launch-injection fixtures. The personal owner attributes them to hooks recognizing bare `git` rather than the bundled executable; assertions are retained and fixes are pending. |
| Company final checks | 147 focused synthetic client/host tests and 20 browser cases passed. No new communication persistence or live authorization proof. |
| Workspace/shared browser | 25 workspace and 5 shared browser cases passed. |
| Initial native attempt | Exit 1 before the flow; zero checks completed. Exact-URL window lookup raced startup. Owned-process forced cleanup was retained; no native acceptance. |
| Later verifier-only retry | Prepared-fixture Electron run (`fixture=true`, `inference=false`) demonstrated actual All Agents rows, independent drafts and PTYs, then a **product defect**: the prepared Alpha tile disappears after docking. Evidence `native-1793653527419`; source fix remains personal-owned. No live agent/model execution or cancellation was exercised. Partial progress is not completed native/model acceptance. |

Detailed receipts remain in `.harness-gen-v1-workspace/checkpoint/` and `test-results/`.
The combined receipt is `combined-verdict-20261102-1.json`; company terminal evidence is
`test-results/company-combined-terminal-20261102.json`. Later focused verifier/product
changes are a new source phase; the frozen window is historical evidence, not a claim
that the changing worktree is green. No full rerun is invented.

The subsequent personal checkpoint `personal-workspace-checkpoint-20261102-3` has
source-receipt SHA-256
`f43265bf59de69e8898f679428acc477bf2789d51e7639c7dc7e4ed39648dfec`.
Its report and `native-1793654934011/verification.json` record 8/8 real development
Electron checks passing for prepared threads (`fixture=true`, `inference=false`),
including exact chat/review/PTY transfers, stale-stage refusal, scoped Stop and
normal shutdown. Current focused workspace browser checks passed 29/29; corrected
path-access fixtures passed 31/31; typecheck and web build exited 0. Gen inspected
those receipts and their source-receipt digest; it did not rerun the personal flow.
The earlier full-unit exit 1 is retained, with no later full-suite run claimed.
This follow-up demonstrates the prepared personal interaction, while live model,
subscription, company admission and release gates remain open.

## Integration decisions and first checkpoint

- Preserve the owner's design and original requirements. There is no reason to change
  the selected deterministic service, HTTPS/SSE, addressed inboxes or selective GitHub
  architecture. Current missing capabilities are implementation gates.
- Preserve the existing contracts and nine-file candidate as historical custody. C08
  later touches `company-mode.ts`/client files; coordinate that new source phase rather
  than silently altering a pinned wire protocol. This C00 adds documentation and the
  new source artifact's Git attribute after the combined hold was released.
- Personal core/web/desktop ownership remains separate. Agree exact shared-file changes
  before C08/C09/C14; do not route company operations through personal commands, local
  session search or its numeric event feed.
- CONTROL owns C00 preflight/tests and C01 canonical schemas, actor policy and golden
  fixtures. GEN consumes a reviewed pinned bundle under the plan's additive paths.
  Do not generate a second independent communication schema or task/approval authority.
- The agreed first C01 slice is narrower: strict raw-JSON codec, a closed artifact-free
  `message.send` discussion envelope, and actor/class rejection fixtures. Every
  command remains non-executable. Current-generation, audience and artifact resolution
  and `Policy.authorize` are unsupported; later authorization must reuse the existing
  registry and Store. Gen now consumes the reviewed exact bundle described in the
  [partial C01 consumer checkpoint](company-communications-contracts.md).
  This slice does not complete C01 or enable a route, persistence, transport or UI.
- Gen's first deliverable is this C00 baseline and source custody. C01 cross-language
  contract validation comes next. Read-only Stage 1 views follow their contracts;
  they do not require dispatch, GitHub writes or model wake.
- Local source implementation is authorized; commits/publication/source sync remain
  under coordinated shared-repository custody. No bulk stage, commit, merge, push or
  deployment is part of this checkpoint. No skill workflow overrides those constraints.

**C00 status:** Gen baseline and CONTROL's reviewed source preflight are recorded;
a known-green full candidate and live prerequisites remain outstanding. Communication
activation remains Stage 0/blocked. The partial C01 codec consumer has 107 passing
focused/adjacent checks and passing typecheck; all commands remain non-executable.
C00 and partial C01 are not full communication or 221-requirement completion.
