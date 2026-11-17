# Provisional C3 host and owner compatibility review

Reviewed at 2026-11-16T01:54:31.890133+00:00. Scope: immutable upstream changes from accepted C2 base `138b1356495bb3a2c9b35020240513f8faa84964` to proposed C3 base `49cd633273a3f61c14a4191a9877e99ab23ec88f`, compared with the frozen C2 M15 source. This review makes no change to the active C2 repository, plan, documentation, index or product. It runs no test, browser, build or merge. Notes are provisional until root publishes C2 and supplies the actual merged C3 candidate.

## Disposition

No incompatible host owner/send/read contract change was found in the six upstream commits. The direct M15 custody, storage, source guard, project tool and handoff dependencies inspected below are unchanged upstream. The significant integration work is in App composition and workspace transitions. One concrete UI guidance mismatch needs reconciliation: the new working-composer hint assumes ordinary text needs `/btw`, while C2 supports ordinary text in explicit `AFTER_CURRENT` mode.

| Identity | Immutable value |
| --- | --- |
| Accepted C2 base | `138b1356495bb3a2c9b35020240513f8faa84964` |
| Accepted C2 base tree | `9306faaa17bc1e34ae062b0e416ec2acb3606a43` |
| Proposed C3 base | `49cd633273a3f61c14a4191a9877e99ab23ec88f` |
| Proposed C3 base tree | `2ecdb4c95fc6b604159257a125064ad585b966e5` |
| Full upstream binary diff SHA-256 | `a15582b535a32de2bd305b62427445ed025a068c2b20b6ee6597fda66e810e6a` |

This delta contains 6 commits and 61 changed paths. The new main does not itself contain the M15 extension files; their frozen C2 digests are recorded separately in the companion JSON. Static compatibility does not imply that the conflict-resolved App or future merged tree has passed.

## Core, contracts and server compatibility

`packages/contracts/workspace.ts` retains the complete historical preset schema and adds a separate supported-creation predicate for Workspace and All Agents. Historical Code Review, Research and Custom records remain parseable. `WorkspaceRepository.command` now rejects new retired presets with `PRESET_RETIRED` and rejects the old exact-review-owner creation payload. Existing profile restore/save/apply and explicit selection of saved legacy records remain available. The transaction still changes layout state rather than thread identity, account, outbox, source captures or credentials. Legacy `canvas.select` review rebinding still checks the explicit thread/project/working-copy/revision and rolls back on failure.

The host must continue deriving M15 `LogicalOwnerV1` from the exact thread's `threadId`, `projectId` and working-copy `workspaceId`. A canvas ID, split pane ID, selected preset or active global thread is presentation state and is not a replacement for that owner. Retiring a canvas does not itself authorize rebinding retained source material.

The server delta only removes the Research route import and registration. `Service.command` research storage compatibility remains, and the changed upstream integration test explicitly expects the retired HTTP command endpoint to return 404. M15 source catalogue, capture, open, refresh, output and queued-input recovery do not call those Research endpoints. A bounded search of the M15 host/routes/contracts/panels/recovery/native-test files found no direct references to the removed hosts, retired Research URLs or workspace preset dispatch.

Keep `registerSourceWorkbenchRoutes` under the existing Host, Origin, authenticated session and CSRF hooks when merging server.ts. Keep the optional-service guard for composed hosts. No alias to a retired Research route is needed. `ARTIFACT_REGION` remains a declared, thread-owned structured artifact read and does not gain access to plug-in private data merely because the Visuals contribution is retired.

`useProjectContext` keeps its owner key, abort controller and generation fence while adding a malformed-shape rejection. It changes no M15 source-owner contract. Its response is presentation data; source capture authority must still come from the authenticated source host. The new fixture shape in `project-context-owner.test.ts` is required for its existing owner-switch assertions to reach the new valid-response branch.

## Handoff and retired UI boundaries

The new `WorkspaceHost` routes ordinary startup on a retired canvas to a supported workspace using an exact layout revision. Explicit retained-canvas recovery continues to render saved records without reconstructing the removed Research or Code Review hosts. PR hover now rechecks the exact thread/project/working-copy/revision, opens Workspace, and routes to the shared linked-pull-requests surface. Keep that new destination; do not restore deleted host imports or resurrect their browser suites to resolve an App conflict.

The retirement does not remove the supported `files`, `diff`, `output`, `plan` or linked-pull-request panel kinds. M15 can coexist with those generic surfaces. A surviving Diff UI is still not the atomic complete-comparison witness required by M15 capture. `DIFF_HUNK` remains unsupported; removing the old Code Review host is not a reason to weaken its revision guard or synthesize a substitute service.

The returning-native-thread change waits for canonical conversation split layout before consuming the return intent and calls the existing `select` path. That path goes through `placeSplitThread`, `journalFlush` and `prepareEditorHandoff`, rather than changing only the sidebar-selected ID. Preserve this path while retaining C2's `SourceWorkbenchProvider` scopes and active/held fences. Its owner generation includes account/epoch and active/native-held transitions; asynchronous descriptions and captures must not attach to whichever thread happens to become visible next.

The empty-main-pane fix now permits non-thread tools to mount while continuing to withhold an absent main thread. Keep that distinction. A tool tab must not create a new source owner or implicitly choose a thread for send/capture.

The new `SurfaceBoundary` wrappers isolate descendant render failures. Preserve C2's stable lazy component identity and explicit reload-to-retry behavior at the M15 module boundary. Do not assume a generic rendering retry reloads a rejected dynamic import or constitutes acknowledgement of pending journal writes.

