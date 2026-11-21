# Gen-V1 agent instructions

## Start here on every task

Use GitHub Issues to coordinate work on `skytuhua-org/Gen-V1`. Apply these rules automatically when you start or resume a repository task, whether you run locally or in the cloud. Use the user's normal assignment as input. Discover the issue and identify yourself without asking for a startup prompt, issue number, label, or worker name.

1. **Find the work.** Follow any issue or PR link in the assignment. Otherwise check the current branch, its PR and linked issues, then search open issues and PRs using distinctive words from the task. Compare the requested outcome and acceptance criteria before reusing an issue. A keyword match alone is insufficient. Read the matching issue body, latest comments, and linked PRs. An explicitly assigned issue takes precedence. For a session resuming without a new request, check its existing issue and outstanding handoffs addressed to it. Use the worker name and the open-issue search qualifier `in:comments` to find such handoffs across issues.
2. **Reuse or create one issue per task.** If authorized work will change the repository, run a requested review or verification, or require a handoff, use the matching issue. If none exists, create one with a descriptive title, the requested outcome, scope, and observable completion criteria. Keep simple questions and private investigations in their original context. Respect any explicit instruction to keep the work local. When there is no assignment or accepted handoff, leave the backlog alone.
3. **Identify the session.** Use the tool and execution location, plus an existing non-sensitive account alias where known. Append a short, locally generated random suffix when starting a new session, for example `devin-a-cloud-9f31a2` or `codex-local-b47280`. On resume, reuse your own recorded name if the session history identifies it. If identity was lost, introduce a fresh name and reference the existing branch and issue. If the account alias is unknown, omit it. Never derive a public name from credentials, emails, private session URLs, or machine paths.
4. **Claim a scope before editing.** Post one issue comment containing your worker name, role, exact scope, and branch or PR when available. Refresh the thread after posting. Honor the maintainer's assignment first. For overlapping, equally authorized claims, the earliest GitHub claim owns that scope until release or reassignment. Other workers can review or claim distinct work within their assignment. When two sessions create duplicate issues concurrently, link both, continue in the earlier matching issue, and release the duplicate claim. Avoid treating an old or silent session as having released work.
5. **Use the available GitHub connection.** Prefer the configured integration or authenticated GitHub CLI. Useful commands are `gh issue list --repo skytuhua-org/Gen-V1 --state open --search "<keywords>"`, `gh issue view <issue-url> --comments`, and `gh issue comment <issue-url> --body-file <message-file>`. Confirm GitHub accepted a claim or update before reporting it as posted. On a write timeout, reread the thread before retrying. If access fails, state the failed operation in the current session, retain the pending update, and continue independent work where ownership is clear.

## Complete Markdown plan publication: normative contract

TRIGGER: User asks to publish an agreed feature/research/design/execution plan to a GitHub Issue, including requests to create a detailed .md plan and place it on an issue. Apply this even in planning-only sessions *if* these repository instructions are loaded. Do not implement when only planning/publication was requested. Do not require a second startup prompt or manually supplied issue number. A standalone ChatGPT conversation without this repository context is not guaranteed to load AGENTS.md.

PLAN-SOURCE: Create a real UTF-8 .md document before publication. Its content MUST preserve every agreed requirement, exclusion, design/UX decision, technical constraint, dependency, implementation step, example/snippet, test, acceptance criterion and relevant researched fact. If a user supplies a plan, retain all substantive sections; do not silently compress, simplify or redirect to a private chat. Omit secrets, private conversations and unrelated material. Never invent repository paths, test results, interfaces or decisions; identify unknowns as explicit discovery/verification work.

REQUIRED PLAN FIELDS (populated, not placeholder headings):
- META: feature title, repo, plan revision/date, baseline branch + verified SHA, existing issue/PR links, current implementation status, source provenance.
- OBJECTIVE: user problem, intended behavior, relevant context and measurable success.
- REQUIREMENTS: all in/out scope, concrete user flows, agreed decisions vs proposed options, UX, compatibility, performance/security/privacy/accessibility and error/recovery requirements.
- REPO_MAP: verified relevant files/components/types/APIs/tests, open/merged work and integration status. Mark unverified locations as discovery, not facts.
- DESIGN: architecture, data/control flow, contracts/schema/state transitions, error/cancel/retry handling, security boundaries, migration/rollback and integration plan when relevant.
- EXECUTION_DAG: stable IDs T01..; each task: exact goal, dependencies, concrete edits/files or path-discovery procedure, inputs/outputs, independent ownership boundary, positive/negative tests, observable done-when and recipient handoff. Make low-level workers executable without unrecorded design choices wherever evidence permits.
- VALIDATION: reproducible setup/commands, fixtures, tests at relevant unit/integration/browser/real-user levels, expected outcomes, regressions, evidence collection, acceptance matrix, release gate. Separate planned from actually executed tests.
- STATE: researched/decided vs implemented vs verified vs pending, current owners/branches, failed/blocked work if known, risks, exact next step.
- REFERENCES: working repository/design/research/decision links and necessary substantive context from resources other agents cannot access; never "see earlier chat".

