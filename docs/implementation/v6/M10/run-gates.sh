#!/bin/bash
# M10 v6 final candidate gate sequence. Each command is separate and observed;
# a failing earlier command never hides a later one.
export PATH=/home/piadmin/tools/node24/bin:/home/piadmin/tools:$PATH
cd /home/piadmin/Gen-V1-m10-v6 || exit 2
L=docs/implementation/v6/M10/logs
R=docs/implementation/v6/M10/receipts.jsonl
run() { node docs/implementation/v6/M10/run-command.mjs "$1" "$R" "${@:2}"; echo "EXIT $? :: ${*:2}" >> "$L/driver-summary.txt"; }
run $L/m10-vitest-background-work-final.log pnpm exec vitest run tests/background-work-v3.test.ts --maxWorkers=1
run $L/m10-vitest-human-handoff-final.log pnpm exec vitest run tests/human-handoff-v3.test.ts --maxWorkers=1
run $L/m10-vitest-external-intake-final.log pnpm exec vitest run tests/external-intake-v3.test.ts --maxWorkers=1
run $L/m10-vitest-decisions-final.log pnpm exec vitest run tests/background-contract-decisions-v6.test.ts --maxWorkers=1
run $L/m10-typecheck-final.log pnpm typecheck
run $L/m10-lint-final.log pnpm lint
run $L/m10-test-full-final.log pnpm test --maxWorkers=2
run $L/m10-build-final.log pnpm build
run $L/m10-test-browser-full-final.log pnpm test:browser
echo DRIVER_DONE >> $L/driver-summary.txt
