# M15 file capture through the original Hermes engine

## Evidence status

The new `tests/source-workbench-hermes-v3.test.ts` was collected on Linux with one explicit Windows-only skip. Its native test body has not run in this environment. The collection command exited zero; that result is not native acceptance. TypeScript import/transformation succeeded during collection. A full repository typecheck and execution on the exact PR head in Windows CI remain separate requirements.

Collection receipt: `docs/implementation/v3/m15-logs/c2-host-hermes-collection-01.json`, with its paired bounded log. The command was `pnpm exec vitest run tests/source-workbench-hermes-v3.test.ts --maxWorkers=1`. It ran at 2026-11-16 00:41:43 UTC and reported one skipped file, one skipped test, and zero executed native cases.

Reviewed test SHA-256: `426c80e3f443dffb10dc797c8618155a260dc740daad53d33262bf982de722b5`.

## Test boundary

The fixture creates a real SQLite `Store`, real `Service`, real `SourceWorkbench`, real `HermesSourceLibrary`, and `createHermesRuntime` with its default `HermesClient`. It enables M15 for the fixture and uses real M04 request preparation. It does not override `createClient`, Python, the source worker, ACP, the authenticated loopback broker, or the native file guard.

The only execution substitute is a deterministic model-only `RuntimeAdapter`, following the existing original-Hermes integration pattern. It returns two fixed text completions, plus scripted usage and transport events. There are no live model endpoints or account sign-in calls. Ordinary settings disable learning, composer predictions and background reviews so this case has exactly two foreground model requests. The feature flag returns to its default after cleanup.

## Assertions awaiting native execution

The file lives outside host storage and is granted through the real `resource.grant` command. Its selection is captured before the task has a message, outbox entry, model, session, run or account binding. The fixture checks the complete-file content digest, selected text digest, original source identity and initial unbound custody marker.

The first `message.send` carries the captured reference through the host. The test parses the actual ACP transcript received by the scripted model transport, then checks the command/input identity, run/epoch, exact reference and selected bytes. Distinct unselected lines must be absent. The original Python session file must contain the same application input envelope and the first assistant response.

Before the second turn, the operator changes the granted file in place. The normal source reader must report the original capture as stale. The second send explicitly sets `keepCaptured: true` on the same capture. The second actual model prompt must preserve the first input envelope and response, then carry the original selected bytes and reference again with the retained-version indication. Changed current-file bytes must be absent.

Both turns must report the same original `run_agent.AIAgent` instance and session path, with separate run IDs, epochs 1 and 2, and model-request sequence numbers 1 and 2. The saved Python session must retain both user envelopes and assistant responses. Both the authenticated runtime history reader and the disk input-receipt file must return the two command IDs in order.

The model-only broker creates a fresh native transport for each completion. The case therefore distinguishes persistent original-Hermes conversation state from its fresh underlying model-text requests; it does not claim native SDK session reuse. Each native request must have no resources or inherited native session path.

The fixture repeats both command identities and expects the original receipts without a second delivery. After confirmed runtime cleanup, it closes and reopens SQLite and compares the two durable outbox rows, unchanged capture, command receipts and retained thread session. The resource grant must remain the sole grant, and the stored user messages must retain their corresponding source references.

## Target requirements and limits

Execution requires real Windows, the built Windows credential/path guard, Node 24, the repository's pinned Python 3.14 interpreter and isolated dependency tree, the original pinned Hermes source, and the TypeScript ACP child launcher. Missing prerequisites must fail execution on Windows. The platform gate skips Linux because its existing guard does not admit the required file-leaf/read-only policy.

This case uses the default profile with `accountId: null`. The separate Windows native-guard host fixture covers a selected non-null account. This case does not cover authentication, a live paid model, packaged-desktop IPC, browser selection, process restart/recovery of the Python engine, native SDK continuity, diff capture, historical evidence readers, or unavailable M05/M10/M14 module services.

Only the test and this coverage note were authored for this integration task. Runtime product code and the default M15 flag were not changed. The parent owns the exact-head Windows workflow and module allowlist wiring.
