# M01 baseline command budgets

`scripts/research-baseline.ts` records the declared `typecheck`, complete `test`,
`build`, and complete `test:browser` commands separately. Its default remains
600,000 milliseconds per command. The package-manager version probe retains its
separate 60,000 millisecond deadline.

The complete registered browser matrix can exceed the default command budget.
An operator can select an explicit finite outer deadline without changing test
timeouts, browser channels, performance thresholds, or the declared script list:

```sh
node --import tsx scripts/research-baseline.ts \
  --out ../m01-full-matrix-evidence-20261118 \
  --command-timeout-ms 7200000
```

This invocation gives each of the four commands two hours. The output directory
must be new. It is a concrete invocation, not a claim that the matrix has run or
passed. Required dependencies, actual declared browser binaries, and native
platform prerequisites must already be available. A missing prerequisite or a
failing required test remains a failed or blocked gate.

The CLI accepts one `--command-timeout-ms` argument containing a positive decimal
integer from 1 through 2,147,483,647. Missing, duplicate, unknown, fractional,
non-finite, or out-of-range arguments exit 2 before launching a package manager or
creating evidence. The programmatic equivalent is
`runBaseline(outDir, repoRoot, {commandTimeoutMs: 7200000})`; invalid runtime values
raise `INVALID_INPUT` before launch or evidence creation.

The selected budget is included in the returned and printed baseline summary.
An actual expired deadline retains `termination: TIMEOUT` and `status: BLOCKED`
under the existing command-evidence contract, and the CLI exits 1. The runner
keeps earlier command logs and continues recording the remaining independent
baseline commands. No timeout becomes an expected-negative success, and a later
successful command does not erase the timed-out receipt.
