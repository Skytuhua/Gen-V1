# C3 terminal Windows evidence

Run `43797606300`, attempt `1`, completed with **failure** on exact pushed commit `3f68a8f1bc1ca5a588862571d905163861e94492`, tree `be7e206431f13b654b6aecd7c12c23d0e4b2dfdb`. The paired accepted base is `49cd633273a3f61c14a4191a9877e99ab23ec88f`, tree `2ecdb4c95fc6b604159257a125064ad585b966e5`.

| Actual command group | Passed | Failed | Skipped | Result |
| --- | ---: | ---: | ---: | --- |
| Full repository, four Windows shards | 3,604 | 0 | 46 | PASS |
| Focused native contracts | 326 | 0 | 1 | PASS |
| Sixteen browser commands, including enabled split tests | 302 | 29 | 0 | FAIL |
| Complete root suite, accepted base49 | 30 | 82 | 1 | FAIL |
| Complete root suite, C3 candidate | 31 | 81 | 1 | FAIL |

All seven archives passed the unchanged sealed v2 byte, metadata, source and receipt validator. All source identities match; all 23 required command receipts are present. This validates custody and provenance. The original failed command, job and run outcomes remain failed. The ingestion retained 602 archive members and their hashes.

The full shards identify 345 distinct test files with no overlap among shards. Their 46 skips include 37 guarded split-browser cases; those 37 cases separately passed with both activation flags and explicit installed Edge selection. The native result includes the real Windows leaf guard, Python/ACP and Hermes session test with a scripted model transport. It is not an installed-desktop or external provider test. Native coverage overlaps the full selection and must not be added to it.

The paired root commands both collected the same 113 cases. All 81 candidate failures also failed on accepted49. No candidate-only failed identity was observed. The older-snapshot artifact-acknowledgment case failed on 49 and passed on C3. The comparison retains every failure and its error. Matching case outcomes alone do not establish matching causes or make the root gate pass.

The browser commands retain 29 failures. A separate exact-source audit attributes four first failures to tests requesting `alert` while their expected text is visibly rendered as `status`; one usage assertion requests `dd` elements excluded by the rendered UsageFooter branch. The tests remain failed and later assertions receive no credit. The clipboard case has no retained trace or actual clipboard bytes, so CRLF normalization is not established by that archive. The saved-layout subpixel observations do not by themselves prove a persistent undersized row.

These results apply to C3 only. Later external 3566, 0f, 364d and active C4 sources have separate identities. Ordinary PR CI also has separate merge-tree provenance. Named browser commands use their configured channels; the desktop-surfaces command uses Chromium with a scripted native bridge. This ingestion changed no local tests, source files, index entries, GitHub state, deadlines or assertions.

The companion JSON records the exact archive, metadata, extracted-result, source and command hashes; per-suite browser outcomes; full-shard membership; native skip/real-Hermes identities; and links to the complete paired-root comparison and focused assertion audit.
