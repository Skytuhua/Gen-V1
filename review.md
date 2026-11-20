# Worker 2 review films

Recorded from the actual renderer at git SHA `5c8b18eeed718cfd5ab2c696e0b668b14fe81a20` on branch `refine/developer-tools-data` (base `26ddf4d16c2fc1196b520d8a46c5441d64d01463`). All inputs are synthetic intercepted fixtures; no external service, credential or purchase is exercised.

| File | UI | Duration | Chapters | Verified outcome |
|---|---|---|---|---|
| 05-diagnostics.mp4 | 05 Diagnostics | 8.7s | 2.9s Opening · Review the check results; 4.8s Select a passing check; 6.9s Return to the failure; 7.5s Settled · same artifact and saved choices | Selection moves across the check inventory. |
| 06-change-set.mp4 | 06 Change set | 8.4s | 2.7s Opening · Review the proposed patch; 4.6s Second changed file; 6.5s First file again; 7.2s Settled · same artifact and saved choices | File strip switches the visible patch. |
| 07-api-explorer.mp4 | 07 API explorer | 8.4s | 2.8s Opening · Inspect the order API; 4.7s Select the conflict response; 6.6s Read endpoint; 7.2s Settled · same artifact and saved choices | Local response selection and endpoint switching. |
| 08-pipeline.mp4 | 08 Pipeline | 8.6s | 2.7s Opening · Review the release checks; 4.8s Blocked stage detail; 6.8s Failed stage detail; 7.5s Settled · same artifact and saved choices | Stage selection and dependency detail. |
| 10-stats.mp4 | 10 Statistics | 8.6s | 2.8s Opening · Review site measurements; 4.9s Unavailable metric; 6.8s Trend switch; 7.4s Settled · same artifact and saved choices | Metric selection and trend transitions. |
| 11-comparison.mp4 | 11 Comparison | 8.6s | 2.8s Opening · Choose a project plan; 4.9s Select an option; 6.8s Preference submitted; 7.4s Settled · same artifact and saved choices | Option selection and preference submission. |
| 12-credential-entry.mp4 | 12 Credential entry | 8.5s | 2.8s Opening · Project API credential; 4.8s Synthetic token saved; 6.7s Token removed; 7.3s Settled · same artifact and saved choices | Private save and removal through the fixture endpoint. |

Codec verified: H.264, 1920x1080, 30fps; each file decoded to EOF with ffmpeg -xerror. SHA-256 digests are in videos/manifest.json. Recorder sources: local-w2-scenes.ts, local-w2-catalog.ts (capture worktree only, not committed).

Remaining failures: none.
