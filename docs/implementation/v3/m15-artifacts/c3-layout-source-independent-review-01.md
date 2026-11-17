# C3 retained-layout source custody: independent review

## Disposition and scope

No material defect found within the stated Service/Store/runtime-fixture scope. This review inspected the frozen test, its delta from C2 parent `a1349b0a7ffa1420566da9c7770faf80d6be5bf3`, the actual production contracts, and both retained execution receipts. The reviewer did not execute tests or edit repository files.

The reviewed test is `preserves artifact source custody through retained legacy layout apply/select and rejects new retired presets [Service/Store, runtime fixture]`. The frozen file `tests/source-workbench-host-v3.test.ts` has SHA-256 `ebe41700ec8794fdee48791a37a50ebf7b5c809b8db00fabd5be98ea50e95281`.

## Why the assertions are meaningful

The fixture starts with an empty canonical task and uses the actual Service, SourceWorkbench, WorkspaceRepository and SQLite Store. M04 preparation is enabled. The runtime adapter records model discovery, start and follow-up calls. The test captures one declared structured artifact through the actual source API before the first explicit send binds the account.

`Store.get` and `Store.all` parse fresh JSON from SQLite. Consequently, the before/after custody values do not share mutable live objects that could make equality tautological. The complete snapshots compare the thread, selected account and settings, project and root, working-copy record, captures, account-admission witness, outbox, messages, artifacts, data and resources.

The test applies one retained Research profile, replays its exact command receipt, and selects the original and retained canvases before the explicit send. It repeats these operations after acceptance. Each mutation preserves the complete relevant snapshot. The original source reference is reopened through the real authority checks and returns the exact retained row text. After the explicit send, the entire original capture remains unchanged and the complete persisted admission witness is included in subsequent snapshots.

The runtime input carries the original owner, input ID, account and source reference. Its prompt contains exactly one parsed evidence envelope with the expected capture ID, source, current-version label and exact retained text. This establishes the delivered source data seen by the recording runtime. The final same-ID send returns the original receipt, with one outbox, one recorded runtime start and no follow-up calls.

New creation of each retired preset, Research, Code Review and Custom, throws `PRESET_RETIRED`. The test checks no command receipt, unchanged workspace state, unchanged custody and unchanged runtime call counts for every rejection. The production repository rejects these presets before constructing or committing a new canvas. Saved profile and canvas schemas continue to accept historical values.

The Service, Store, SourceWorkbench, source-selection contract and workspace-tool source bytes are identical to C2. The relevant production delta is the upstream supported-preset contract and repository rejection branch. Exact current and C2 hashes for all eight reviewed files are recorded in the companion JSON.

## Retained execution evidence

| Receipt | Observed result | Interpretation |
| --- | --- | --- |
| `c3-layout-source-01` | Exit 1; one failed case; 47 filtered exclusions | The first assertion searched for raw row JSON inside a prompt that correctly encodes the row as a JSON string. |
| `c3-layout-source-02` | Exit 0; one passed case; 47 filtered exclusions | The corrected assertion parses the single evidence envelope and compares every capture/source/version/text field. |

The initial test copy has SHA-256 `c0a061494ba6a7c3c84fce0b75ae55e22d1627ff347bf79b96694c54ab01dbed`. The only initial-to-final change replaces the incorrect raw-substring assertion with the complete parsed-envelope comparison. It changes no production code, timeout or behavioral expectation. This is an assertion-format repair, not an observed product defect and repair. The original failing receipt remains retained. Both log digests were verified against the recorded logs; exact receipt, result and log hashes are in the companion JSON.

## Coverage limits

The 47 filtered cases did not execute. They are neither passes nor evidence of native-platform execution. The selected case is component integration, not an HTTP, browser, Windows, Edge or installed-desktop run.

The runtime remains a recording fixture. The presence of `StartRun.requestContext` is asserted, but full M04 receipt equality, provider execution, Hermes, ACP and native completion are not. Receipt equality is established for the ordinary `message.send` response and `profile.apply` replay; the test does not compare every capture or M04 receipt or all event rows.

The temporary directories have real measured device/inode identities, and actual SourceWorkbench owner validation and Service request-basis checks exercise the project and working-copy paths. They do not form a real Git repository. No native Git operation or FILE_RANGE read occurs. The test applies one retained Research profile; it covers rejection of new creation for all three retired presets, but not historical Code Review or Custom profile application.
