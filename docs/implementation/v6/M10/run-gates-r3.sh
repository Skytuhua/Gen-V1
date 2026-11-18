#!/bin/bash
# M10 v6 session-3 re-verification on the unchanged task cut a8c85dcd after the
# R03 integration attempt against origin/main 33639138 conflicted and was
# aborted (HOLD_SOURCE_DRIFT). Each command is separate and observed.
export PATH=/home/piadmin/tools/node24/bin:/home/piadmin/tools:$PATH
cd /home/piadmin/Gen-V1-m10-v6 || exit 2
L=docs/implementation/v6/M10/logs
R=docs/implementation/v6/M10/receipts-r3.jsonl
run() { node docs/implementation/v6/M10/run-command.mjs "$1" "$R" "${@:2}"; echo "EXIT $? :: ${*:2}" >> "$L/driver-summary-r3.txt"; }
run $L/m10-build-widgets-r3.log pnpm build:widgets
run $L/m10-vitest-background-work-r3.log pnpm exec vitest run tests/background-work-v3.test.ts --maxWorkers=1
run $L/m10-vitest-human-handoff-r3.log pnpm exec vitest run tests/human-handoff-v3.test.ts --maxWorkers=1
run $L/m10-vitest-external-intake-r3.log pnpm exec vitest run tests/external-intake-v3.test.ts --maxWorkers=1
run $L/m10-vitest-decisions-r3.log pnpm exec vitest run tests/background-contract-decisions-v6.test.ts --maxWorkers=1
run $L/m10-typecheck-r3.log pnpm typecheck
run $L/m10-lint-r3.log pnpm lint
run $L/m10-build-r3.log pnpm build
echo DRIVER_DONE >> $L/driver-summary-r3.txt
