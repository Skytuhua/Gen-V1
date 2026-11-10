# Stage 1 communication workspace

Run from the repository root, without credentials or a company service:

```powershell
pnpm exec vite --config tests/e2e/vite.config.ts
```

Open **http://127.0.0.1:5499/company/communications?fixture=communications**.
This existing isolated Vite configuration has no personal-service proxy. It listens
on loopback only. Stop with Ctrl+C. No build, installer or employee process is needed.

The communication view lives inside the existing `/company` workspace. The explicit
`fixture=communications` selection loads a labeled Stage 1 synthetic fixture; it is
never a fallback for failed company reads. `/company/communications` without that
selection starts with unavailable company communication data. Unconfigured status
errors in the surrounding company chrome remain visible and honest.

## What works

The Company data source now includes the [owner task connection](company-owner-task.md):
local draft recovery and explicitly configured planning-only instruction intake.
It does not enable task execution or owner authorization.

- Open Alpha's project room, its linked task thread, then E11's addressed inbox.
  All three reference the same canonical message and delivery, without copying histories.
- Inspect the accepted service receipt and separate received-by-supervisor assertion.
  Consumed, admitted, started, results and verification remain unavailable.
- See current fixture blockers, an explicitly illustrative unavailable owner decision,
  exact record references, and a plain text fallback.
- Save an unsent task draft through the existing Gen journal. View selection and
  open/closed evidence survive reload; drafts survive refresh and disconnection.
  Reconnect never sends anything. Fixture and company drafts use separate keys.
- Read-only action placeholders remain disabled. Nothing dispatches, wakes a model,
  approves, sends, publishes or writes to GitHub.

The fixture uses the unchanged C04 golden envelope and received receipt, validated by
the reviewed information/received validators. Fixture project/task labels, wait reason
and decision placeholder are separate illustrative annotations. No real employee,
supervisor disk, current lease or live pilot is asserted by rendering these examples.

## Existing client boundary

`projectCommunicationRecords` joins already validated information envelopes and
received assertions into the one-message read model. A trusted composition may supply
`CommunicationWorkspace.read(signal)` using authorized reads. The component makes no
direct service calls and never accepts a bearer. Each host read must retain and validate
its own company/project/recipient context through the existing canonical clients before
projection; an owner bearer cannot read an employee inbox. Current 401/403 failures clear
protected records, while recoverable transport failures retain a visibly stale view.

No authorized browser communication adapter is composed yet. The existing host status
API does not supply canonical tasks, owner-visible employee inboxes or decision records.
C08/C09 live controls, remote owner authentication, employee engine wiring, consumed
ACKs, live delivery and the cloud pilot remain gated. This Stage 1 screen can receive
a validated host projection when that authority exists, without adding a company Store,
scheduler, credential scheme or another chat application.

## Focused checks

```powershell
pnpm exec vitest run tests/company-communication-model.test.ts tests/company/employee-received.test.ts tests/company/employee-received-client.test.ts tests/company-presentation.test.ts --maxWorkers=1
pnpm exec playwright test tests/e2e/company-communications.spec.ts --output .harness-company-evidence/stage1-browser-new
```

Use a new owned output directory for each browser run. The received consumer is a
pure validator and one explicit machine-only fixed ACK client; its focused TLS tests
do not claim a Gen run of CONTROL's disposable WorkerInbox counterpart.
