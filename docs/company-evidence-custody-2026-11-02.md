# Company evidence custody incident

A personal Playwright run without an isolated output directory cleared shared
`test-results` on November 2, 2026. Product source, raw contracts, repository docs
and the personal `.harness-*` evidence directories were unaffected. This note
records the loss; it does not replace missing historical reports.

| Historical artifact | Current custody |
| --- | --- |
| Partial C01 checkpoint, SHA-256 `52ca060c85dd71aefea433b00f253fb2449a78441afe690254499c1f37b6494a` | Exact bytes recovered from CONTROL's retained source copy. |
| Pre-read-refactor command implementation, SHA-256 `f3b591089b0e4895840396925bc38b2591510200a8efe1c099a1756f3b2a100d` | Exact bytes recovered from the immutable older package. |
| Bundled company runtime receipt, SHA-256 `29f6f77702dac67aa3ebdefcc92f79f5fc6126f91654b054e04a1e63c4f1a52b` | Personal owner recovered exact bytes from a complete retained tool read; Gen independently matched the hash. |
| Relocation details, SHA-256 `00e60c6e9ee0c5230578c2a148422907b288cc6d7ef8523e893b8199b8cee71a` | Personal owner recovered exact bytes from a complete retained tool read; Gen independently matched the hash. |
| Original relocation receipt, SHA-256 `24c66ee990353935d023e5760489b9b6796324c8164242e7f41e3f3a6493759c` | Missing. Details are a separate artifact and do not replace it. |
| Read-consumer checkpoint, SHA-256 `2d1ce18d640f154768121f7b99cb272c13c9f54d8bc00dcc1454becbc45baa66` | Missing. Neither coordinating owner retained its bytes. |
| Read-consumer RED/GREEN/adjacent/typecheck reports and saved review summary | Missing. Tool outcomes and final reviewer messages survive in the thread, with weaker custody than the original files. |

Recovered copies are retained under
`.harness-company-evidence/custody-20261102/recovered/`, outside Playwright output.
The incident inventory is `.harness-company-evidence/custody-20261102/incident.json`.
Existing CONTROL receipts and repository verification documents remain untouched.
Other deleted outputs are not presumed recovered; a complete preincident file
inventory was unavailable.

No historical tests were rerun and no missing report was regenerated or relabeled.
The previously observed 191 read-consumer/adjacent passes and typecheck are now
historical tool-transcript evidence. They are not a surviving raw report or proof
of company acceptance. New checks use distinct checkpoint directories under
`.harness-company-evidence/` and never replace the lost evidence.