PREPUBLISH AUDIT: Every requirement maps to task ID + acceptance check; every task specifies prerequisites, executable steps, files or discovery, tests, done-when; parallel scopes do not overlap. No unresolved contradictions, missing context, fabricated outcomes, inaccessible essential artifacts, or dropped accepted details.

ISSUE PUBLISH:
1. Reuse matching issue or create appropriate issue. **The canonical issue BODY MUST contain the COMPLETE Markdown execution plan**, preserving tables, code, all task details and acceptance, not only a synopsis or attachment link. Short overview is optional *in addition to* complete source.
2. If supported, ALSO upload the actual .md file using a real GitHub issue file attachment and verify the resulting link resolves. Issue-body Markdown is NOT an attached file. Do not assert an .md upload succeeded when only text was pasted or when the client cannot upload that type.
3. If upload unavailable but authorized repo writes exist, commit an identical full .md source to a focused branch as docs/agent-plans/FEATURE-SLUG.md, open a reviewed PR and place a SHA-pinned file URL in the issue. The full issue body remains mandatory. Never bypass normal Git merge review. If not authorized, preserve full body and disclose that separate file attachment is unavailable.
4. If issue body/integration limits preclude full text, NEVER truncate without disclosure. Publish the verified full .md via attachment or commit-pinned repo file, put contents manifest + file SHA/link in body and (if supported) split *all* text into ordered continuation comments. Mark HANDOFF_INCOMPLETE until every section can be retrieved, and name missing parts.
5. READ BACK the issue, continuation comments and file; compare against source section by section for decisions, tasks, tests, snippets and acceptance. Report issue URL, plan revision, actual file link or exact attachment limitation, and verified HANDOFF_COMPLETE/INCOMPLETE. A successful API call alone proves nothing about completeness.

REVISIONS: Issue body is latest accepted plan. Whenever decisions/requirements change, update the **entire** canonical plan body and linked .md copy, increment revision, preserve prior SHA history, and add append-only change comment with affected task IDs. Never change requirements only in a progress comment. An agent reading the issue must have complete context without the original planning chat.

RECEIVER: Before execution read the **entire** issue, complete .md when present, all continuation/comments, latest revision, dependencies, acceptance, related PRs and latest journal. Verify all mandatory sections and artifact accessibility. Do not execute from summary/title alone. Missing/conflicting context -> recover from durable sources, record exact gap, BLOCK affected work; no invented decisions.

## Updates, lossless checkpoints and cross-agent handoff

CADENCE (mandatory for every active implementing/reviewing/verification worker): on START/RESUME; every completed task/milestone; before switching task IDs, delegation or handoff; immediately after blocker, material decision, changed requirement, unexpected failure or overlap; after branch push, draft/ready PR, CI result, review resolution, merge and post-merge verification; and before PAUSE/STOP. During uninterrupted active work, if no milestone for **20 minutes**, post a timestamped checkpoint. If host cannot keep time/notify autonomously, post after each substantial tool/test batch and before/after long-running commands instead; no imaginary real-time SLA or updates from stopped agents. Suppress duplicate heartbeat spam; every substantive checkpoint must remain resumable.

LOSSLESS-DEFINITION: a new worker with only the GitHub issue, canonical plan, linked versioned code/evidence and checkpoint history can resume without losing requirements/decisions/attempts, guessing unfinished steps, duplicating completed work or depending on private chat/model memory. Excludes unrecoverable hidden reasoning, credentials, unpushed local bytes and ephemeral tools. If any required context is unavailable, label HANDOFF_INCOMPLETE, never "lossless".

PERSISTENCE: plan = full issue body + versioned .md; code/test artifacts = Git branch/commit-pinned references; execution history = append-only issue comments. GitHub is the durable status ledger, not the worker's private session. Each substantive checkpoint MUST be a self-contained INDEX of current task/state/artifact references plus changes since PREV. A detailed prior attempt may be referenced by a stable permalink, never a vague "see above"; do not edit away earlier failures. Use UTC, worker-specific monotonically increasing CHECKPOINT sequence, prev comment link/ID and exact plan revision.

REQUIRED CHECKPOINT DATA (no omission of material data to meet compactness):
- IDENTITY: worker, issue, role, scope/task IDs, current plan revision, intended recipient, status per task/subtask NOT_STARTED/IN_PROGRESS/IMPLEMENTED/VERIFIED/BLOCKED/HANDOFF_PENDING/DONE, and per-criterion acceptance evidence. Separate code written, tests passed, PR merged and verified-on-main.
- SOURCE: repo; base branch@SHA; current branch@HEAD SHA; PR/review/merge/CI states; created/modified/deleted paths; clean/dirty/untracked/uncommitted state; pushed vs not-pushed; pending conflicts; SHA-pinned artifact references. If unpushed or uncommitted necessary bytes exist, push to an authorized isolated branch or publish safe retrievable patch; otherwise HANDOFF_INCOMPLETE (state inaccessible). Never pretend a floating link or private filesystem is sufficient.
- DECISIONS: accepted/rejected designs, proven vs hypothetical assumptions, implementation deviations, interface/schema/security choices, scope and requirement changes with rationale and affected task IDs. Apply agreed requirement changes back to full plan.
- VERIFICATION: exact executed commands, directory, material environment/fixture versions, result PASS/FAIL/SKIP/NOT_RUN and counts, error details, relevant check/PR/log links, persistent redacted evidence and remaining regression/real-user checks. Queued CI != passing; mocks != live authenticated verification.
- HISTORY: specific work/attempts since prior checkpoint, failures and attempted fixes/rollbacks, hypotheses vs verified causes, previous blockers still outstanding, recovery paths and referenced previous checkpoint URLs; never erase failed attempts to make progress appear clean.
- NEXT: exact executable action (target file/command/investigation), prerequisite, required verification, responsible worker, known blocker, handoff recipient and ACK status. If pause, include all unfinished tasks and next takeover entry point.

