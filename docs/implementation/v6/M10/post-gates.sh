#!/bin/bash
# Post-gate steps: focused browser receipt, evidence assembly, validation.
export PATH=/home/piadmin/tools/node24/bin:/home/piadmin/tools:$PATH
cd /home/piadmin/Gen-V1-m10-v6 || exit 2
L=docs/implementation/v6/M10/logs
R=docs/implementation/v6/M10/receipts.jsonl
run() { node docs/implementation/v6/M10/run-command.mjs "$1" "$R" "${@:2}"; echo "EXIT $? :: ${*:2}" >> "$L/post-summary.txt"; }
run $L/m10-browser-background-work-final.log pnpm test:browser --suite background-work
node docs/implementation/v6/M10/build-evidence.mjs > $L/evidence-build.log 2>&1; echo "EXIT $? :: build-evidence" >> $L/post-summary.txt
pnpm exec tsx -e "import {readFileSync} from 'node:fs'; import {implementationEvidenceV3Schema, validateImplementationEvidence, bundleStatus} from './packages/contracts/implementation-evidence.ts'; const raw=JSON.parse(readFileSync('docs/implementation/v3/M10-verification.json','utf8')); const evidence=implementationEvidenceV3Schema.parse(raw); const issues=validateImplementationEvidence(evidence,{expectedBaseSha:'1c09d492278b1014bc3ab5455191b1f5913c96d8'}); console.log(JSON.stringify({issues, bundleStatus:bundleStatus(evidence.phases)},null,2)); if(issues.length)process.exit(1);" > $L/evidence-validate.log 2>&1; echo "EXIT $? :: evidence-validate" >> $L/post-summary.txt
node docs/implementation/v6/M10/compare-outcomes.mjs $L/m10-test-full-final.log /tmp/gv1-m10-baseline/logs/baseline-test-full.log test-results/browser /tmp/gv1-m10-baseline/test-results/browser > $L/outcome-comparison.json 2>&1; echo "EXIT $? :: compare" >> $L/post-summary.txt
echo POST_DONE >> $L/post-summary.txt
