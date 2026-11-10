# Owner task connection

Open the existing company workspace at `/company/communications`. The native
installer exposes it through **File → Open Company**, using a separate company
profile and the same Gen binary. The personal host, model discovery and personal
workspace APIs are not mounted in company mode.

## Current behavior

The owner can enter a project ID and task outcome and reopen the saved draft.
Submission stays unavailable until the trusted host has its separate owner
connection and explicitly enables planning intake. No fixture project is chosen
for a real request.

When enabled, **Request plan** records the instruction through the existing
Company Control `POST /v1/owner/plan`. It returns a durable `planning_only`
proposal, with `model_produced:false`, `dispatch_authorized:false` and
`live_ready:false`. The screen calls this an instruction receipt, not an
executable plan. **Authorize task**, real employee progress and returned results
remain unavailable.

The original request is journaled before sending. An unconfirmed response retains
the exact project, instruction and message ID. **Check saved request** explicitly
replays that same idempotent service operation. Reload/reconnect never submits;
editing/replacing an unconfirmed request is blocked. Full escaped UTF-8 request
bytes are bounded before writing a pending request or contacting the host.

## Exact proposed plan and WorkOrder storage

The later `9eaf24ed2f20a8cabf76d6f6e2d07a0a18923841` capability adds exactly
three fixed propose/read/authorize operations. Current Gen source exposes them
inside the existing owner task panel when `GEN_COMPANY_WORK_PLANS=true` is
explicitly supplied to the trusted host. The same separate owner service
origin/token is required. The service operator must install the extension and
provide the existing registered project, staffing/budget and optional owner
`authorize_work_order` permission; Gen creates none of these prerequisites.

After an instruction receipt, **Prepare a proposed plan** keeps an owner-forwarded
draft with its summary, proposed E01/E10/E11 staff, cents budget, descriptive
steps/acceptance and optional pinned repository declarations. Storage does not
claim model provenance or create executable Tasks. **Store proposed plan** is an
explicit one-shot operation; the owner must then **Read saved plan** to review its
complete immutable instruction/charter/staffing basis and current eligibility.
Repository declarations are not verified runtime inputs.

**Authorize exact WorkOrder** applies to the displayed exact revision, budget,
staff, inputs and selected expiry. Expiry is shown as a local date/time and sent
as integer UTC epoch seconds. The exact authorization envelope is journaled
before its single network attempt. A lost reply blocks replacement commands;
**Recover authorization receipt** reads that exact historical PlanRef and checks
the original command ID, expiry and full reviewed plan against the stored
receipt. Reopen/reconnect does not propose, approve, retry or renew anything.

Closed service rejection is displayed separately from transport uncertainty.
The rejected envelope is retained; a new explicit decision requires the owner to
read current state and satisfy the service's policy again. There is no automatic
rebase, command replacement or expiry extension. Expired/superseded authorization
can be recovered as historical evidence, with current authority unavailable.
Cached reads cannot authorize. Current access denial hides the review and editor
across reopen until a fresh authorized read succeeds; local journal bytes remain
preserved. Bounded partial drafts can reopen for editing even when they do not
yet meet submission limits.

Successful authorization is displayed as **WorkOrder stored** with
`task_materialization:false`, `dispatch_authorized:false`, `live_ready:false`.
It reserves no money and creates no Tasks, attempts, employee admission or start.
Live progress and returned results stay unavailable. The existing 0.6.2 installer
predates this later source change; no rebuild or installed acceptance is implied.

## Host startup

After building the current web application, run:

```powershell
pnpm exec tsx apps/server/company-main.ts
```

Open **http://127.0.0.1:4319/company/communications**. Defaults require no
credentials and show unavailable company data. The existing source-only screen
is also available with `pnpm exec vite --config tests/e2e/vite.config.ts` at
**http://127.0.0.1:5499/company/communications**; this isolated Vite configuration
has no host proxy and cannot submit a company request.

Trusted host configuration, never browser fields:

| Setting | Meaning |
|---|---|
| `HARNESS_COMPANY_PORT` | Loopback owner-host port, default 4319 |
| `HARNESS_COMPANY_DATA_DIR` | Separate exclusive company profile |
| `GEN_COMPANY_SERVICE_ORIGIN` | Existing service's exact IPv4 loopback HTTP origin |
| `GEN_COMPANY_SERVICE_TOKEN` | Separate service owner bearer, held by the host |
| `GEN_COMPANY_PLANNING_INTAKE=true` | Explicit opt-in to planning-only instruction storage |
| `GEN_COMPANY_WORK_PLANS=true` | Explicit opt-in to exact proposed-plan/WorkOrder storage; execution stays disabled |

Origin/token must be supplied together. Status credentials do not implicitly
enable intake. The service still checks current owner/project/plan permission on
each call; a configured host is not proof of authorization. This frozen service
transport is same-host only. It does not establish an authenticated private cloud
connection or remote owner gateway. No service credential or database is supplied
by this source checkpoint.

## Native saved-work contract

Native uses a fixed `/company/communications?desktopWindow=<id>` URL. Source
selection is saved in the existing journal without changing that URL. Select
**Stage 1 synthetic fixture** explicitly to inspect room → thread → addressed
inbox; fixture data never establishes live task completion.

- Source selection key: `company:communications:source:v1`.
- Unsent owner task key: `company:leo-company:owner-task:v1`.
- Owner notes retain their existing key: `company:leo-company:owner-notes:v1`.
- Task draft selectors: **Project ID**, **Task outcome**; the task panel is
  present in **Company data**, not in the fixture view.
- On reopen: recover selected source and owner notes, choose Company data to
  inspect the unsent task draft, without pressing Request plan.
- Native readiness follows settled journal recovery. A recovery error is shown
  with affected drafts disabled, rather than overwriting them or hiding the
  recovery screen behind startup.
- Native close awaits `journalFlush`; a failed save denies close and retains
  visible unsaved work.

## Remaining real-task gate

CONTROL confirmed compatibility at `dfb53a4`: this existing intake is usable as
planning-only storage. The first live prerequisite is a trusted worker
admission/execution bridge with protected auth, exact settings and trusted
accounting. Exact plan-to-WorkOrder authorization is implemented by the later
local capability above, while task materialization and live execution remain
unavailable. Gen does not reinterpret synthetic status as real progress, issue a
start or lend owner credentials to employees. CONTROL must supply the reviewed
execution/progress/result boundary and protected private transport before this
screen can complete the pilot task.

The matching installer/native and clean Maritime Windows acceptance are owned
by personal Gen. This source checkpoint does not establish installation, live
employees, cloud task execution or full company completion.