COMPACT COMMENT WIRE FORMAT (extend as required for losslessness):

    [worker-id] CHECKPOINT NNN | UTC=ISO8601 | PLAN_REV=id | STATUS=IN_PROGRESS|BLOCKED|PAUSED|REVIEW|HANDOFF_PENDING|DONE
    PREV=permalink|NONE; ISSUE=url; OWNER=worker; RECIPIENT=worker-or-role|NONE
    TASKS=T01:VERIFIED[criterion/evidence],T02:IN_PROGRESS[remaining],T03:BLOCKED[dependency],...
    SOURCE=repo; BASE=branch@SHA; HEAD=branch@SHA; TREE=CLEAN|DIRTY|UNKNOWN; PUSHED=YES|NO; PR=url/state; FILES=paths
    DELTA=exact edits/decisions/attempts; HISTORY=prior immutable comment+artifact URLs; TESTS=cmd,result,fixtures,logs
    ACCEPTANCE=per-criterion states; BLOCKERS=causes/hypotheses/recovery; NEXT=action,owner,prerequisites,test
    ARTIFACTS=SHA-pinned links; UNAVAILABLE=any local/unpublished source; HANDOFF=PENDING|ACKNOWLEDGED|UNREQUESTED

A checkpoint is NOT complete until GitHub accepts it and the worker rereads the posted text; on timeout reread before retry. Failed writes -> retain pending journal and report publish failure in current session. Do not mark task DONE without actual acceptance evidence. Keep entire task matrix in latest substantive checkpoint, with references to durable history where needed; a brief heartbeat is not a substitute for the required PAUSE/HANDOFF/STOP snapshot.

PARALLELISM: Every worker writes to the **same canonical parent issue**, using stable task IDs and uniquely named worker ID; optional sub-issues only for isolated tasks and must link back. The coordinating worker consolidates current task ownership and latest checkpoint links after material handoffs, but must not invent other agents' progress. Refresh issue before altering shared files. Earliest authorized overlapping claim owns the scope until explicit reassignment.

HANDOFF SEND: Publish full current-state checkpoint + exact plan revision + retrievable source/evidence + remaining task IDs/acceptance + first executable next step and recipient. Never call an unpushed branch, unsaved diff, expired artifact, inaccessible attachment or missing instructions a complete handoff. HANDOFF_PENDING until receiver posts ACK.
HANDOFF RECEIVE: Read canonical plan + whole journal, verify SHA/files/CI states, confirm task ownership, explicitly ACK with picked-up task IDs and starting SHA, then execute. If not reproducible, comment HANDOFF_BLOCKED with exact missing data and recover before work. Status updates and acceptance go on the same issue; keep PR line-level comments in the PR and summarize on issue.
PR/FINISH: report focus, commit SHA, exact tests and skipped checks, CI/reviews and remaining gates. Never equate ready-for-review, merged and verified. Close issue only when acceptance is met and closure authorized.
RELEASE (mandatory, no exceptions): whenever a worker stops working a scope for any reason — DONE, REVIEW, PAUSED, BLOCKED, handoff, error, or session end — its final act on that issue is a RELEASE checkpoint setting `OWNER=NONE`, plus clearing its assignee and in-progress labels. Until a RELEASE posts, the issue reads as actively claimed and no other worker may take it, even if the owner is silent. A worker unable to post must say so in its own session output so a coordinator can release on its behalf; never leave a stale claim behind.

## Implementation, review, and completion

Follow [CONTRIBUTING.md](CONTRIBUTING.md) and the [pull request template](.github/pull_request_template.md). Start from current main for new work, preserve other workers' edits, use an isolated branch or worktree for concurrent changes, and keep one concern per PR. Follow the contribution guide's contract, source manifest, testing, licensing, and evidence requirements for the files you touch.

Link the PR to the issue. Report the commit, checks run and results, skipped checks and reasons, remaining acceptance criteria, and the next owner when applicable. Keep “ready for review,” “merged,” and “verified on main” distinct. Close the issue only when its agreed completion criteria are met and closure is authorized. Respect review and merge protections.

Example issue comment:

> [devin-a-cloud-9f31a2] Handoff to the Windows desktop verifier. PR #123 is ready at commit abc1234. Unit tests pass. Reopen a saved thread in the Windows build and report whether its messages reappear.

> [kiro-local-64a07c] Picked up Windows verification for PR #123 at abc1234.
