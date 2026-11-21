# M12 implementation plan

## Source and authority

Worktree: `/workspace/scratch/dbebe44a9817/m12-v3`, branch `agent/m12-v3`.
Accepted upstream base: `fcaa52f7fcdc9f39420118a79f9a8250ba83c563`.
Audit ancestor: `a7fc0bc7db6ba3e9922b83932aa0aa8490a6fb54`.
The two existing audit commits and their failed attempts are retained.

The renewed user instruction authorizes resolving implementation blockers and opening a PR. The prerequisite work below is explicitly part of this continuation. It does not imply acceptance of an unmerged M04 branch or approval to enable production execution. No merge, deployment, force update, account change, or modification of another worktree is authorized.

## Global constraints

Only the host writes SQLite. Store callbacks are synchronous. Every nested call uses host M02 classification, exact owner checks, progressive disclosure and current grants. Model-visible results contain only an explicit aggregate and authorized references. Source bytes, raw arguments and intermediate results stay in private records. JavaScript and Python have separate default-off flags; durable replay has its own flag. No interpreter, worker, timer, mock, manifest or RPC allowlist alone counts as a confinement proof. Preserve native histories, accounts, run epochs and cancellation.

Limits: 30 seconds per program/cell, 64 nested calls, 4 concurrent admitted reads, 256 KiB visible output and a backend-verified 128 MiB executor memory target. Smaller limits may be supplied for a run; none may increase these ceilings. Unsupported platforms remain disabled and are reported separately.

## Stages

1. Write and run failing protocol fixtures, then add strict ToolProgramV1, NestedCallV1, ProgramJournalV1 and PythonKernelV1 contracts. Register only the three requested M12 keys in the shared finite host registry.
2. Resolve required prerequisite boundaries with reviewed additive contracts: M02 complete owner/definition receipt matching and parent linkage; M04 owner-scoped host disclosure; M10 private immutable results, scoped handles and bounded range retrieval. Run current contract tests before connecting execution.
3. Implement the non-replaying host lane and a dedicated JavaScript backend using an existing pinned engine where possible. Verify actual isolation, bounded memory/output/time and cleanup before any backend is admitted.
4. Add deterministic durable replay after the non-replaying tests pass. Commit identities and delivery order before worker delivery. Exercise real process kills at each journal/call boundary; mismatch and uncertainty stop admission.
5. Implement an owner-scoped Python process through an actual M03 platform boundary. Verify interpreter identity and confinement. Persist kernel generations; cancel, wedge and process loss invalidate variables. Stop and Reset are distinct and never rerun cells.
6. Integrate host tools, commands, projections and UI with exact owner checks and separate flag gates. Add fixed aggregation and failure-overhead benchmarks, frontend/browser coverage and rollback.
7. Run all requested commands, preserve every failed attempt, update canonical ImplementationEvidenceV3 with separate CORE/INTEGRATION/PLATFORM outcomes, then perform an independent review against the original prompt and fix findings. Commit only reviewed bundle changes and publish the branch/PR under the renewed instruction.

## Review focus

Review late callbacks and cancellation races, call order and committed-count replay fences, full owner and definition matching on receipt reuse, hidden-name and grant revocation denial, UTF-8/output limits, kernel identity and generation changes, process cleanup, private data in Store events/snapshots, and whether each claimed backend bound has actual evidence. Check that frontend actions cannot enable flags or bypass host commands. Review source compatibility, package/lock integrity, exact command exits and all remaining platform gates.

## Progress and rulings

The continuation preserved the original checkout and the earlier audit commits. Missing concrete prerequisite boundaries were implemented and tested locally before integration. This does not claim that complete M04/M10 milestones were already accepted upstream.

| Stage | Implemented result |
| --- | --- |
| Protocol and prerequisites | Strict contracts, full-owner M02 receipt matching, local M04 disclosure, local M10 private results and descriptor-bound Linux reads. Original failing fixtures are retained. |
| Non-replaying JavaScript | Dedicated checked QuickJS WASM worker; immutable values, no ambient capabilities, host-only read bridge and declared guest limits. |
| Replay | Durable issued identities and delivery ordering, exact divergence diagnostics, receipt reuse and ten actual SIGKILL boundaries. |
| Python | Installed pinned interpreter through M03, namespace/syscall confinement, persistent owner-scoped process, supervisor-proven completion, generation and teardown custody. |
| Host and UI | Native transport metadata, authenticated projections/ranges, separate Stop/Reset, private inspection and host-only rollback. |
| Measurement | Actual fixed-workflow transcripts, exact arithmetic oracle, pinned offline token encodings and measured failure overhead. |
| Review and handoff | Independent original-prompt review, resolved runtime findings, final command records and exact source/artifact integrity. Repository-wide and platform results remain distinct from the passing focused suites. |

The supported memory scopes are QuickJS WASM linear memory and Python interpreter address space, each capped at 128 MiB. Whole-executor memory and a hard completion deadline for arbitrary host I/O remain unsupported. Unique input references are checked sequentially against a 4 MiB serialized aggregate, 100000-node and depth-64 budget before backend execution. Production flags remain false; actual target-platform and operator approval remain separate gates.

The authoritative final statuses, command exits, benchmark launch attribution, review dispositions, migration and rollback details are in `M12-verification.json` and `M12-handoff.md`. Historical failures remain retained even when a later correction or focused rerun passes.
