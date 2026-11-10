# Trusted company manager composition

The ordinary `apps/server/company-main.ts` entry stays status-only unless its existing planning clients are explicitly configured. It does not discover accounts, read personal sessions, load a permit from JSON, or enable manager inference from an environment/browser flag. Keep planning intake and work plans disabled for the current operator-status connection. Its running app/service and existing payloads are unchanged.

With the existing Node/tsx dependencies, the default entry remains:

```powershell
pnpm exec tsx apps/server/company-main.ts
```

Use the existing `HARNESS_COMPANY_PORT`, `HARNESS_COMPANY_DATA_DIR`, `GEN_COMPANY_SERVICE_ORIGIN` and protected `GEN_COMPANY_SERVICE_TOKEN_FILE` settings. This command cannot activate the manager. The manager availability endpoint reports `configured:false` and requests remain unavailable.

The manager entry is now executable with the same Node/tsx dependencies:

```powershell
pnpm exec tsx apps/server/company-manager-main.ts
```

Set an explicit separate absolute `HARNESS_COMPANY_DATA_DIR` and unused `HARNESS_COMPANY_PORT`; for example, a new manager-only profile and port 4320. Open the reported origin followed by `/company/communications`. Do not reuse a profile or port owned by an open app. Existing service-origin and protected token-file settings remain optional read configuration; they provide no employee or inference authority. No startup read, model request, journal or engine is created by the unavailable default.

The tiny entry calls the reusable `launchCompanyManagerHost(readCompanyHostOptions())` from `apps/server/company-manager-host.ts` with **no authority**. A future trusted operator bootstrap may call `launchCompanyManagerHost(options, authority)` with the same options only after real Maritime checks. Omitting authority launches the unavailable manager host without manager storage or an engine. The original status-only Linux archive remains a separate historical snapshot and does not include this entry.

The authority object is supplied by trusted **code**, never browser input or environment JSON:

- `bootstrap: CompanyManagerBootstrap` implements `authorize(input, signal)` and `assertCurrent(permit, signal)` against actual Maritime authority.
- `employeeClient: CompanyClient<'employee'>` has a separate current E01 credential. The owner client/token is never supplied to model tools.
- `accounts: RuntimeAccountResolver` represents a protected, separate company account, including real use leases/accounting. Do not construct it from personal account/session storage or copy personal authentication into this profile.

Parsing a permit is not authorization. The producer must verify current owner/project policy and real E01 machine/generation/admission, protected account identity/enrollment/renewal, effective `openai-codex/gpt-6.1-sol` with `max`, containment, trusted quota/accounting, receipt/policy revisions, expiry and finite model/tool/time bounds. Existing runtime checks repeatedly call `assertCurrent` and require the exact account/model/reasoning. They do not collect the absent evidence themselves.

The factory composes the existing `createCompanyManagerTools`, `createCompanyManagerRuntime` and `CompanyManagerJournal` under the company profile lease. Fixed local subdirectories are `manager-ui` (existing Gen interaction journal only), `manager-runtime` and `manager-home` (isolated Hermes state). These are not the Maritime business Store, tasks, approvals, scheduler or budget ledger. No personal service/library/integration composition is initialized. Only the existing three employee read tools are exposed; skills, memory, learning, integrations and helper/compaction turns remain disabled by the existing runtime.

Before opening state, startup rejects redirected fixed directories and a linked/aliased existing journal database. The trusted operator must preserve private profile custody for the host lifetime; these metadata checks do not establish whole-process OS containment or protect against a privileged actor replacing paths during execution. Actual containment remains an admission prerequisite.

The existing manager HTTP paths and owner project/CSRF checks are reused. Results remain `local_ui_interaction` / `local_manager_draft`, `companyReceipt:null`, `dispatchAuthorized:false`. A draft does not authorize a WorkOrder, spend or execution. No owner credential enters the engine.

The returned host's `close()` uses the existing stop path: fence new proposals, cancel/dispose the runtime, wait for active interactions and final journal writes, then close the local interaction Store and profile lease. Late success cannot overwrite cancellation. Cleanup failure rejects and retains ownership rather than reporting a clean stop. Failed startup cleans up resources it acquired. Both tiny entries call `runCompanyHost(start)` in `apps/server/company-lifecycle.ts`, which contains the original lifecycle: exact timing-safe native shutdown token, ready/error/stopped IPC, disconnect/SIGINT/SIGTERM, awaited close and the ten-second shutdown deadline. Merely importing the runner attaches no handlers. Start/stop/package ownership stays with personal Gen.

## Current blocker and proof scope

Maritime explicitly confirmed that the genuine E01 authorize/assertCurrent producer, protected company-account UUID resolver and trusted live accounting collector are absent. Its current admission path is simulation-only and native backend/transport are unavailable. Neither the company-status credential nor the separate approved-job read credential is an employee admission or account grant. No trusted authority is installed, so inference stays unavailable.

`tests/company-manager-host.test.ts` runs disposable loopback/owner/employee fixtures with an injected engine. It checks real composition code, identity/tool separation, local draft recovery, denied admission, startup cleanup and awaited cancellation/storage settlement. Adjacent journal/runtime/HTTP checks retain their scope. These tests are not live model, native admission, accounting, cloud or first-task acceptance. When Maritime supplies the reviewed real producer, connect that exact implementation through this seam; do not invent a permit, fallback account or new protocol.

`tests/company-main.test.ts` applies the same lifecycle checks to both entries. `tests/company-manager-main.test.ts` starts the actual manager entry in a disposable credential-free profile, verifies session checks and manager unavailability despite environment hints, then confirms normal token shutdown and same-profile reopen/disconnect cleanup. This is source-host lifecycle proof, not a Linux package or live-engine result.
