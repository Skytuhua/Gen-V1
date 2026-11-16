# Final C4 browser command plan

Status: prepared only. No browser command has run from this plan. The parent must supply and release the final whole-source cut after the import-close fixture, typecheck and build. The earlier unit cut is not substituted for that future cut.

The observed prerequisite `c4-source-handoff-policy-01` passed all 25 cases: 22 source-handoff cases and three unchanged editor-handoff cases, with no failures or skips. Its source cut is `4ce32ce11edfac8cfaf89728f783266e67adc17f42a9338ab9d8e48842cc53ed`. The result includes both concurrent same-owner schedules. This does not award browser or installed-native success.

| Order | Unique run ID | Complete declared suite | Expected cases | Port |
| --- | --- | --- | ---: | ---: |
| 1 | c4-workbench-app-final-01 | workbench-app | 26 | 5592 |
| 2 | c4-desktop-final-01 | desktop-surfaces | 30 existing plus one pending import-close case | 5248 |
| 3 | c4-workbench-final-01 | workbench | 18 | 5591 |

`commands.json` preserves literal recorder and child argv, absolute JSON destinations, config hashes, output paths and the required before/after source verification. All three use their declared local Chromium configs, one worker and the original 30-second overall test budget. No case filter, timeout override, retry or channel override is planned.

Before each run, match the supplied source-manifest SHA and run `source-cut-v2.py verify` against that exact manifest. Invoke the recorder with the exact child argv and absolute `PLAYWRIGHT_JSON_OUTPUT_NAME`. After every completed command, including failure, verify the same manifest again, inspect the receipt/report/attachments, and preserve the actual exit. Source mismatch stops the sequence. Test failures remain failed and cannot trigger an unrecorded repair or retry.

Run sequentially with no competing browser/build jobs. Keep the final renderer benchmark quiet and report its controlled fixture and timing scope separately. The first two suites use the actual App with deterministic host or native-bridge fixtures; neither is installed-desktop or Edge proof.

The existing regression-review-draft-01 files are preserved unchanged. New observed results require additive ledger entries bound to the released final source cut.
