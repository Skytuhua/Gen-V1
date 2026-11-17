# C2 plugin-frame timeout and build concurrency audit

Reviewed at 2026-11-16T01:46:06.036050+00:00. This read-only audit runs no test, browser, build or staging operation and changes no product or test file. Root ran the serial complete validation described below.

**Disposition:** the failed command overlapped an incompatible build of the same `dist/web` output tree. The shared-output conflict is confirmed by source and retained timing. It is a concrete supported explanation for the final plugin-frame timeout; the exact response received during that failed navigation was not captured. No concrete M15 runtime defect was identified, and no executed-baseline failure attribution is made.

## Preserved outcomes

| Attempt | Observed outcome | Plugin-frame cases |
| --- | --- | --- |
| `c2-final-focused-02` | PASS, 334 passed and 3 Windows skips across 24 files | 4 passed; final case 1121.152 ms |
| `c2-final-focused-03` | FAIL, 333 passed, 1 failed and 3 Windows skips across 24 files | First 3 passed; final case timed out at 60000 ms, recorded duration 60009.189 ms |
| `c2-final-focused-04` | PASS, 334 passed and 3 Windows skips across 24 files | 4 passed; final case 294.501 ms |

The complete focused02, focused03 and focused04 argument arrays match after removing only the result JSON destination. All retain `--maxWorkers=1`, the same 24 files and the unchanged 60000 ms Vitest test deadline. Focused04 ran alone after the build, according to root's execution coordination. Its log, receipt and result independently confirm the passing result. Focused03 remains FAIL; no assertion, deadline or failure status was relaxed.

## Concrete shared-output conflict

`tests/plugin-frame-custody.test.ts` writes its parent HTML once in `beforeAll` to `dist/web/plugin-custody-<UUID>.html`. The first and last cases navigate to that physical file. The two middle cases navigate to server-defined `/__custody-unrestricted` routes, which do not depend on that file remaining in the output directory.

`scripts/build.mjs` starts the production Vite build. The unchanged `vite.config.ts` explicitly selects `../../dist/web` from the `apps/web` root and sets `emptyOutDir:true`. The installed Vite 7.3.7 source calls its output cleanup at `renderStart` with order `pre`. Cleanup recursively removes files in the output directory, with no exclusion for this test fixture. Running that build concurrently can delete the HTML between the first and last case.

The unchanged static-file branch in `apps/server/server.ts` maps a missing requested file to `dist/web/index.html`; it returns a temporary 503 if that fallback is also unavailable. Either response can omit the test fixture's PluginFrame and expected Reload alert. The timeout log identifies the final test, not the individual awaited browser operation, so this audit does not claim a retained trace of the fallback response.

| Observed or derived event | UTC |
| --- | --- |
| Focused03 command | 01:38:24.622 to 01:40:03.196 |
| Concurrent build03 command | 01:38:24.645 to 01:38:42.634 |
| First plugin-frame case | Approximately 01:38:34.606 to 01:38:37.074 |
| Final plugin-frame case | Approximately 01:38:41.039 to 01:39:41.048 |
| Built web asset mtimes observed after completion | 01:38:42.180 |
| Built index.html mtime observed after completion | 01:38:42.184 |
| Serial focused04 command | 01:43:46.513 to 01:44:17.629 |

Case intervals are reconstructed from the JSON file start and ordered durations; small runner gaps are not separately timed. Asset timestamps establish output writes during the failing case, not the exact deletion/request order. No unlink event, failing navigation body or browser trace was retained. The serial pass supports removing the confirmed conflicting execution setup without claiming unique-cause proof for every awaited step.

## Source identity and M15 boundary

The plugin-frame test, trusted fixture, PluginFrame component, plugin runtime, editor-handoff helper, API helper, desktop context, frame protocol, Vitest configuration, build script and Vite configuration all match immutable accepted commit `138b1356495bb3a2c9b35020240513f8faa84964` and published commit `fd17d9f1b3931eb2b974b86ccc5a3892da47ba33` byte-for-byte. These are source comparisons, not baseline execution claims. Current server, Service and package files match the preserved pre-UI source cut. All 19 source identities from the final sizing review still match the current files.

The reviewed post-focused02 product changes were the two modal CSS files. The unchanged plugin-frame test's esbuild helper uses `loader:{'.css':'empty'}`, so those styles are discarded from its fixture bundles. The App zoom specification is a different file and is not one of this Vitest command's inputs. This boundary and the serial result identify no new M15 behavior that explains the failed redirected-bootstrap assertion.

The operational correction is to run build and this focused command serially because they share mutable output. The existing test and product guards remain unchanged. This audit does not establish actual Windows file access, real Windows Hermes execution, Edge, installed desktop behavior, or a passing full repository suite.

## Evidence identities

| Attempt | Receipt SHA-256 | Log SHA-256 | Result SHA-256 |
| --- | --- | --- | --- |
| `c2-final-focused-02` | `c5883b97ade86ad614a2609d24ffe9977a87795e3dfb397e0b91c6f6b0124227` | `d0b9132ef9d66da5ec99db899c90bcc976a13ec4fd6eb284b397d3efc00b8498` | `83205ba2c1368388427b2869a701b894f4b1d7dabee57da8d8caeacbb34b7bf4` |
| `c2-final-focused-03` | `88328445a64582238b435500cd96fe3b3b815becbe2c069574cbfb6441a67dc8` | `1779171ed01d46a6dc768244e4ef83efdfba9133830858bbb1e52bb757ba76ab` | `272c6972aeb8b8734b5930b5e12e0e72ab72ed570c1dbe98c4721a0dd238810d` |
| `c2-final-focused-04` | `2cde084ae1d5d80ab1ab34db7441647b26c56328c21ae8e313baa254abac3f2c` | `ab6cadd309609de0e82a2a1974a4fe4c85da8a7c87d2012267031d4c1a64381f` | `eef264f1e4e7e91510483509e828b9be60e314d9dd2997a6b1cbc21d04e785eb` |
| `c2-final-build-03` | `cac6d65123bd4e19203028b141ae61b77538a2679eec9731d7c64bc65e006329` | `bae98e59e8046253bd2e975676581aea12359e208cc6a2af875c1f84b8b6c9c6` | `not applicable` |

All log digests were recomputed and match their receipts. Full command observations, exact source digests, immutable-ref comparisons, assertion durations and timestamp observations are retained in `c2-plugin-frame-concurrency-audit.json`, SHA-256 `63cca4533e4be13276850d9e2403474c4e946924baa21942c03f2338f82a9ad3`.
