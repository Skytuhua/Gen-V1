# Plan: Secret check before commit and push

> **No separate design pass.** Leonardo said there is no front end team designing this batch, so this plan specifies the visual design and animation itself (DESIGN §6–§7). **When implementation is finished, the implementing agent must hand the finished work to Leonardo's front end team for review (task T10).** The work is not DONE until that review is posted on this issue.

## META

| Field | Value |
|---|---|
| Feature | Scan what is about to be committed or pushed for API keys, tokens and private keys, and block the commit or push until the user removes them or explicitly approves each finding |
| Size | medium (labels `feature`, `medium`); one issue, no sub-issues (one DAG with disjoint ownership boundaries below) |
| Repo | skytuhua-org/Gen-V1 |
| Plan file | `docs/agent-plans/secret-check-before-commit.md` (identical to this issue body) |
| Plan revision | r1, 2026-11-21 (UTC) |
| Baseline | `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d` (verified with `git rev-parse origin/main` on a fresh clone, 2026-11-21) |
| Related work | No existing issue or PR for secret scanning (searched issues/PRs for "secret scan"; source search found no scanner). **Interacts with the open "Real commit, push and PR from a thread" feature #1235** and its sub-issues #1270 (flag, PR #1293 open), #1271 (contracts/PublishService/routes, PR #1291 open), #1272 (review sheet UI). Those PRs are not merged at baseline; task T07 covers the integration and is conditional on them. Existing secret *redaction* (not scanning) lives in `packages/core/secret-references.ts` (`createSecretRedactor`), `packages/runtime-pi/sdk.ts` (`safeError`) and `packages/core/memory-publication.ts` (`memoryContainsSecret`). |
| Implementation status | NOT_STARTED. Planning only; nothing is implemented. |
| Provenance | Approved for planning by the repository owner (Leonardo) on 2026-11-21 from researched feature proposal batch 3, item 5: "Secret check before commit and push (M): scan the staged diff for API keys and tokens and block the commit until the user removes them or explicitly approves." Leonardo also said "this time there will be no front end team" and asked that the assigned agent "give to the front end team for review when finished". Repository facts come from static reading of the baseline SHA (line numbers refer to it). Decisions marked **DECIDED** were made by the planner (the owner delegates non-approval decisions); options not taken are recorded. No code was built or tested while planning. |

## OBJECTIVE