### C3-HOST-01: working-state hint and explicit queued delivery

New main renders its working-state guidance for every nonempty ordinary draft that does not start with `/btw` or `/side`. C2's Composer intentionally admits that same ordinary draft when the source delivery mode is `AFTER_CURRENT` and displays **Queue after current**. A straight conflict resolution will present the side-question advice beside that valid queue action.

Reconcile the hint with the explicit delivery mode. Preserve the existing `message.send` transport, exact `sourceRefs`, original draft text, and `sendMode`; do not convert an ordinary queued message into a side question. A useful combined App regression should exercise a working thread, captured source, authored ordinary text and `AFTER_CURRENT`, assert the available action and matching guidance, and verify exactly one ordinary send with no implicit `thread.create` or `run.stop`.

## New-base source lock requirements

1. Preserve published C2 as an immutable historical cut with its 138 base, source hashes, failed attempts and passing reruns. Do not rewrite C2 receipts or reviews to say 49 was tested.
2. Pin the next accepted base to commit `49cd633273a3f61c14a4191a9877e99ab23ec88f` and tree `2ecdb4c95fc6b604159257a125064ad585b966e5`. Record the actual published C2 commit as the incoming branch parent once root has it. The C3 candidate head/tree must come from the reviewed merge, never from this provisional note or the old staged tree.
3. Recompute the C3 source delta and evidence manifest against the new base. Explicitly review merged App source, authenticated server registration, workspace preset compatibility, canonical split selection, the new SurfaceBoundary, and all frozen C2 M15 additions. Keep default `ui.sourceWorkbenchV1=false` and existing native capability gates.
4. Reconcile the public-source allowlist as a set: retain current main's deletions and new SurfaceBoundary, then include the M15 extension files and test/workflow additions. Do not restore deleted Research/Code Review files. The public-export manifest's own baseline remains `6d32290f4d0e4c820e6ed0c3eb56a4bd14f7891c` in both immutable upstream revisions; that field has a separate export contract and must not be blindly replaced with the M15 evidence base.
5. For a new exact-head Windows evidence workflow, bind checkout and embedded source records to the actual C3 head/tree and bind root comparison to the measured 49 baseline. Preserve absolute Node.exe invocation and attempt-specific receipts. The frozen C2 publication/ingestion helpers have fixed old-parent/base identities; a C3 helper needs a newly reviewed identity contract, not changed historical seals.
6. Lock the actual final source bytes before gates. Build first, then run the focused tests without a concurrent build because plugin-frame-custody writes its fixture into dist/web. Any later source repair creates a new tested cut and new receipt ID.

## Meaningful required gates after the merge

| Boundary | Required validation and what it resolves |
| --- | --- |
| Source and export integrity | Typecheck, UI policy with no exceptions, public-source/package validation, then build. Confirms deleted imports stay deleted and the new SurfaceBoundary plus M15 files are admitted. |
| Existing M15 host and rollback custody | Rerun the complete 24-file focused command with a new C3 receipt after build. Preserve the first-account witness, source/digest/grant/account fences, M04 one-shot rollback, journal retry identity, native skips and unrelated plugin-frame guard assertions. |
| Changed workspace ownership contracts | Run workspace-layout, project-context-owner, research-service-integration and upstream retirement coverage. Confirm retired creation rejects without mutation, saved bindings remain exact, 404 retirement is deliberate, and malformed/late project reads cannot become current owner data. |
| Source capture across layout-only changes | Add a narrow real-Service/Store case using a platform-neutral declared artifact capture, apply/select a retained legacy layout, and prove thread/account/working-copy/capture/outbox identities are unchanged. Rejection of new retired presets must not consume the source or create a send. |
| Native return plus M15 draft custody | Extend the canonical split/native bridge browser fixture with two distinct threads, a retained source and authored draft. Detach A, focus B, return A after layout readiness, and verify A/B isolation, exact source identity and no implicit send; cover a delayed source read that completes during the transition. This remains a bridge fixture, not installed-desktop proof. |
| Queued delivery guidance | Cover C3-HOST-01 using the production App and deterministic host HTTP. Preserve the existing queue command and retained text/sourceRefs. |
| Full affected browser surfaces | Current App/workbench, workspace-host retirement/PR routing, desktop-surfaces, split renderer, saved-layout chooser, shared overlays/controls and affected usage/context paths. Include retained-canvas draft preservation, empty-main tool mounting, SurfaceBoundary recovery and source selection/focus/IME/zoom behavior. Read each fresh result instead of borrowing C2 pass counts. |
| Actual target | Run the exact C3 Windows native file and Hermes source integration cases and actual Edge workflow. Keep Linux skips explicit. Native bridge mocks do not replace installed-desktop acknowledgement, file guard, session/history or scaling evidence. |
| Repository-wide disposition | Keep the independent full CI shards and any full local run separate from the focused gate. Existing C2 full-suite FAIL and diagnostics remain historical; they do not classify failures or award a pass to the new base. |

Do not expand M15 by reviving unavailable module services. The atomic diff witness, authenticated retained evidence reader and missing typed module integrations remain genuine gates until their owners supply compatible contracts.

## Recorded source evidence

The companion `c3-host-compatibility-review-01.json` records every reviewed immutable blob and SHA-256, the complete changed-path/commit inventory, 21 unchanged upstream custody dependencies, frozen C2 extension hashes, and the bounded retired-reference search. Its SHA-256 is `c64f91b26aa722b55735b752177d13598cf164bbaad5b6019ef8a8ef2b48ef5f`. These records are provisional review evidence only; no future merged result or target-platform PASS is claimed.
