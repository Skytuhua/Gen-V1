# Additional vertical merge-conflict reference

Source: ScreenRecording_10-31-2026 11-47-35_1.mov, SHA-256 de8ccb7c822c115febb3c6fbabea2eaf261a2c70673a400754d006bdbc799c70.
Duration 30.498345 s; H.264 960 x 2080; 1,176 variable-rate source frames (nominal ceiling 60000/1001, average about 38.56 fps). The desktop app is letterboxed inside a phone screen recording. Do not treat these recording pixels as CSS pixels or app camera motion.

## Inspection

Inspected the full overview and all 30 all-source-frames-NN.png contact sheets, which retain source order and PTS labels, 40 consecutive source frames per sheet (last sheet padded). No frame interpolation. These sheets supersede the earlier consecutive-NN.png extraction, where vfr output dropped some whole sheets. The timing ranges below are observed phase windows, not recovered CSS or proof of equivalent implementation timing. App content disappears around 29.4 s; the last second is not a UI completion transition.

## Layout

- One rounded, compact PR card with title / PR number at top left and Open / Merged at top right.
- Vertical commit history with small colored dots, curved connecting paths, dimmed unaffected history, short labels and branch tags. Hash / author / relative time form a quiet right-aligned column.
- Card edges approximately x=55..895; composer approximately x=60..900 in the 960-pixel frame. Both occupy about 840 pixels, with a few pixels of camera/crop tolerance. This directly supports matching the inline artifact outer width to the composer, rather than allowing artifacts to exceed it.
- Footer status stays left and the single useful action stays right. Conflict comparisons and check details appear on demand; no permanent verbose report.

## Consecutive-frame choreography

| Recorded PTS | Observed behavior |
| --- | --- |
| 0.00-0.64 s | Reading branch -> committing; status text crossfades while card and history stay in place. |
| 1.95-2.16 s | New test commit settles at the top; footer becomes pushing 3 commits. |
| 3.35-3.77 s | Opening PR adds a prospective merge row and grows / moves the graph as one history. Open appears at top right. |
| 5.40-6.61 s | Staging history arrives; existing rows move down and the staged branch is muted. Fetching -> checking. |
| 8.16-8.36 s | Three conflicts enter in amber: top merge point, affected rows, right-side count, footer status and Resolve conflicts action. |
| 8.58-8.83 s | Hovering the footer conflict count reveals three file/line comparisons, with amber peer vs blue You excerpts. |
| 10.38-10.48 s | Moving away closes the comparison popover; graph remains mounted. |
| about 11.38 s | Clicked Resolve conflicts remains in the same footer slot, disabled as Resolving... with spinner; no unrelated confirmation screen. |
| 11.44-11.78 s | New merge-staging-into-branch commit inserts under the prospective final merge. Connected paths and remaining rows move together. |
| 12.72-15.98 s | Resolving 1 of 3 -> 2 of 3 -> 3 of 3. Count and affected row emphasis change per supplied phase; action remains busy. |
| 16.00-18.78 s | Running N of 412 tests advances in the existing footer; original card and history remain visible. This visual alone cannot prove those tests executed. |
| 18.78-19.18 s | Ready / green summary arrives and resolves the amber merge indicator. Merge becomes available. Compact 4 checks passed summary stays next to the result. |
| 20.47-20.64 s | Hover opens a concise list of Tests, Types, Lint and Preview outcomes; it closes around 21.98-22.14 s. |
| about 22.85 s | Merge action stays in the same position and becomes Merging...; readiness details retreat while footer says Merging into staging. |
| 24.50-25.07 s | Merged result enters, branch / affected merge geometry becomes purple, final merge label settles, and footer action becomes a quiet GitHub link. |
| 25.07-29.36 s | Stable completion hold, no whole-card entrance replay. |

## Existing implementation comparison

Source-only comparison to apps/web/src/RelationshipGraph.tsx and relationship-graph.css: current renderer already has vertical geometry, nodes/paths driven by one geometry state, inserted rows, conflict excerpts/tooltips, muted history, busy child actions, status transitions and purple merged tone. This reference does not justify adding another graph renderer, scenario router or animation framework. The visible reference favors a compact checks-passed hover summary; current graph supports inline check chips with individual tooltip detail. No production change or current-renderer visual acceptance is claimed by this analysis.

## Scope

Only scratch analysis files under .harness-merge-reference-20261031 were created. No source/test/config/package edits, installations, accounts, model inference or backend effects. The reference establishes visual behavior only.