**User problem.** Gen lets an agent edit a project and then commit and push it from the app (Project context card "Commit", the Pull request panel "Push this reviewed branch to GitHub", and the in-flight one-click Publish from #1235). Nothing checks what is committed. Agents often write keys into `.env` files, config, test fixtures or scripts while debugging, and the user approves a commit from a summary without reading every added line. GitGuardian's *State of Secrets Sprawl 2026* reports that Claude Code-assisted commits leaked secrets at a 3.2% rate against a 1.5% baseline, and that leaks of AI-service keys rose 81% year over year (https://blog.gitguardian.com/the-state-of-secrets-sprawl-2026/). Once pushed, a secret must be treated as compromised even if a later commit removes it.

**Intended behavior.** With the flag on (and the user setting on, its default), every commit and push that Gen performs is scanned on the host first:
- **Commit** (Project context card commit, `commit` action outcome, selective commit, Publish's commit step): the exact content that would enter the commit (staged diff, or the selected hunks for selective commit) is scanned.
- **Push** (Pull request panel push, `create-pr` with `push:true`, Publish's push step): every commit that would leave the machine (commits on the branch not on any remote ref) is scanned, including secrets added in one commit and removed in a later one.

If nothing is found, the action proceeds with no extra UI. If something is found, the action does not run and a **Secret check** sheet lists each finding (file, line, kind, masked preview; the secret value itself is never shown or stored). The user can open the location, ask the agent to remove them (inserts a draft into the composer, never auto-sent), re-check, cancel, or approve the exact findings and continue ("Commit anyway" / "Push anyway" / "Publish anyway"). Approval is bound to the exact findings and exact revision; any change re-scans.

**Measurable success.**
1. 100% of the rule fixtures in T03 are detected and 0 of the negative fixtures (placeholders, examples, lockfile integrity hashes, test fixtures with marker) are reported (unit test).
2. A commit through `POST /api/projects/:id/actions` (type `commit`) with a staged synthetic GitHub token is refused with `SECRET_DETECTED` and creates no commit object (`git rev-parse HEAD` unchanged) (T05 test).
3. The same commit with a valid `secretApprovalId` for those exact findings succeeds; with one extra finding added after approval it is refused again (T05 test).
4. A push of a branch where commit A adds a token and commit B deletes it is refused (T05 test).
5. Scanning a 256 KiB staged diff completes in under 150 ms on the CI runner (T03 benchmark assertion, generous bound).
6. With the flag off, every commit/push/publish path is byte-for-byte baseline (no new calls, no new fields) (T05 regression test).
7. The front end team has reviewed the finished UI and posted its verdict on this issue (T10).

## REQUIREMENTS

### In scope

- **R01 Flag.** New host capability flag `workspace.secretScanV1`, default **false**, registered in `packages/core/capability-flags.ts` next to the M08 keys (`M08_FLAG_KEYS` at lines 56–62, `hostDefinitions` at line 126). Flag off: no scan, no new routes (they return `CAPABILITY_DENIED`), no new UI, payload field `secretApprovalId` rejected.
- **R02 User setting.** "Check for secrets before commit and push" in Settings › Source Control & Reviews, default **on**, registered in `apps/web/src/settings-inventory.ts` (source-control rows at lines 114–125) and stored like the other source-control preferences (path discovered in T01). Only visible when the flag is on. Turning it off requires a confirm step ("Turn off secret checks? Commits and pushes from Gen will no longer be checked.") and records `secretScan.disabled` in the store for audit. The host reads the setting at scan time; the agent cannot change it (no command exposed to runtimes).
- **R03 Commit scan points.** Scan before the write in: (a) `ProjectTools.gitAction` type `commit` (`packages/workspace/tools.ts:182`, runs `git commit -m` on the staged index), (b) `SelectiveCommitService.commit` (`packages/workspace/selective-commit.ts:166`, scans the selected hunk patches before `commit-tree`), (c) Publish's commit step (covered via (a) because PR #1291's `PublishService.run` calls the `commit` action outcome; verified in T07).
- **R04 Push scan point.** Scan before `git push` in `GitHubTools.create` when `input.push===true` (`packages/workspace/github.ts:60`, the push call is inside `withInput`, before `beforeWrite?.()` is called for the push). Range: commits reachable from `HEAD` and not from any remote-tracking ref or the remote branch head (`git rev-list --reverse HEAD --not --remotes`), max 200 commits; each commit's patch is scanned (`git show --format= --full-index --no-ext-diff --no-textconv --no-color <sha>`). More than 200 commits → result `incomplete` (R09).
- **R05 What is scanned.** Only added lines (`+` lines, not `+++` headers) of unified diffs, with their new-side line numbers; untracked new files via the same synthesized patch selective-commit already builds (`newFilePatch`, line 81). Binary and non-UTF-8 files are skipped and listed as "not checked (binary)" in the result. Per-file cap 1 MiB of added text, total cap 16 MiB per scan; anything beyond → `incomplete`.
- **R06 Rules.** A fixed, versioned rule table (`rulesVersion: 1`) in `packages/workspace/secret-scan.ts` (DESIGN §2). Each rule: `id`, `label`, `confidence` (`high` | `medium`), regex, optional entropy floor, optional keyword context. High = provider-specific formats (AWS, GitHub, GitLab, Slack, Stripe live, OpenAI, Anthropic, Google API, private key blocks, npm, Hugging Face, SendGrid, HashiCorp Vault, DigitalOcean, Databricks). Medium = JWTs, credentials in URLs, generic `key/secret/token/password = "<value>"` assignments with entropy ≥ 3.5 bits/char and length ≥ 16.
- **R07 False-positive controls.** (a) Placeholder filter: values containing `example`, `sample`, `dummy`, `placeholder`, `changeme`, `your_`, `<`, `>`, `${`, `{{`, `process.env`, `os.environ`, or consisting of one repeated character or a strictly sequential run (`abcdef…`, `123456…`) are ignored. (b) Inline marker: a line containing `gen-secret-scan: allow` (any comment syntax) is ignored, mirroring gitleaks' `gitleaks:allow`. (c) Generic (medium) rules skip `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `*.lock`, `*.min.js`, `*.map`, `*.svg`; high rules still apply there. (d) No project-level allowlist file in v1 (out of scope, see below).
- **R08 Block and approve.** Findings stop the action before any write and return `SECRET_DETECTED` with a `scanId` and masked findings. The user can approve the exact set of findings; approval is a host record bound to project, thread, scan scope, the scanned revision (commit) or head SHA (push), and the set of finding fingerprints; valid for 15 minutes and single use. Retrying the action with `secretApprovalId` re-scans; it proceeds only if every current finding's fingerprint is in the approval and the binding still matches. Otherwise it is refused again with a fresh `scanId`.
- **R09 Incomplete scans.** If any cap is hit or a file could not be read, the result is `incomplete` with reasons. An incomplete scan with no findings still blocks with the sheet showing "Couldn't fully check this commit" and the reason; the user may approve ("Commit anyway") the same way (fingerprint set empty, `incomplete:true` bound into the approval).
- **R10 Only the user approves.** Approvals are created only through the authenticated `/api/projects/:id/secret-scan/approve` route under the existing host/origin/cookie/CSRF hooks (`apps/web/src/api.ts:107–124`). No runtime/agent tool, plugin command or MCP surface can create, read or extend approvals. Agent-originated paths never carry `secretApprovalId`.
- **R11 Secret values never leave the scanner.** Findings carry: `id`, `ruleId`, `ruleLabel`, `confidence`, `path`, `line` (new side), `commit` (push scans: short SHA + subject ≤ 80 chars), `preview` (masked, DESIGN §2.4), `fingerprint` (HMAC, DESIGN §2.5). The raw match is never written to the store, logs, receipts, the event stream, the composer draft, or errors. Errors and logs pass through `createSecretRedactor` as defense in depth.
- **R12 Sheet (UI).** Secret check sheet (DESIGN §6) opened whenever a commit/push/publish action returns `SECRET_DETECTED`, from: Project context card commit (`apps/web/src/ProjectContextCard.tsx:52–53`), Pull request panel create with push (`apps/web/src/WorkspaceSurfaceBody.tsx` `PullRequestsBody`, line 100 and form at 158), Publish review (T07). Actions: Open location, Copy location, Ask agent to remove, Re-check, Cancel, Approve and continue.
- **R13 Ask agent to remove.** Inserts into the current thread's composer draft (never sends) the text: `Remove these possible secrets from the working copy, load them from environment variables or a git-ignored file instead, and tell me which keys need rotating:` followed by one line per finding `- <path>:<line> (<ruleLabel>)`. No secret values or previews. Disabled with tooltip "Open the thread to ask its agent" when the sheet is opened from a surface without a composer for that thread.
- **R14 Re-check.** Runs the scan preflight route (DESIGN §4) for the same scope without performing the action. If clean, the primary button becomes the plain action ("Commit" / "Push" / "Publish") enabled; it never auto-runs the action.
- **R15 Accessibility.** The sheet is the shared `Modal` primitive (`packages/ui-shell/Modal.tsx`) with focus trap and restore; initial focus on **Cancel** (safe default). Findings list is a `role="list"`; each finding row has an accessible name "Likely secret: GitHub token in src/config.ts line 12". Confidence is conveyed by text and icon, not color alone. Approval checkbox is a native checkbox with a visible label. Keyboard: Tab order list → Ask agent → Re-check → Cancel → Approve; Enter on a row activates Open location; Escape = Cancel. Results of Re-check are announced in a polite live region.
- **R16 Errors.** Scanner failure (exception, git failure) never silently allows: the action is refused with `SECRET_SCAN_FAILED` "Gen couldn't check this commit for secrets. Try again, or turn off secret checks in Settings." Approval expired/mismatched → `SECRET_APPROVAL_INVALID` "The changes or findings changed since you approved. Review the new results." The user's commit message, PR title/body and selections are kept on every failure.
- **R17 Performance.** Scanner is linear in added bytes; regexes are anchored on literal prefixes where possible and none use nested quantifiers (ReDoS review in T03). Commit with no staged secrets adds ≤ 1 extra `git diff --cached` call; push adds one `rev-list` plus one `show` per commit (≤ 200).
- **R18 Audit.** Each scan that finds something, each approval and each refused retry writes a store record (kind `workspaceSecretScan` / `workspaceSecretApproval`) with masked findings only, visible to tests; no UI for audit in v1.

### Out of scope (v1)

- Commits the agent makes itself with `git commit` in a terminal or shell tool (not through Gen's actions). Recorded as a follow-up option: install a managed `core.hooksPath` pre-commit hook in managed worktrees. Push from a terminal is likewise out of scope.
- Scanning existing history, the working tree outside the diff, or files not being committed.
- Project-level allowlist files, custom rules, remote rule updates, verifying keys against providers (GitGuardian/TruffleHog-style liveness checks), automatic rotation.
- Rewriting history to remove an already-committed secret (the sheet tells the user to remove it and rotate it; for push scans it says the secret is in commit `<sha>` and must be removed from history before pushing — instructions only).
- Changes to existing redaction helpers (`safeError`, `memoryContainsSecret`); they stay as they are.

### UX copy (DECIDED)

| Element | Copy |
|---|---|
| Sheet title (commit) | Possible secrets in this commit |
| Sheet title (push / publish) | Possible secrets in commits you're pushing |
| Sheet title (incomplete, no findings) | Couldn't fully check this commit |
| Summary line | `N findings in M files` (singular forms: `1 finding`, `1 file`) |
| High badge | Likely secret |
| Medium badge | Possible secret |
| Push-scan row suffix | `in commit 1a2b3c4 · <subject>` |
| Guidance line (push scans only) | These commits aren't pushed yet. Remove the secret from the commit history before pushing, and rotate any real key. |
| Approval checkbox (only when ≥1 high finding) | I've checked these and they're not real secrets |
| Primary (blocked) | Commit anyway / Push anyway / Publish anyway |
| Primary (after clean re-check) | Commit / Push / Publish |
| Secondary | Cancel · Re-check · Ask agent to remove |
| Pending (after 150 ms) | Checking for secrets… |
| Re-check clean | No secrets found |
| Re-check still finds | Still N findings |

### Compatibility, security, privacy

- Windows x64 is the shipped platform; the scanner is pure TypeScript and platform-neutral. Paths in findings use the repository's `/` form.
- No new network egress. No new dependency (DECIDED: own rule table, not gitleaks/trufflehog binaries; reasons in DESIGN §1).
- Fingerprint key file is created with mode `0o600` using the existing `secureDirectory` helper pattern (`packages/workspace/github.ts` `withInput`, line ~43) under `<dataDir>/secret-scan/`.

## REPO_MAP (verified at baseline unless marked DISCOVERY)

| Area | Path | What is there today |
|---|---|---|
| Commit action | `packages/workspace/tools.ts:182` `ProjectTools.gitAction` | `stage` (`git add --`), `unstage`, `commit` (`git -c commit.gpgsign=false commit -m <message>`), `branch`; revision-fenced by `status()` (line 142) which already computes `stagedDiff` (`git diff --cached --full-index --no-ext-diff --no-textconv`). Write requires a managed working copy (`withGitOperation`). |
| Selective commit | `packages/workspace/selective-commit.ts` | `preview` (line 150) and `commit` (line 166): rebuilds candidate hunks, writes the selected patch to a private file, `read-tree` into a private index, `apply --cached`, `write-tree`, `commit-tree`, verify, CAS `update-ref`. `newFilePatch` (line 81) synthesizes patches for untracked files. No HTTP route (per #1235 T01). Behind M08 `workspace.provenanceV1` (off). |
| Push + PR | `packages/workspace/github.ts:60` `GitHubTools.create` | Revision fence, `UNCOMMITTED_CHANGES` guard, then inside `withInput`: if `input.push===true` → `beforeWrite?.()` then `git push https://github.com/<repo>.git <head>:refs/heads/<branch>` with the gh credential helper; then remote ref check, `gh pr create --draft`, head verification. `run()` (line 30) already redacts the token via `createSecretRedactor`. |
| Action outcomes | `packages/workspace/action-outcomes.ts:180` `execute` | Durable idempotent outcomes for `stage`/`unstage`/`commit`/`review-pr`/`create-pr`. Any throw before `beginWrite` → state `not-applied`; after → `uncertain`. **The thrown error's code/details are dropped** (the catch returns only `{state}`); the route maps `not-applied` to `409 REVISION_CHANGED` (`apps/server/workspace-routes.ts:129–139`). T05 must carry the `SECRET_DETECTED` reason through. |
| Payload contracts | `packages/contracts/workspace-action-outcomes.ts:33–54` | `workspaceActionPayloadSchemas.commit` (`...local, message`) and `'create-pr'` (`title, body, base, push, head, revision`), all `z.strictObject` — a new optional `secretApprovalId` must be added explicitly. |
| Routes | `apps/server/workspace-routes.ts` | `/api/projects/:projectId/actions` (line 129), `/action-outcomes/inspect` (line 36), `/git` (line 47). New routes go beside them. |
| Errors to web | `apps/web/src/api.ts:6, 39–40` | `ApiError(code, message, details)` built from `{error:{code,message,details}}` bodies. |
| Commit UI | `apps/web/src/ProjectContextCard.tsx:52–53` | "Commit" row → form with commit message → `run('commit', {message, expectedHead, revision})` via `onAction`; errors shown in `role="alert"` paragraph (line ~59). |
| PR panel UI | `apps/web/src/WorkspaceSurfaceBody.tsx:91–158` `PullRequestsBody` | Draft form with `push` checkbox (journal field `push`, line 91/93), create flow at line 158. |
| Diff view | `apps/web/src/WorkspaceSurfaceBody.tsx:39` `DiffBody` | Whole patch in one `<pre>`; no per-line anchors. "Open location" therefore opens the Changes panel and DISCOVERY (T01) decides whether it can scroll to a file (see DESIGN §6.5). |
| Modal primitive | `packages/ui-shell/Modal.tsx` | `<dialog>`-based `Modal({open,title,onClose,children,className})` with focus retention, exit animation, scrim/blur tokens. |
| Tokens | `packages/ui-shell/tokens.css`, `apps/web/src/styles.css` | Spacing `--ui-space-1..6`, `--ui-dialog-inset`, `--ui-panel-inset`, rows `--ui-row-compact/comfortable/touch`; motion `--ui-motion-insert`, `--ui-motion-remove`, `--ui-motion-stagger`, `--ui-motion-status`, `--ui-motion-success`, `--ui-motion-hover`, `--ui-motion-press`, eases `--ui-ease-enter`, `--ui-ease-move`; status colors used across the app: `--danger`, `--danger-fg`, `--warning`, `--warning-fg`, `--success`, `--success-fg`, `--muted`; mono font `--font-mono` / `--code-font`. `.error-text` in `styles.css:46`. |
| Flags | `packages/core/capability-flags.ts` | `M08_FLAG_KEYS` (56–62), `CapabilityFlagKey` union (124), `hostDefinitions` (126+), env override `HARNESS_FLAG_<KEY>` (`capabilityFlagEnvName`, 163), test helper `__setCapabilityFlagForTests` (207). Test: `tests/host-capability-flags.test.ts`. |
| Settings | `apps/web/src/settings-inventory.ts:114–125`, `apps/web/src/settings-registry.ts`, `apps/web/src/Settings.tsx` | Source-control setting rows (`[id, label, section, keywords]`). DISCOVERY (T01): where source-control preference values are persisted and read by the host (search `automatic-pull` / `pull-request-merge-method` across `apps/` and `packages/`). |
| Existing redaction | `packages/core/secret-references.ts:161` `createSecretRedactor`; `packages/runtime-pi/sdk.ts:13` `safeError` regex; `packages/core/memory-publication.ts:3` `memoryContainsSecret` | Redaction/guard regexes for provider tokens. The scanner's rule table (DESIGN §2) is a superset written for scanning; these helpers are not changed. |
| Publish (in flight) | PR #1291 (`packages/workspace/publish.ts`, `packages/contracts/workspace-publish.ts`, routes, `tests/workspace-publish.test.ts`), PR #1293 (flag), issue #1272 (review UI) | Not merged at baseline. `PublishService.run` calls `outcomes.execute` with `type:'commit'` (`<id>:commit`) and then `create-pr` with push. |
| Tests to extend / patterns | `tests/selective-commit-v3.test.ts`, `tests/github-workspace.test.ts` (temp repo + fake gh), `tests/workspace-action-outcomes.test.ts`, `tests/workspace-action-outcome-routes.test.ts`, `tests/project-context-committed-action.test.ts`, `tests/host-capability-flags.test.ts`, `tests/e2e/m08-pr-checks.spec.ts`, `tests/e2e/shared-panels-fixture.tsx` | Unit (vitest) and Playwright fixtures. |
| Source manifest | `scripts/public-source-files.json` | Every new source file must be listed (CONTRIBUTING.md). |
| Agent shell commits | — | DISCOVERY (T01): confirm runtimes have no host "commit"/"push" tool (search `packages/runtime-*`, `packages/core` for `gitAction`, `'commit'`, `push`) so all Gen-performed commits go through R03/R04. |

## DESIGN

### 1. Architecture (DECIDED)

- **Pure scanner** `packages/workspace/secret-scan.ts`: `scanPatch(patch: string, opts) → ScanResult` and `scanPatches(parts: {patch, commit?}[], opts)`. No I/O, no git. Easy to unit test and benchmark.
- **Host service** `SecretScanService` in the same file (or `packages/workspace/secret-scan-service.ts` if the file passes ~300 lines): owns the fingerprint key, scan/approval store records, the setting read, and the three entry points `checkCommitStaged(git, ctx)`, `checkCommitPatch(patch, ctx)`, `checkPush(git, ctx)`. Each returns `void` (clean, or approved) or throws `HarnessError('SECRET_DETECTED', message, details)` / `SECRET_SCAN_FAILED` / `SECRET_APPROVAL_INVALID`.
- **Call sites** call the service before writing (R03/R04). The service is injected into `ProjectTools`, `SelectiveCommitService` and `GitHubTools` the same way the edit journal is injected into `SelectiveCommitService` (constructor arg), wired where those are constructed (DISCOVERY T01: search `new SelectiveCommitService(`, `new GitHubTools(`, `new ProjectTools(` in `apps/server`).
- **Why not gitleaks/trufflehog**: adds a native binary per platform to the Windows bundle, a license review (`THIRD_PARTY_NOTICES.md`), and process spawn per commit; the needed rule set is small and the repo already maintains equivalent regexes. Option recorded for a later revision if rule coverage proves insufficient.

### 2. Scanner details

**2.1 Input parsing.** Walk the unified diff line by line. Track current file from `diff --git a/<p> b/<p>` / `+++ b/<p>` (`/dev/null` = deletion, skip). Track new-side line number from each `@@ -a,b +c,d @@` header (start `c`, increment on `+` and ` ` lines, not on `-`). For each `+` line (excluding `+++ `), strip the leading `+` and test rules. Lines longer than 4,096 characters are tested only on their first 4,096 characters (minified code) and add reason `long-line-truncated` to `incomplete` only if a rule matched at the cut boundary (otherwise not flagged incomplete).

**2.2 Rule table (`rulesVersion: 1`).** Regexes are case-sensitive unless noted, use `\b`/literal prefixes, and contain no nested quantifiers.

| id | label | confidence | pattern (JS) | extra |
|---|---|---|---|---|
| `aws-access-key-id` | AWS access key | high | `\b(?:AKIA\|ASIA\|ABIA\|ACCA)[0-9A-Z]{16}\b` | |
| `aws-secret-key` | AWS secret key | high | `(?i)aws.{0,20}(?:secret\|private).{0,20}['"=:\s]([A-Za-z0-9/+=]{40})\b` | entropy ≥ 4.0 on capture |
| `github-token` | GitHub token | high | `\bgh[pousr]_[A-Za-z0-9]{36,255}\b` | |
| `github-fine-grained` | GitHub token | high | `\bgithub_pat_[A-Za-z0-9_]{60,255}\b` | |
| `gitlab-token` | GitLab token | high | `\bglpat-[A-Za-z0-9_-]{20,}\b` | |
| `slack-token` | Slack token | high | `\bxox[abposr]-[A-Za-z0-9-]{10,}\b` | |
| `slack-app-token` | Slack token | high | `\bxapp-[0-9]-[A-Za-z0-9-]{10,}\b` | |
| `slack-webhook` | Slack webhook URL | high | `https://hooks\.slack\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]{20,}` | |
| `stripe-live` | Stripe live key | high | `\b(?:sk\|rk)_live_[A-Za-z0-9]{20,}\b` | (`_test_` keys are not reported) |
| `openai-key` | OpenAI API key | high | `\bsk-(?:proj-\|svcacct-\|admin-)?[A-Za-z0-9_-]{40,}\b` | must not start with `sk-ant-` |
| `anthropic-key` | Anthropic API key | high | `\bsk-ant-(?:api\|admin)[0-9]{2}-[A-Za-z0-9_-]{80,}\b` | |
| `google-api-key` | Google API key | high | `\bAIza[0-9A-Za-z_-]{35}\b` | |
| `private-key` | Private key | high | `-----BEGIN (?:RSA \|EC \|DSA \|OPENSSH \|PGP \|ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----` | reported on the BEGIN line |
| `npm-token` | npm token | high | `\bnpm_[A-Za-z0-9]{36}\b` | |
| `huggingface-token` | Hugging Face token | high | `\bhf_[A-Za-z0-9]{34,}\b` | |
| `sendgrid-key` | SendGrid API key | high | `\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b` | |
| `vault-token` | HashiCorp Vault token | high | `\bhvs\.[A-Za-z0-9_-]{24,}\b` | |
| `digitalocean-token` | DigitalOcean token | high | `\bdo[por]_v1_[a-f0-9]{64}\b` | |
| `databricks-token` | Databricks token | high | `\bdapi[a-f0-9]{32}(?:-[0-9])?\b` | |
| `jwt` | JSON Web Token | medium | `\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b` | |
| `url-credentials` | Password in URL | medium | `\b[a-z][a-z0-9+.-]{1,20}://[^\s/:@'"]{1,64}:([^\s/@'"]{6,128})@[^\s/'"]+` | capture not a placeholder, not `${...}` |
| `generic-assignment` | Possible secret value | medium | `(?i)\b(?:api[_-]?key\|apikey\|secret\|client[_-]?secret\|access[_-]?token\|auth[_-]?token\|private[_-]?key\|password\|passwd)\b["']?\s*[:=]\s*["']([^"'\s]{16,256})["']` | entropy ≥ 3.5 bits/char on capture; skipped in R07(c) files |

`(?i)` above means build the regex with the `i` flag (JS has no inline flags). The implementer writes the table as `{id,label,confidence,regex:/.../g,capture?:1,minEntropy?}` objects and adds a test per row. If any pattern above fails its positive/negative fixtures as written, adjust the pattern and record the change and reason in the PR (patterns are a decision the implementer may refine; the id/label/confidence set is fixed).

**2.3 Filters.** Apply R07 to the matched value (capture group if present, else full match). Shannon entropy = `-Σ p·log2 p` over characters of the value.

**2.4 Masked preview.** `preview = first 4 chars + "…" + "•" × min(8, len−6) + last 2 chars` of the matched value when `len ≥ 12`, else `"•" × 8`. For `private-key` the preview is `-----BEGIN … PRIVATE KEY-----` (no key material). The preview is the only representation of the value that leaves the scanner. Example: a GitHub token `ghp_Ab…` → `ghp_…••••••••Xy`.

**2.5 Fingerprint.** `fingerprint = hex(HMAC-SHA256(key, ruleId + "\0" + path + "\0" + value)).slice(0, 32)`. `key` = 32 random bytes created once at `<dataDir>/secret-scan/fingerprint.key` (mode 0o600, created with `open(path,'wx',0o600)`; if it exists, read it). The fingerprint identifies "the same secret at the same path" across rescans of unchanged content, and does not allow offline guessing of short secrets from the store. It deliberately excludes the line number so a moved line keeps its approval only if the rest of the binding (revision/head) also still matches — which it won't after edits, so in practice approval is per exact content.

**2.6 Finding id.** `id = fingerprint.slice(0,12) + "-" + line` (+ `-<commit7>` for push scans) — stable within one scan for React keys and the UI.

**2.7 Result type.**
```ts
interface SecretScanResultV1 {
  version: 1; rulesVersion: 1; scope: 'commit' | 'push';
  findings: SecretFindingV1[];        // sorted by path, then line, then commit order
  skipped: { path: string; reason: 'binary' | 'not-utf8' | 'too-large' }[];
  incomplete: false | { reasons: ('file-cap' | 'total-cap' | 'commit-cap' | 'unreadable')[] };
}
interface SecretFindingV1 {
  id: string; ruleId: string; ruleLabel: string; confidence: 'high' | 'medium';
  path: string; line: number; preview: string; fingerprint: string;
  commit?: { sha: string /* 40 hex */; subject: string /* ≤80 */ };
}
```

### 3. Host flow (enforcement)

```
action request ─► (flag on && setting on?) ─no──► unchanged baseline path
                         │yes
                         ▼
          collect content (staged diff | selected patch | outgoing commits)
                         ▼
                 scan (pure) ── exception ──► throw SECRET_SCAN_FAILED (nothing written)
                         ▼
     findings=∅ && complete ──► proceed with the write (unchanged code)
                         │else
                         ▼
     secretApprovalId given? ─no─► store workspaceSecretScan{scanId,...}; throw SECRET_DETECTED{scanId,result}
                         │yes
                         ▼
     approval valid (same project/thread/scope/binding, unexpired, unused,
       every current fingerprint ∈ approved set, incomplete flag matches)?
         ─no─► throw SECRET_APPROVAL_INVALID{scanId(new), result}
         ─yes─► mark approval used (store.internal), proceed with the write
```

- **Commit binding** = `GitStatus.revision` of the staged state at scan time (already computed by `status()`; the action is revision-fenced, so the approval's revision equals the action's `revision`). For selective commit, binding = `expectedHead` + sorted selected hunk digests.
- **Push binding** = `status.head` (40-hex) + branch name.
- **Placement in `gitAction`**: after the revision check and before `git commit` (tools.ts:182–187), only when `input.type==='commit'`. Use the `stagedDiff` already returned by `this.status(...)` — no extra git call.
- **Placement in `SelectiveCommitService.commit`**: after `patchParts` is built and verified against digests, before writing the patch file.
- **Placement in `GitHubTools.create`**: inside `withInput`, when `input.push===true`, before the existing `beforeWrite?.()` for push; the scan uses `this.projects.git(path, [...])` for `rev-list` and `show`. Because it runs before `beforeWrite`, a refusal leaves the outcome `not-applied` (no write happened), which is correct.
- **Outcome propagation (R08/R16)**: in `WorkspaceActionOutcomes.execute`, in the `catch` branch where `started===false`, if the error is a `HarnessError` whose code is in `{SECRET_DETECTED, SECRET_APPROVAL_INVALID, SECRET_SCAN_FAILED}`, include `reason: {code, message, details}` in the returned `not-applied` execution (extend `WorkspaceActionExecution` type for `not-applied` with optional `reason`). In the `/actions` route (workspace-routes.ts:133–139), when `outcome.reason` is present, respond `409` with `error: outcome.reason` instead of the generic `REVISION_CHANGED`. The intent record stays `not-applied`, so a retry must use a **new action id** (the UI already generates a new id per attempt — verify in T01; if not, T06 generates one).
- **Store records** (`service.store.internal('workspace.secret-scan.recorded', threadId, ...)`):
  - `workspaceSecretScan` key `scanId` = `{version:1, scanId, projectId, threadId, scope, binding, result (masked), createdAt, expiresAt (createdAt+15min)}`.
  - `workspaceSecretApproval` key `approvalId` = `{version:1, approvalId, scanId, projectId, threadId, scope, binding, fingerprints[], incomplete:boolean, approvedAt, expiresAt, usedAt?:string}`.
  - Records older than 24 h are pruned on service start (DISCOVERY: existing prune pattern in store; if none, prune lazily on read).

### 4. Contracts and routes

New `packages/contracts/workspace-secret-scan.ts` (zod, patterns copied from `workspace-action-outcomes.ts`: identifier/oid/revision regexes, unicode refinement):
- `secretFindingV1Schema`, `secretScanResultV1Schema` (as 2.7; arrays max 500 findings, 500 skipped; strings bounded: path ≤ 1024, preview ≤ 32, subject ≤ 80).
- `secretScanPreflightRequestSchema = z.strictObject({threadId: identifier, scope: z.enum(['commit','push']), revision: revision.optional(), head: oid.optional()})`.
- `secretScanPreflightResponseSchema = z.strictObject({scanId: identifier.nullable(), result: secretScanResultV1Schema})` (`scanId` null when clean).
- `secretApprovalRequestSchema = z.strictObject({threadId: identifier, scanId: identifier, fingerprints: z.array(z.string().regex(/^[0-9a-f]{32}$/)).max(500), acknowledgedHigh: z.boolean()})` — `acknowledgedHigh` must be `true` when the scan has any high finding (server re-checks against the stored scan).
- `secretApprovalResponseSchema = z.strictObject({approvalId: identifier, expiresAt: z.string()})`.
- Error details for `SECRET_DETECTED` / `SECRET_APPROVAL_INVALID`: `{scanId, result}`.
- Add `secretApprovalId: identifier.optional()` to `workspaceActionPayloadSchemas.commit` and `'create-pr'` (rejected with `CAPABILITY_DENIED` by the service when the flag is off). Add the same optional field to the selective commit input type.

Routes in `apps/server/workspace-routes.ts` (all `Cache-Control: no-store`, `bodyLimit: 64*1024`, under the existing hooks; `CAPABILITY_DENIED` 403 when flag off):
- `POST /api/projects/:projectId/secret-scan` → preflight (scope `commit`: scan staged diff of the thread's managed copy and fence on `revision`; scope `push`: outgoing commits, fence on `head`). Returns `secretScanPreflightResponseSchema`. Writes a `workspaceSecretScan` record only when not clean.
- `POST /api/projects/:projectId/secret-scan/approve` → validates the scan exists, is unexpired, belongs to project/thread, fingerprints equal exactly the scan's finding fingerprints (no subset/superset in v1: DECIDED, approval is all-or-nothing per scan), `acknowledgedHigh` rule; writes `workspaceSecretApproval`; returns `approvalId`.

Web client `apps/web/src/secret-scan-api.ts`: `preflightSecretScan(projectId, body)`, `approveSecretScan(projectId, body)`, `isSecretScanError(error): error is ApiError & {details:{scanId,result}}` using `ApiError` from `api.ts`.

### 5. Flow per surface

- **Project context card commit**: `run('commit', …)` rejects with `ApiError` code `SECRET_DETECTED` → card opens the sheet with `{scope:'commit', result, scanId, retry}` where `retry(approvalId)` calls `onAction('commit', {...payload, secretApprovalId})`. Commit message input keeps its text (the card currently clears it only on success — keep that).
- **Pull request panel create with push**: same pattern; `retry` resubmits the create with `secretApprovalId`; the PR journal (`prJournalSchema`) is unchanged and keeps the draft.
- **Publish (#1235)**: T07. The Publish operation's commit or push step ends `not-applied` with `reason.code==='SECRET_DETECTED'`; `PublishReview` opens the sheet; "Publish anyway" restarts the operation with a new request id carrying `secretApprovalId` for the step that was blocked (DISCOVERY in T07: whether `PublishRequestV1` needs `secretApprovalIds: {commit?, push?}`; expected yes).

### 6. Visual design (DECIDED; no front end team for this batch)

All values use existing tokens; no new colors. Dark and light themes both use the same token names.

**6.1 Container.** Shared `Modal` with `className="secret-check-sheet"`. Width `min(560px, 100vw - 32px)`; max height `min(640px, 100vh - 64px)`; content inset `var(--ui-dialog-inset)` (24px); 12px radius (same as shared popovers); opaque surface; standard modal scrim/blur (`--ui-modal-scrim`, `--ui-modal-blur`). Body scrolls inside the sheet (the findings list grows, header and footer stay fixed: header and footer are `position: sticky` inside the dialog).

**6.2 Header.** One row, 16px gap below:
- Leading icon: lucide `ShieldAlert`, 18px, color `var(--danger)` when any high finding, `var(--warning)` when only medium or incomplete.
- Title (Modal `title` prop): 16px/600, text color default ink. Copy per UX table.
- Summary line under the title: 13px, `var(--muted)`: `3 findings in 2 files` (+ ` · 1 file not checked (binary)` when `skipped` non-empty).
- Push scans: guidance line (UX table) 13px default ink, 8px above the list, with lucide `Info` 14px `var(--muted)`.

**6.3 Findings list.** Grouped by file.
- File group header: 32px min row (`--ui-row-compact`), lucide `FileCode2` 14px `var(--muted)`, path in `var(--font-mono)` 12.5px, middle-truncated with full path in `title` and accessible name; count on the right in 12px `var(--muted)`. 12px top gap between groups, none before the first.
- Finding row: 36px min (`--ui-row-comfortable`), grows for wrapped text; 12px left indent under the group; layout `[badge] [ruleLabel] [line N] [preview] … [actions on hover/focus]`:
  - Badge: text + icon, no filled background (DESIGN.md: "Avoid … filled label backgrounds"); inset 2px vertical, 6px horizontal; 11.5px/600. High: lucide `OctagonAlert` 12px + "Likely secret", color `var(--danger-fg)`, 1px border `color-mix(in srgb, var(--danger) 45%, transparent)`, 999px radius. Medium: lucide `TriangleAlert` 12px + "Possible secret", `var(--warning-fg)`, border with `var(--warning)` at 45%.
  - Rule label 13px default ink; `line 42` 12px `var(--muted)`, tabular numbers; push scans add `· in commit 1a2b3c4 · <subject>` in 12px `var(--muted)`, subject truncated with ellipsis.
  - Preview: `var(--font-mono)` 12px, `var(--muted)`, `user-select: none` (prevents copying even the masked form into chats by accident).
  - Row actions (icon buttons 28px, visible on row hover/focus-within and always visible on touch/coarse pointers): `ExternalLink` "Open location" and `Copy` "Copy location" (copies `path:line`). Tooltips per shared Tooltip rules (350 ms dwell).
- Hover/focus row: background `var(--ui-hover, #1F1F1F neutral selected surface)` — use the same hover background class the shell uses for list rows (DISCOVERY T06: reuse the class from `list-navigation`/shared rows; do not introduce a new color).

**6.4 Footer.** Sticky, 16px top padding, 1px top border (same fine gray border as panels).
- Left: `Ask agent to remove` (secondary, lucide `Bot` 14px) and `Re-check` (secondary, lucide `RefreshCw` 14px; icon spins only while the request is pending, see motion).
- Right: `Cancel` (secondary) then primary.
- Approval checkbox row above the buttons, only when ≥1 high finding: native checkbox + label (UX table), 13px; primary disabled until checked.
- Primary button when blocked: "Commit anyway" / "Push anyway" / "Publish anyway", using the app's destructive button style if one exists (DISCOVERY T06: search for a `danger`/`destructive` button class in `styles.css`/`controls.css`); otherwise the standard primary with text color/border `var(--danger)`. After a clean re-check, primary turns into the plain action label with the normal primary style.
- Status line (polite live region) between checkbox and buttons: `Checking for secrets…` (pending, shown after 150 ms), `No secrets found` (`var(--success-fg)`, lucide `ShieldCheck` 14px), `Still 2 findings` (default ink).
- Narrow (< 480px wide): buttons stack full width in the order primary, Cancel, Re-check, Ask agent; row actions always visible.

**6.5 Open location.** Closes nothing; opens the Changes panel for the thread (`onShowChanges` already exists on the card) and, if T01 finds the diff view can scroll to a file section, scrolls to the file header. Line-level highlighting is out of scope because `DiffBody` has no per-line anchors at baseline (it is added by the separate diff-comments feature #1288; if that lands first, T06 may use its line anchors — optional).

**6.6 Composer insertion feedback.** After "Ask agent to remove", the sheet stays open and a shared Toast says "Added a request to the composer" (6 s, pauses on hover/focus).

**6.7 Copy.** Exactly the UX copy table. Buttons name the action; errors name the failure and recovery (DESIGN.md copy checklist).

### 7. Motion (DECIDED; DESIGN.md motion tokens)

| Element | Motion |
|---|---|
| Sheet open/close | The shared `Modal` motion unchanged (no custom keyframes). |
| Findings rows on first open | List insert: 180 ms opacity 0→1 + translateY(4px→0), ease `var(--ui-ease-enter)`, 30 ms stagger per row, max 150 ms total delay (rows after the 6th appear with the 6th). Only on first open, never on re-check refresh. |
| Rows removed after re-check | List remove: 140 ms opacity→0 + height collapse, ease `var(--ui-ease-move)`; new rows use the insert motion without stagger. |
| Status line text change | 160 ms crossfade (`--ui-motion-status`). |
| Clean re-check | One 240 ms success pulse (`--ui-motion-success`) on the `ShieldCheck` icon (opacity .6→1 and scale .9→1 on the icon only, never on text); header icon crossfades from `ShieldAlert` to `ShieldCheck` in 160 ms. |
| Re-check pending | `RefreshCw` icon rotates 360° per 800 ms linear only while pending and only after the 150 ms delay; stops immediately on result. |
| Row hover/focus background | 120 ms color (`--ui-motion-hover`). |
| Button press | 80 ms, scale .97 (`--ui-motion-press`), no layout shift. |
| Primary label change (anyway → plain) | 160 ms crossfade of the label; width does not animate (button min-width holds the longer label). |
| Reduced motion (`prefers-reduced-motion: reduce` or app Motion = Reduced/Off) | No translate, scale, rotation or stagger; opacity transitions ≤ 80 ms; spinner replaced by static text "Checking…". |

No bounce, no idle animation, no artificial waiting (the sheet appears as soon as the refusal arrives).

### 8. Error, cancel, retry

- Cancel closes the sheet, leaves the commit/push not done, keeps all form inputs. No store write.
- Approve → `approveSecretScan` → `retry(approvalId)`. If the retry returns `SECRET_APPROVAL_INVALID` or a new `SECRET_DETECTED`, the sheet updates in place with the new result (rows diffed by `id`), checkbox resets, status "Still N findings".
- Network/other errors during approve/retry show `.error-text` inside the sheet footer; sheet stays open.
- `SECRET_SCAN_FAILED` opens no sheet; the surface shows its normal error alert with the R16 copy.
- `uncertain` outcomes are unchanged (existing inspect flow).

### 9. Security boundaries

- Approval creation is a user-only HTTP route (R10). Runtime tool inventories are unchanged; T05 adds a test asserting no runtime tool schema mentions `secret-scan` or `secretApprovalId` (search the tool registries named in T01).
- The scan reads only through existing git wrappers inside the managed worktree guard (`withGitOperation` / `managedWorktree`), so no new filesystem authority.
- Secret values exist only in scanner memory for the duration of the call; the result object is built from masked previews and HMAC fingerprints.
- Logs: any log line produced by the service passes `createSecretRedactor([])` plus the scanner's own masking.

### 10. Migration / rollback

Flag off → everything inert; stored scan/approval records are ignored and pruned after 24 h. No schema migration of existing records. Removing the feature = remove the flag gate; payload field is optional.

## EXECUTION_DAG

| ID | Goal | Depends | Edits / discovery | Tests (positive / negative) | Done when | Handoff |
|---|---|---|---|---|---|---|
| T01 | Discovery (read only) | — | Answer with file:line in one checkpoint comment: (1) where source-control settings are persisted and how the host reads a UI preference (search `pull-request-merge-method`, `automatic-pull`); (2) constructors of `ProjectTools`, `SelectiveCommitService`, `GitHubTools` in `apps/server` for injection; (3) confirm no runtime/host tool commits or pushes (search `packages/runtime-*`, `packages/core`, `packages/agent-projection`); list tool registries for the T05 negative test; (4) whether the web generates a fresh action `id` per commit/create attempt (`ProjectContextCard` `onAction` caller in `App.tsx`, `PullRequestsBody` perform); (5) a reusable hover-row class and a destructive button class; (6) whether `DiffBody` can scroll to a file; (7) merge status of PRs #1291/#1293 and whether #1272 UI landed | n/a | Comment posted and re-read on this issue | T02–T07 |
| T02 | Flag + setting | T01 | `packages/core/capability-flags.ts`: add `workspace.secretScanV1` (own `SECRET_SCAN_FLAG_KEYS` const + union member, or into the M08 group — follow the pattern #1293 used for `workspace.publishV1`; description "Scan commits and pushes for secrets and require user approval for findings."). Settings row `["secret-scan", "Check for secrets before commit and push", "source-control", "secret scan api key token leak credentials commit push block"]` in `settings-inventory.ts` + control in `Settings.tsx` per T01 (1), default on, confirm-to-disable dialog (shared `Modal`), host-readable value | Unit: flag default false; env override `HARNESS_FLAG_WORKSPACE_SECRET_SCAN_V1=1` enables; setting default true; setting hidden when flag off; disabling writes `secretScan.disabled` audit | `pnpm typecheck`, `pnpm lint`, `tests/host-capability-flags.test.ts` + new settings test pass | T05, T06 |
| T03 | Pure scanner + rules | — (parallel with T02) | New `packages/workspace/secret-scan.ts` (scanner part only: parsing §2.1, rules §2.2, filters §2.3, preview §2.4, fingerprint fn taking a key param §2.5, result §2.7). Add to `scripts/public-source-files.json` | New `tests/secret-scan.test.ts`: per rule ≥1 positive and ≥1 negative fixture; **fixtures are generated at runtime** (e.g. `'gh' + 'p_' + seededRandom(36)`) so no realistic token literal is committed (avoids GitHub push protection and self-detection); placeholders/markers/lockfile-generic skip; line numbers across multiple hunks and files; `/dev/null` deletions ignored; untracked synthesized patch; binary/`not-utf8`/caps → `skipped`/`incomplete`; preview never contains more than 6 chars of the value; fingerprint stable and path-sensitive; ReDoS: each regex on a 100 KB adversarial line completes < 50 ms; 256 KiB diff < 150 ms | Tests pass; reviewer confirms no committed literal matches any high rule (`node -e` run of the scanner over the PR diff itself) | T05 |
| T04 | Contracts | T01 | New `packages/contracts/workspace-secret-scan.ts` (§4); export pattern per `packages/contracts/index.ts`; add `secretApprovalId` optional to `commit` and `create-pr` payloads in `workspace-action-outcomes.ts`; manifest entry | Unit: schemas accept valid, reject NUL/invalid unicode/oversize/bad fingerprint; existing outcome schema tests still pass | Lands in the same PR as its first reader (T05) per #1235 convention | T05 |
| T05 | Host service, enforcement, routes | T02, T03, T04 | `secret-scan.ts` service part (key file, store records, setting read, `checkCommitStaged`/`checkCommitPatch`/`checkPush`, approval validation); inject per T01 (2); call sites `tools.ts` gitAction commit, `selective-commit.ts` commit, `github.ts` create push (§3); `action-outcomes.ts` not-applied `reason`; `workspace-routes.ts` `/actions` 409 mapping + two new routes | New `tests/workspace-secret-scan.test.ts` with a temp repo (pattern `tests/github-workspace.test.ts`, fake gh): staged token → `SECRET_DETECTED`, HEAD unchanged, intent `not-applied`; approve → retry with new id commits; extra finding after approval → `SECRET_APPROVAL_INVALID`; expired (fake clock 16 min) → invalid; reuse of used approval → invalid; `acknowledgedHigh:false` with high finding → 400; fingerprint subset → 400; selective commit with token hunk refused, other hunk alone succeeds; push A-adds/B-removes refused before any `git push` (fake gh records no push); incomplete scan (201 commits) blocks and is approvable; scanner throws → `SECRET_SCAN_FAILED`, nothing written; setting off → baseline; flag off → baseline and `secretApprovalId` → `CAPABILITY_DENIED`; no runtime tool exposes approvals (registries from T01); store records contain no raw value (assert the generated token string is absent from `JSON.stringify(store dump)`); route CSRF/origin enforced (pattern `tests/workspace-action-outcome-routes.test.ts`) | All new tests + `tests/selective-commit-v3.test.ts`, `tests/github-workspace.test.ts`, `tests/workspace-action-outcomes.test.ts`, `tests/workspace-action-outcome-routes.test.ts`, `tests/project-context-committed-action.test.ts` pass | T06, T07 |
| T06 | Secret check sheet UI + wiring | T05 (routes), T01 (5)(6) | New `apps/web/src/SecretCheckSheet.tsx`, `apps/web/src/secret-check.css`, `apps/web/src/secret-scan-api.ts` (manifest entries); wire into `ProjectContextCard.tsx` commit and `WorkspaceSurfaceBody.tsx` `PullRequestsBody` create-with-push; "Ask agent to remove" via the composer draft owner in `App.tsx` (insert, never send; find the existing insert path used by `preparePR`); visual §6 and motion §7 exactly | Playwright `tests/e2e/secret-check.spec.ts` with route mocks (pattern `m08-pr-checks.spec.ts`, `shared-panels-fixture.tsx`): commit with mocked `SECRET_DETECTED` opens sheet with grouped rows, badges text, masked previews; initial focus on Cancel; primary disabled until checkbox when high; approve → retry carries `secretApprovalId`; re-check clean → "No secrets found" and plain "Commit"; Cancel keeps commit message; Ask agent inserts the exact R13 text without values and does not send; Escape closes; push variant shows guidance and commit suffix; narrow 400px layout stacks; reduced-motion: no transform in computed styles; light/dark screenshots; `pnpm lint` (UI guard, numeric JSX) passes | Spec passes; `pnpm lint`, `pnpm typecheck` pass | T08 |
| T07 | Publish integration (#1235) | T05; PR #1291 merged (else BLOCKED, re-check at each checkpoint) | `packages/workspace/publish.ts`: map step `not-applied` with `reason.code` in the secret set into the operation step error; `PublishRequestV1` gains `secretApprovalIds?: {commit?: id, push?: id}` passed to the `commit` / `create-pr` payloads; `PublishReview.tsx` (from #1272) opens the sheet with scope by blocked step and "Publish anyway" | Extend `tests/workspace-publish.test.ts`: staged token → commit step not-applied with reason, no push; approval → publish completes; push-only secret (already committed) → push step blocked; Playwright publish variant in `secret-check.spec.ts` | Tests pass; cross-post checkpoint on #1235 | T08 |
| T08 | Real-user verification | T06 (and T07 if unblocked) | Windows x64 source build (`pnpm install`, `pnpm build`, run app), flag via `HARNESS_FLAG_WORKSPACE_SECRET_SCAN_V1=1`, throwaway GitHub repo, signed-in test account. Scenarios: commit with a revoked/synthetic token in `.env` → blocked → Ask agent → agent removes → Re-check clean → commit; approve a medium JWT test fixture → commit; push of two commits (add then remove) blocked; setting off → commit proceeds | Manual evidence | Redacted screenshots + short screen recording + exact steps posted on this issue (PASS/FAIL per scenario) | T09 |
| T09 | Docs | T08 | `CHANGELOG.md` entry; `docs/progress.md` row text for the flag (where M08 flags are listed) if that is the repo convention; Settings help text; `pnpm check:docs-links` | Docs lint | Merged with T08 evidence linked | T10 |
| T10 | **Front end team review (required by the owner)** | T06, T07 (if done), T08 | Hand the finished UI to Leonardo's front end team for review: post a HANDOFF checkpoint on this issue addressed to the front end team with the PR link(s), the plan revision, light/dark and narrow screenshots, the reduced-motion recording, and the list of §6/§7 decisions to check; request review on the UI PR. Apply requested changes in follow-up commits. | Front end team posts its verdict | Front end team verdict (approve or change list resolved) posted on this issue | Owner (Leonardo) |

**Parallel scopes.** T02 (flag/settings files), T03 (`secret-scan.ts` scanner section), T04 (contracts) touch disjoint files and can run in parallel after T01 (T03 needs nothing from T01). T05 owns `tools.ts`, `selective-commit.ts`, `github.ts`, `action-outcomes.ts`, `workspace-routes.ts` and the service section of `secret-scan.ts`. T06 owns the new web files plus the two wiring points in `ProjectContextCard.tsx`, `WorkspaceSurfaceBody.tsx` and `App.tsx`; coordinate on `App.tsx` with any active #1235 T06 worker via that issue. T07 owns `publish.ts`/`PublishReview.tsx` changes only.

**PR shape (DECIDED).** PR 1: T02. PR 2: T03 (+ T04 schemas only if needed by tests). PR 3: T04+T05. PR 4: T06. PR 5: T07. PR 6: T08 evidence + T09 docs. One concern per PR per CONTRIBUTING.md; each links this issue.

## VALIDATION

- **Setup**: Windows x64 (or Linux for unit tests), Node ≥ 24.10.0, pnpm 10.30.3 (README); `pnpm install`; `pnpm exec playwright install chromium`.
- **Commands**:
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm build:widgets && pnpm exec vitest run tests/secret-scan.test.ts tests/workspace-secret-scan.test.ts tests/host-capability-flags.test.ts tests/selective-commit-v3.test.ts tests/github-workspace.test.ts tests/workspace-action-outcomes.test.ts tests/workspace-action-outcome-routes.test.ts tests/project-context-committed-action.test.ts --maxWorkers=1`
  - when T07 runs: add `tests/workspace-publish.test.ts`
  - `pnpm build && pnpm exec playwright test tests/e2e/secret-check.spec.ts tests/e2e/m08-pr-checks.spec.ts`
  - `pnpm check:docs-links` when docs change
- **Fixtures**: runtime-generated tokens (never literal); temp git repo with fake origin and fake gh (pattern `tests/github-workspace.test.ts`); Playwright route mocks.
- **Regressions**: flag off → all existing commit/PR tests unchanged; setting off → baseline; existing redaction tests (`tests/secret-redaction-json-v3.test.ts`, `tests/github-output-redaction-v3.test.ts`) still pass.

**Acceptance matrix**

| Req | Task(s) | Check |
|---|---|---|
| R01 | T02, T05 | flag default false; flag-off baseline tests |
| R02 | T02, T05 | setting default on; off → baseline; disable audit |
| R03 | T05, T07 | commit/selective/publish commit refused with token |
| R04 | T05, T07 | push A-add/B-remove refused before push |
| R05 | T03 | added-lines-only, untracked, binary skipped, caps |
| R06 | T03 | per-rule positive fixtures |
| R07 | T03 | placeholder/marker/lockfile negatives |
| R08 | T05, T06 | approve → retry succeeds; changed findings → invalid |
| R09 | T03, T05, T06 | incomplete blocks and is approvable |
| R10 | T05 | route-only approvals; no runtime tool exposure |
| R11 | T03, T05 | raw value absent from store/errors/draft |
| R12 | T06, T07 | sheet opens from each surface |
| R13 | T06 | exact draft text, no values, not sent |
| R14 | T06 | re-check clean → plain action, no auto-run |
| R15 | T06, T10 | keyboard/focus/live region tests; front end review |
| R16 | T05, T06 | scan failure refuses; inputs kept |
| R17 | T03 | benchmark + ReDoS tests |
| R18 | T05 | store records masked |
| Visual §6 / Motion §7 | T06, T10 | Playwright screenshots, reduced-motion check, front end team verdict |

**Release gate**: all commands above green in CI; T08 evidence posted; T10 front end team verdict posted; owner approves turning the flag on. **Planned tests are not executed yet** (planning only).

## STATE

- Researched/decided: this plan r1. Implemented: none. Verified: none.
- Owners: none assigned; branches for code: none. This plan's docs branch: `devin/secret-check-before-commit-plan`.
- Pending: owner go-ahead for implementation; PR #1291/#1293 merge (gates T07 only).
- Risks: (1) false positives annoy users → medium rules limited, placeholder filter, inline marker, per-scan approval; (2) agent terminal commits bypass the check (documented out of scope; hook follow-up); (3) outcome reason propagation touches shared `action-outcomes.ts` used by #1235 — keep the change additive (optional `reason`); (4) rule regexes may need tuning — id/label/confidence fixed, pattern edits recorded in PR.
- Exact next step: T01 discovery by the first implementing worker after the owner approves implementation; T03 can start in parallel.

## REFERENCES

- GitGuardian, *The State of Secrets Sprawl 2026* (Claude Code-assisted commits leak at 3.2% vs 1.5% baseline; AI-service key leaks +81%): https://blog.gitguardian.com/the-state-of-secrets-sprawl-2026/
- gitleaks (rule format and `gitleaks:allow` inline marker convention): https://github.com/gitleaks/gitleaks
- GitHub secret scanning push protection (block-then-bypass-with-reason model this plan mirrors locally): https://docs.github.com/en/code-security/secret-scanning/introduction/about-push-protection
- GitHub token formats (prefixes `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`): https://github.blog/engineering/platform-security/behind-githubs-new-authentication-token-formats/
- Repo: `DESIGN.md` (motion tokens, popup/modal rules, copy checklist), `CONTRIBUTING.md`, `.github/pull_request_template.md`, `docs/progress.md` (M08 row: flags off, not verified), issue #1235 and PRs #1291/#1293, issue #1288 (diff line anchors, optional for §6.5).
- Batch 3 proposal row (verbatim): "Secret check before commit and push (M) | Scan the staged diff for API keys and tokens and block the commit until the user removes them or explicitly approves | Claude Code-assisted commits leaked secrets at 3.2%, against 1.5% overall, and AI-service key leaks rose 81% (GitGuardian 2026). The repo has no secret scanner | packages/workspace/selective-commit.ts, tools.ts (gitAction), github.ts (push), commit UI".
