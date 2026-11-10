# Capturing a finite company check

Use the owned Node helper instead of an ad hoc PowerShell metadata wrapper. It writes
explicit UTF-8 without a BOM and preserves native stdout/stderr as raw bytes. It starts
no service by itself and adds no company API, credentials or runtime authority.

For an already authorized, finite check, use a new output directory each time:

```powershell
$captureNode = (Get-Command node.exe).Source
$captureOutput = Join-Path '.harness-company-evidence' ('check-' + [guid]::NewGuid().ToString('N'))
& $captureNode tools/company/capture-command.mjs $captureOutput $captureNode node_modules/vitest/vitest.mjs run tests/company/APPROVED-TEST.test.ts --maxWorkers=1
$captureWrapperExit = $LASTEXITCODE
```

Replace only the test path with the specific approved check. No check is authorized merely
by this example. The executable must be absolute; arguments are passed without a shell.
Use file entry points instead of inline `node -e` strings. Credentials stay out of arguments.
The chosen check retains responsibility for its finite lifetime and child cleanup.

Immediately after the native process returns, before closing logs or writing metadata,
the helper writes and flushes `runner-exit.txt`. A number is the observed native exit;
`null` means no normal exit was observed. Metadata cannot replace that value. If the
exit file is missing, report the native exit as unavailable.

`collector-exit.txt` separately records capture success (`0`) or failure (`1`). `run.json`
contains optional context; it is never needed to recover an already persisted runner exit.
If metadata fails, the runner exit remains in place and the collector failure is separate.
The helper exits with the native code when collection succeeds, or `1` for collector failure.
Read both exit files before describing a result as passing. Existing output directories
are refused so older evidence is never overwritten.

The historical SSE wrapper failure and its unavailable pnpm exit remain unchanged. This
replacement was checked only with harmless native success/failure commands and a deliberate
metadata-write collision in a new temporary directory. No SSE or service fixture was rerun.
