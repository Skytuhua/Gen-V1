# M15 feature comparison record (M15-S14)

Columns: input action, actual state transition, failure behavior, data owner, test IDs.

| Workflow | Input action | Actual state transition | Failure behavior | Data owner | Test IDs |
|---|---|---|---|---|---|
| Select assistant text | Drag a visible selection inside a message | Toolbar (Ask / Attach / Open) appears for the exact UTF-16 canonical range | Hidden, clipped, cross-owner or ambiguous selections produce no toolbar/ref | Host `SourceWorkbench` + `SourceSelectionActions` | source-selection-dom-v3, M15-D04 |
| Ask about this | Toolbar Ask | CAS-writes `Explain this selected source.` into the existing draft; source chip attached; submit counter stays zero | Rejected or fenced writes keep prior draft; nothing is sent | Journal (`draft:` key) + source draft metadata | M15-D02 |
| Attach to prompt | Toolbar Attach | `api.capture` → validated `SourceRefV1` chip in `updateSourceDraft`; draft text preserved | Forged/stale IDs and oversized selections rejected; no chip materializes | Host capture store (`sourceCapture`) + journal | source-workbench-host-v3, M15-D04 |
| Open source | Toolbar/chip Open | Reads the retained captured version; reports CURRENT or STALE against a fresh describe | Unavailable source shows Unavailable; never silently shows current file | Host `sourceCapture` records | source-workbench-host-v3, M15-D05 |
| Refresh / Keep captured | Chip actions | Refresh re-captures at current revision; Keep pins captured bytes for the send | Refresh of an atomic-only kind stays SOURCE_UNSUPPORTED | Host `sourceCapture` | source-workbench-host-v3 |
| Send with sources | Composer send NOW / AFTER_CURRENT | Durable `message.send` through Service; queued input persists then dispatches on settle with next epoch | Stale source aborts send; queued source re-validated; foreign-owner send denied CAPABILITY_DENIED | Service outbox + host admission | M15-D02, M15-D05 |
| Owner switch / handoff | Switch task or hand off | Journal flush; conflict copy kept when acknowledgment uncertain; late old-owner writes fenced | FLUSH_FAILED / ACKNOWLEDGMENT_UNCERTAIN surfaces; no background overwrite | Journal generations + owner fence | workbench-recovery-v3, M15-D03 |
| Retired surfaces | Create code-review/research/custom canvas | Rejected with PRESET_RETIRED; only workspace/all-agents create | No retired host is instantiated | `WorkspaceRepository` | M15-D01 |
| Optional module panels | Open module panel | Rendered through owning module contract (M04–M14 evidence states) | Absent contract shows Unavailable, no fake controls | Owning modules | source-workbench-host-v3 |
| Long output | Scroll / search / copy | ≤300 mounted rows with logical anchor; copy/search hit the authorized full read model | Partial reads never copied/searched as complete | `workbench-window` + host read | workbench-performance-v3, M15-D06 |
| Restart | Relaunch host on same store | Retained captures reopen CURRENT; drafts and view state reload | Captures outside their owner or grant fail closed | Store + journal | M15-D05, M15-D06 |

Visual styling remains on the existing design system; no palette or theme changes were made.
