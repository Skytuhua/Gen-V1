return (function assembleM05Evidence(options) {
 const u=new Function(load("m05ByteUtilities"))();
 const hash=s=>u.sha256(u.utf8(s));
 const baseline=load("m05NativePayload");
 const baseFiles=Object.fromEntries(baseline.entries.filter(x=>typeof x.content==="string").map(x=>[x.path,x.content]));
 const read=n=>JSON.parse(baseFiles["docs/implementation/v3/"+n]);
 const output={...load("m05AllCurrentEvidenceFiles"),...(options.additionalFiles??{})};
 const put=(path,content)=>{output[path]={path,content,bytes:u.utf8(content).length,sha256:hash(content)};};
 const putJSON=(name,data)=>put("docs/implementation/v3/"+name,JSON.stringify(data,null,2)+"\n");
 const sourceHead=options.sourceHead,sourceTree=options.sourceTree;
 if(!/^[a-f0-9]{40}$/.test(sourceHead)||!/^[a-f0-9]{40}$/.test(sourceTree))throw new Error("Immutable source identity required");
 const ledgerPath="docs/implementation/v3/m05-logs/commands.jsonl",ledger=output[ledgerPath]?.content;
 const oldLedger=baseFiles[ledgerPath];
 if(typeof ledger!=="string"||!ledger.startsWith(oldLedger))throw new Error("Published command prefix changed");
 const allCommands=ledger.trimEnd().split("\n").map(JSON.parse),oldCommands=oldLedger.trimEnd().split("\n").map(JSON.parse);
 const added=allCommands.slice(oldCommands.length);
 const commandKey=c=>hash(JSON.stringify([c.argv,c.cwdIdentity,c.startedAt,c.boundedLogRef]));
 const evidence=read("M05-verification.json"),policy=read("M05-log-policy.json"),history=read("M05-continuation-history.json"),provenance=read("M05-provenance.json"),review=read("M05-continuation-review.json"),inventory=read("M05-continuation-file-inventory.json");
 const phaseMap=load("m05CICommandPhaseMap");
 for(const c of added){
  const file=output[c.boundedLogRef],metaFile=output[c.boundedLogRef.replace(/\.log$/,".meta.json")];
  if(!file||typeof file.content!=="string"||hash(file.content)!==c.logDigest||u.utf8(file.content).length>65536||!metaFile)throw new Error("New command log custody "+c.boundedLogRef);
  const meta=JSON.parse(metaFile.content);
  const supplementalFile=output["docs/implementation/v3/M05-command-import-bindings-20261116.json"];
  const supplemental=supplementalFile?JSON.parse(supplementalFile.content).records.find(r=>r.boundedLogRef===c.boundedLogRef):null;
  if(supplemental&&(supplemental.metadataSha256!==hash(metaFile.content)||supplemental.commandSha256!==hash(JSON.stringify(c))))throw new Error("Supplemental command binding mismatch");
  if(JSON.stringify(meta.command)!==JSON.stringify(c))throw new Error("New command metadata mismatch");
  if(c.status==="PASS"&&(c.termination!=="NONE"||c.exitCode!==0))throw new Error("Unproven command success");
  const suffix=c.boundedLogRef.match(/-s\d+-(.+)\.log$/)?.[1];
  let phaseIds=phaseMap[suffix]??meta.phaseIds??supplemental?.phaseIds;
  if(c.boundedLogRef.includes("windows-startup-"))phaseIds=[c.argv[1]==="typecheck"?"BUILD_AND_SETUP":"PLATFORM_NATIVE_STORAGE_AND_INSTALLED_DESKTOP"];
  if(!phaseIds?.length)throw new Error("Command phase missing "+c.boundedLogRef);
  for(const id of phaseIds)evidence.phases.find(p=>p.id===id).commands.push(c);
  const inputHash=meta.excerptInputSha256??meta.excerptSha256??supplemental?.captureInputSha256;
  const inputBytes=meta.excerptInputBytes??meta.excerptBytes??supplemental?.captureInputBytes;
  if(!/^[a-f0-9]{64}$/.test(inputHash??"")||!Number.isInteger(inputBytes))throw new Error("Excerpt provenance missing "+c.boundedLogRef);
  policy.entries.push({commandKey:commandKey(c),boundedLogRef:c.boundedLogRef,outputDigest:c.logDigest,outputBytes:file.bytes,firstObservedInputDigest:inputHash,firstObservedInputBytes:inputBytes,fullRawOutputDigest:null,rawOutputLimit:"The bounded output, exact capture method, source digests, and observed command envelope are recorded in the adjacent metadata. No additional subprocess capture is inferred.",transformations:inputHash===c.logDigest?[]:[{inputDigest:inputHash,outputDigest:c.logDigest,operations:meta.transformations??[]}]});
  if(c.status==="FAIL")history.historicalFailures.push({commandKey:commandKey(c),boundedLogRef:c.boundedLogRef,exitCode:c.exitCode,termination:c.termination,status:c.status,selectedForCurrentCase:false});
 }
 policy.records=allCommands.length;policy.allLogsWithin64KiB=true;
 if(new Set(policy.entries.map(x=>x.commandKey)).size!==policy.entries.length)throw new Error("Duplicate command identities");
 const latest=options.ci??load("m05TerminalReceipt"),ciRef="docs/implementation/v3/M05-windows-ci-"+latest.workflow.id+".json";
 const sameCut=latest.headSha===sourceHead&&latest.treeSha===sourceTree&&latest.testedCheckout.treeSha===sourceTree&&latest.testedCheckout.matchesPublishedTree===true;
 const successful=name=>sameCut&&latest.jobs.some(j=>j.name===name&&j.status==="completed"&&j.conclusion==="success");
 const allJobsPass=sameCut&&latest.complete&&latest.jobs.length===9&&latest.jobs.every(j=>j.status==="completed"&&j.conclusion==="success")&&latest.workflow.conclusion==="success";
 const currentFailed=name=>sameCut&&latest.jobs.some(j=>j.name===name&&["failure","timed_out"].includes(j.conclusion));
 const setCase=(id,caseId,status,text)=>{const p=evidence.phases.find(x=>x.id===id),c=p.requiredCases.find(x=>x.id===caseId);if(!c)throw new Error("Required case absent "+caseId);c.status=status;c.evidence=text;if(!p.artifactRefs.includes(ciRef))p.artifactRefs.push(ciRef);};
 const regression=evidence.phases.find(p=>p.id==="REGRESSION_REQUIRED");
 const appPass=[1,2,3,4].every(n=>successful("Tests (shard "+n+"/4)"))&&latest.applicationShardLogsCollected===4&&latest.applicationTestCounts.failed===0;
 const appFailed=[1,2,3,4].some(n=>currentFailed("Tests (shard "+n+"/4)"))||(sameCut&&latest.applicationTestCounts.failed>0);
 regression.status=appPass?"PASS":appFailed?"FAIL":"BLOCKED";
 setCase(regression.id,"current-Windows-full-regression",appPass?"PASS":appFailed?"FAIL":"NOT_RUN",appPass?ciRef+"; all four exact-cut application shards passed. Actual counts: "+latest.applicationTestCounts.passed+" passed, "+latest.applicationTestCounts.skipped+" skipped, zero failed tests or suites. Historical failures are preserved.":appFailed?ciRef+"; one or more current exact-source required application jobs failed. Actual command outcomes and failure details are preserved; no unexecuted test body is claimed as an assertion failure.":"NOT_RUN for this source cut. The prior immutable failed run is retained; current application shards require exact source/test/workflow identity.");
 const browser=evidence.phases.find(p=>p.id==="PLATFORM_BROWSER"),browserJob=latest.jobs.find(j=>j.name==="Browser tests");
 const browserPass=successful("Browser tests")&&browserJob?.testCounts?.totals?.failed===0&&browserJob?.testCounts?.totals?.flaky===0;
 const browserFailed=currentFailed("Browser tests")||(sameCut&&((browserJob?.testCounts?.totals?.failed??0)>0||(browserJob?.testCounts?.totals?.flaky??0)>0));
 browser.status=browserPass?"PASS":browserFailed?"FAIL":"BLOCKED";
 setCase(browser.id,"current-project-memory-context-and-baseline-browser",browserPass?"PASS":browserFailed?"FAIL":"NOT_RUN",browserPass?ciRef+"; split baseline plus project-memory, usage-context, frontend-refinement and root suites passed at the exact tested code cut. Actual aggregate "+browserJob.testCounts.totals.passed+" passed / "+browserJob.testCounts.totals.skipped+" skipped / zero failed or flaky.":browserFailed?ciRef+"; current exact-source browser execution failed or reported failed/flaky cases. Actual executed and unexecuted command groups remain distinct in the receipt.":"NOT_RUN for this source cut. All five required browser command groups must execute on the exact code/test/workflow cut.");
 const installed=evidence.phases.find(p=>p.id==="PLATFORM_NATIVE_STORAGE_AND_INSTALLED_DESKTOP"),admission=options.installedAdmission??null,installedFailed=currentFailed("Installed desktop memory retention");
 if(admission&&(!allJobsPass||admission.status!=="PASS_INSTALLED_DEFAULT_OFF_RETAINED_MEMORY_ONLY"||admission.headSha!==sourceHead||admission.treeSha!==sourceTree))throw new Error("Invalid installed admission");
 setCase(installed.id,"installed-default-off-retained-memory-review-and-restart",admission?"PASS":installedFailed?"FAIL":"NOT_RUN",admission?admission.reviewRef+"; exact default-off retained source, correction, accept/reject, ordinary owned native Save with matching export bytes/hash, Forget and same-profile restart were independently admitted. Full enabled installed memory and live model use are outside this result.":installedFailed?ciRef+"; the current exact-source installed verification job failed. Its actual failure phase requires the original artifact review; no retained-memory success is inferred.":"NOT_RUN for this source cut. Actual installed retained-memory and native Save behavior have not been independently admitted. The prior before-main-page failure remains a separate historical result.");
 installed.status=installedFailed?"FAIL":"BLOCKED";
 const startupCase={id:"installed-main-page-readiness-boundary",status:"PASS",evidence:"docs/implementation/v3/M05-installed-startup-boundary-43760214518.json; docs/implementation/v3/M05-installed-startup-boundary-43760489286.json; actual red deadline failure followed by33 passing custody/native Save helper cases and full typecheck. Fake-time unit cases do not establish installed startup performance."};
 if(!installed.requiredCases.some(x=>x.id===startupCase.id))installed.requiredCases.push(startupCase);
 for(const path of ["docs/implementation/v3/M05-installed-startup-boundary-43760214518.json","docs/implementation/v3/M05-installed-startup-boundary-43760489286.json","docs/implementation/v3/M05-installed-independent-phase-review-43755565107.json","docs/implementation/v3/M05-installed-artifact-recovery-43755565107.json"])if(!installed.artifactRefs.includes(path))installed.artifactRefs.push(path);
 if(admission&&!installed.artifactRefs.includes(admission.reviewRef))installed.artifactRefs.push(admission.reviewRef);
 evidence.platform="Mixed recorded Linux and Windows execution; current application proof uses GitHub Actions windows-latest.";
 evidence.nodeVersion="v24.22.2 in current Windows CI; historical command runtimes remain preserved.";
 evidence.remainingGates=[
 ...(!allJobsPass?["The current immutable source/test/workflow cut still requires all nine Windows CI jobs to succeed. Historical failed attempts remain recorded."]:[]),
 ...(!admission?["Installed default-off retained-memory review, ordinary native Save and same-profile restart remain unverified for the current source cut."]:[]),
 "Full enabled installed recall/extraction/checkpoint flow remains unverified independently of the default-off retained-record result.",
 "Live repeated-task evaluation is MANIFEST_ONLY: no actual authorized host/model was supplied; all six unmeasured summary metrics remain null.",
 "Production activation remains default off and independently gated. reviewerApproval is false even when publication and merge are separately authorized.",
 "External embeddings/recall, user-wide sharing and auto-acceptance remain disabled. No external-provider deletion guarantee is claimed.",
 "Deletion durability relies on the retained sibling fence. Whole-parent/system rollback is outside this application boundary; ledger exhaustion fails closed."
 ];
 if(evidence.flags.some(x=>x.enabled!==false))throw new Error("Activation flag changed");
 provenance.recordedAt=options.recordedAt;provenance.repositoryRoot="GitHub immutable repository objects; original local workspace unavailable during continuation.";provenance.branch="agent/m05-v3";provenance.sourceParentHeadSha=sourceHead;
 provenance.currentPlatform="GitHub Actions Windows execution; evidence assembled from immutable GitHub responses after local workspace loss.";
 provenance.commandCutLimitation="Historical command identities and outcomes remain unchanged. The current Windows selection binds the exact source head, checked-out commit and tree through the immutable CI receipt and adjacent command metadata. Final publication adds only independently verified documentation; no current local workspace scan is claimed.";
 provenance.nodeVersion="v24.22.2";provenance.packageManagerEvidence="pnpm10.30.3 and Node24.22.2 are recorded in the pinned workflow and actual Windows job logs.";
 provenance.windowsCiRef=ciRef;provenance.windowsCiCurrentCodeCut=sameCut;provenance.windowsCiCutNotes=sameCut?[]:["The selected historical CI head differs from the current reviewed source head. No current-cut success is inferred."];
 provenance.installedRetentionAdmission=admission;
 provenance.evidenceAssembly={publishedPrefix:{headSha:"0e072230965d15e0bcad8bb7579653a1332085e4",rows:631,bytes:u.utf8(oldLedger).length,sha256:hash(oldLedger)},rows:allCommands.length,ledgerSha256:hash(ledger),prefixPreserved:true,currentSourceHead:sourceHead,currentSourceTree:sourceTree,localExecutionClaim:false};
 provenance.historicalSelectedCommandRefs=[...new Set([...(provenance.historicalSelectedCommandRefs??[]),...provenance.selectedCurrentCommandRefs])].sort();
 provenance.selectedCurrentCommandRefs=[...new Set(added.filter(c=>sameCut&&c.boundedLogRef.includes(String(latest.workflow.id))).map(c=>c.boundedLogRef))].sort();
 provenance.currentCommandSelectionScope="Only actual command records from the exact selected source/run, including failures. Historical selections and independently scoped probes remain separate.";
 history.refreshes.push({recordedAt:options.recordedAt,executionBaseSha:provenance.acceptedBaseSha,sourceParentHeadSha:sourceHead,selectedCurrentCommandRefs:provenance.selectedCurrentCommandRefs,ledgerBeforeDigest:hash(oldLedger),ledgerAfterDigest:hash(ledger),windowsCiRef:ciRef,windowsCiCurrentCodeCut:sameCut,installedRetentionAdmission:admission,assembly:"Immutable GitHub responses and exact reviewed blobs; original631 rows unchanged."});
 review.previousReviewedWindowsAttempt=review.latestWindowsAttempt;
 review.previousInstalledStartupWindowsAttempt={runId:43755565107,headSha:"0e072230965d15e0bcad8bb7579653a1332085e4",treeSha:"0494c5bd17e0cf9d3fdf3d142596bb6b4b4866e9",jobsPassed:8,jobsFailed:1,application:{passed:3858,skipped:39,failed:0},browser:{passed:267,skipped:2,failed:0,flaky:0},installedRetention:{status:"FAILED_BEFORE_MAIN_PAGE_READINESS",completedLaunches:0,memoryObservations:0,nativeSave:"NOT_RUN",reviewRef:"docs/implementation/v3/M05-installed-independent-phase-review-43755565107.json"},receiptRef:"docs/implementation/v3/M05-windows-ci-43755565107.json"};
 review.priorFailedWindowsAttemptRefs=[...new Set([...review.priorFailedWindowsAttemptRefs,"docs/implementation/v3/M05-windows-ci-43755565107.json"])];
 review.latestWindowsAttempt=options.latestWindowsSummary??{runId:latest.workflow.id,headSha:latest.headSha,checkoutSha:latest.testedCheckout.commitSha,treeSha:latest.treeSha,jobsPassed:latest.jobs.filter(j=>j.conclusion==="success").length,jobsFailed:latest.jobs.filter(j=>j.conclusion==="failure").length,application:latest.applicationTestCounts,browser:browserJob.testCounts.totals,installedRetention:{status:admission?.status??(installedFailed?"CURRENT_INSTALLED_JOB_FAILED_PHASE_REVIEW_REQUIRED":latest.workflow.id===43755565107?"FAILED_BEFORE_MAIN_PAGE_READINESS_NO_MEMORY_ACTIONS":"NOT_ADMITTED_PENDING_INDEPENDENT_ARTIFACT_REVIEW"),reviewRef:admission?.reviewRef??(latest.workflow.id===43755565107?"docs/implementation/v3/M05-installed-independent-phase-review-43755565107.json":null)}};
 review.pendingValidation=[...(!allJobsPass?["Complete all nine Windows jobs on exact source "+sourceHead+"."]:[]),...(!admission?["Independently admit actual installed default-off memory review, normal native Save, Forget and same-profile restart from the original artifact."]:[])];
 review.remainingActionableFindings=admission?[]:["The source-proven page-discovery budget mismatch is repaired and its meaningful red/green regression is verified. Actual installed native Save and retained-memory execution remain required."];
 review.originalPromptReview.remainingProofGates=[...(!admission?["Installed default-off retained-memory review and restart after real packaging"]:[]),"Full enabled installed memory lifecycle","Authorized live repeated-task quality and total auxiliary cost"];
 review.originalPromptReview.additionalConcreteCorrectnessBlockers=[];
 const readinessReviewRef="docs/implementation/v3/M05-installed-startup-repair-review-20261115.json";
 const readinessReview=JSON.parse(output[readinessReviewRef].content);
 review.installedStartupRepair={status:"HISTORICAL_WINDOWS_RED_GREEN_READINESS_REPAIR",reviewRef:readinessReviewRef,sourceHead:readinessReview.publication.sourceHead,sourceTree:readinessReview.publication.sourceTree,redRun:readinessReview.meaningfulRed.runId,greenRun:readinessReview.greenValidation.runId,redTests:{failed:1,skipped:25,passed:0},greenTests:{passed:33,failed:0,skipped:0},fullTypecheck:"PASS",productionAppChanged:false,timeoutMs:80000,productionBackendBudgetMs:60000,productionSurfaceBudgetMs:20000,originalAbsentPageCause:"UNMEASURED"};
 review.installedStartupCurrentApplicability={sourceHead,sourceTree,sourceComparisons:readinessReview.sourceFiles.map(file=>({path:file.ref,historicalSha256:file.sha256,currentSha256:options.sourceFiles?.[file.ref]?.sha256??null,byteIdentical:options.sourceFiles?.[file.ref]?.sha256===file.sha256})),actualInstalledAdmission:admission,scope:"Historical readiness-only repair and its original source identities are preserved above. Current diagnostics, guard changes and installed execution have separate receipts; no blanket source equivalence is inferred."};
 for(const row of review.reviewedFiles){const changed=options.sourceFiles?.[row.path];if(changed)row.sha256=changed.sha256;}
 review.reviewScope="Independent original-prompt review of all twelve M05 steps and four UI requirements, accepted M04 custody, merged M09/M11 lifecycle, canonical Python packaging, native FILE execution and Windows verification. Historical failed attempts retain their exact evidence. The scoped native export bridge validates and owns one-shot redacted bytes and waits for actual native completion. The verifier uses the ordinary owned Windows Save chooser and an identity-bound destination. The main-page readiness helper preserves the existing production startup budgets and revalidates ownership. Current execution is summarized in latestWindowsAttempt; both production flags remain false.";
 review.limitations[0]="Current exact-source Windows execution is bound by "+ciRef+". "+(allJobsPass?"All nine jobs passed.":"All nine jobs have not passed for this source cut.")+" "+(admission?"Actual retained-memory admission is limited to default-off records, ordinary native Save and the same-profile restart.":"Installed retained-memory and native Save success are not admitted for this source cut.");
 review.limitations[6]="Historical run43748168614 failure screenshots show the seeded task and collapsed panel. Run43755565107 contains no PNG members and fails before a completed launch or memory action. Neither record is converted to success by a later repair. Instrumented Cursor bootstrap network0 is not a global provider-network measurement.";
 review.historicalFieldScope={integratedWindowsCI:"Earlier accepted integrated baseline, preserved as historical evidence.",verificationRepairs:"Historical fixed-source preflight and browser execution. Installer budget and latest execution are described by their later dedicated records.",previousWindowsAttempt:"Preserved earlier attempt.",previousReviewedWindowsAttempt:"The latest attempt in the previously published review.",previousInstalledStartupWindowsAttempt:"The separately preserved0e source attempt before the readiness repair."};
 const publicInventory=options.publicSourceInventory,publicInventoryPath="scripts/public-source-files.json",publicInventorySource=options.sourceFiles?.[publicInventoryPath];
 if(!publicInventory||typeof publicInventory.content!=="string"||!publicInventorySource||hash(publicInventory.content)!==publicInventorySource.sha256||u.utf8(publicInventory.content).length!==publicInventorySource.bytes)throw Error("Current public source inventory bytes are required");
 const publicManifest=JSON.parse(publicInventory.content);
 if(!Array.isArray(publicManifest.source)||!Array.isArray(publicManifest.runtime)||JSON.stringify(publicManifest.source)!==JSON.stringify([...new Set(publicManifest.source)].sort())||JSON.stringify(publicManifest.runtime)!==JSON.stringify([...new Set(publicManifest.runtime)].sort())||publicManifest.runtime.some(path=>!publicManifest.source.includes(path)))throw Error("Current public source inventory is invalid");
 review.platformProofPreparation.publicSourceInventory="Exact current manifest contains "+publicManifest.source.length+" source entries and "+publicManifest.runtime.length+" runtime entries; both lists are unique and sorted, with runtime a source subset.";
 review.platformProofPreparation.publicSourceInventoryBinding={path:publicInventoryPath,sourceHead,sourceTree,bytes:publicInventorySource.bytes,sha256:publicInventorySource.sha256};
 review.historicalNativeFileCapture={reviewRef:"docs/implementation/v3/M05-native-file-review-43733008039.json",selectedForCurrentSource:false,scope:"Preserved earlier native FILE proof. The current guard implementation changed, so that historical byte-equivalence claim is not used for this source."};
 setCase(installed.id,"actual-native-FILE-capture","NOT_RUN","Current native FILE execution requires its exact source, suite and raw-log observation; the earlier437330 result remains historical.");
 const nativeFileRef="docs/implementation/v3/M05-native-file-observation-"+latest.workflow.id+".json",nativeFileProof=output[nativeFileRef];
 if(sameCut&&nativeFileProof){
  const observed=JSON.parse(nativeFileProof.content),job=latest.jobs.find(j=>j.id===observed.jobId),suite=observed.suite,bound=options.sourceFiles?.[suite?.path];
  if(observed.status!=="OBSERVED_CURRENT_NATIVE_FILE_CAPTURE_ONLY"||observed.runId!==latest.workflow.id||observed.headSha!==sourceHead||observed.treeSha!==sourceTree||observed.actualCheckoutSha!==latest.testedCheckout.commitSha||!job||job.conclusion!=="success"||job.rawLogDigest!==observed.rawLog.sha256||job.rawLogBytes!==observed.rawLog.bytes||suite?.path!=="tests/memory-native-file-capture-v3.test.ts"||!Number.isSafeInteger(suite.passedCases)||suite.passedCases<1||suite.executedCases!==suite.passedCases||suite.failedCases!==0||suite.skippedCases!==0||hash(suite.rawLine)!==suite.rawLineSha256||!suite.ansiStrippedLine.includes("✓ "+suite.path+" ("+suite.executedCases+" tests)")||!bound||bound.sha256!==suite.source.sha256||bound.bytes!==suite.source.bytes)throw Error("Current native FILE observation provenance mismatch");
  setCase(installed.id,"actual-native-FILE-capture","PASS",nativeFileRef+"; "+suite.passedCases+" actual native FILE cases passed without skips on the exact current Windows source. This does not establish installed retention or live provider execution.");
  installed.artifactRefs.push(nativeFileRef);
 }
 review.navigationAndBrowserCleanupRepair.status=admission?"ACTUAL_WINDOWS_NAVIGATION_AND_CLEANUP_VERIFIED":appPass?"ACTUAL_WINDOWS_CLEANUP_VERIFIED_INSTALLED_NAVIGATION_PENDING":"INSTALLED_NAVIGATION_AND_CURRENT_CLEANUP_EXECUTION_PENDING";
 review.navigationAndBrowserCleanupRepair.currentApplicationReceipt=appPass?ciRef:null;
 // Current suite counts require their exact raw-log observation; do not reuse historical constants.
 delete review.platformProofPreparation.installedRetention.windowsCustodyCasesPassed;
 review.platformProofPreparation.installedRetention.windowsCustodyCaseCountScope="No current suite count inferred; historical counts retain their original receipts.";
 const custodyCountRef="docs/implementation/v3/M05-windows-custody-counts-"+latest.workflow.id+".json";
 const custodyCountFile=output[custodyCountRef];
 if(sameCut&&custodyCountFile){
  const observed=JSON.parse(custodyCountFile.content),job=latest.jobs.find(j=>j.id===observed.jobId);
  if(observed.status!=="OBSERVED_WINDOWS_SUITE_COUNTS_ONLY"||observed.runId!==latest.workflow.id||observed.headSha!==sourceHead||observed.treeSha!==sourceTree||observed.actualCheckoutSha!==latest.testedCheckout.commitSha||!job||job.conclusion!=="success"||job.rawLogDigest!==observed.rawLog.sha256||job.rawLogBytes!==observed.rawLog.bytes)throw new Error("Current Windows custody count provenance mismatch");
  const suite=observed.suites.find(row=>row.path==="tests/installed-desktop-verification.test.ts"),bound=options.sourceFiles?.[suite?.path];
  if(!suite||!Number.isSafeInteger(suite.passedCases)||suite.passedCases<1||suite.executedCases!==suite.passedCases||suite.failedCases!==0||suite.skippedCases!==0||hash(suite.rawLine)!==suite.rawLineSha256||!suite.ansiStrippedLine.includes("✓ "+suite.path+" ("+suite.executedCases+" tests)")||!bound||bound.sha256!==suite.source.sha256||bound.bytes!==suite.source.bytes)throw new Error("Current Windows custody suite observation mismatch");
  review.platformProofPreparation.installedRetention.windowsCustodyCasesPassed=suite.passedCases;
  review.platformProofPreparation.installedRetention.windowsCustodyCaseCountScope="Observed exact-source automated unit suite only; no installed-retention claim.";
  review.platformProofPreparation.installedRetention.windowsCustodyCaseCountRef=custodyCountRef;
  if(!installed.artifactRefs.includes(custodyCountRef))installed.artifactRefs.push(custodyCountRef);
 }

 review.platformProofPreparation.installedRetention.currentReviewRefs=[...new Set([...review.platformProofPreparation.installedRetention.currentReviewRefs,"docs/implementation/v3/M05-installed-independent-phase-review-43755565107.json","docs/implementation/v3/M05-installed-startup-repair-review-20261115.json"])];
 if(!admission){
  review.nativeMemoryExportRepair.status="REMOTE_UNIT_CHECKS_PASS_ACTUAL_INSTALLED_NATIVE_SAVE_PENDING";
  review.nativeMemoryExportRepair.actualWindowsExecution="NOT_ADMITTED_FOR_CURRENT_SOURCE";
  review.platformProofPreparation.installedRetention.execution="The prior0e run completes natural installation, exact payload/provider custody and owned uninstall, but fails the expected-origin page predicate before any memory action. The corrected readiness helper has real Windows red/green unit and typecheck proof. Current installed behavior remains pending independent artifact admission.";
  review.platformProofPreparation.installedRetention.nativeSaveStatus="ACTUAL_INSTALLED_NATIVE_SAVE_PENDING";
 }
 review.evidenceRefs=[...new Set([...review.evidenceRefs,ciRef,"docs/implementation/v3/M05-installed-independent-phase-review-43755565107.json","docs/implementation/v3/M05-installed-artifact-recovery-43755565107.json","docs/implementation/v3/M05-installed-source-bindings-43755565107.json","docs/implementation/v3/M05-installed-startup-repair-review-20261115.json","docs/implementation/v3/M05-installed-startup-boundary-43760214518.json","docs/implementation/v3/M05-installed-startup-boundary-43760489286.json",...(admission?[admission.reviewRef]:[])])];
 const currentCommands=added.filter(c=>sameCut&&c.boundedLogRef.includes(String(latest.workflow.id)));
 const selectCurrentCase=(phaseId,caseId,stem,passText)=>{
  const matches=currentCommands.filter(c=>c.boundedLogRef.endsWith("-"+stem+".log")),failed=matches.filter(c=>c.status==="FAIL"),passed=matches.filter(c=>c.status==="PASS");
  if(failed.length)setCase(phaseId,caseId,"FAIL",failed.map(c=>c.boundedLogRef).join("; ")+"; actual current-source execution failed. Historical successes are not promoted.");
  else if(passed.length)setCase(phaseId,caseId,"PASS",passed.map(c=>c.boundedLogRef).join("; ")+"; "+passText);
  else setCase(phaseId,caseId,"NOT_RUN",ciRef+"; no completed current-source command establishes this case. Historical command records remain separate.");
 };
 selectCurrentCase("BUILD_AND_SETUP","TypeScript-current-selected-check","lint","exact-cut full Windows TypeScript checking executed as part of the unchanged lint command.");
 selectCurrentCase("BUILD_AND_SETUP","production-build-current-selected-check","build-web","exact-cut production web builds completed. Installed execution requires separate artifact admission.");
 selectCurrentCase("INTEGRATION_NATIVE_CHECKPOINT","Hermes-pinned-compression-facade","native-facade","exact-cut pinned native facade/API checks passed offline.");
 selectCurrentCase("INTEGRATION_NATIVE_CHECKPOINT","Hermes-actual-Worker-compaction","native-worker","actual pinned Worker with scripted ACP summary, including persistence failure and cancellation, passed. No live provider spend is measured.");
 for(const [id,jobs] of [["BUILD_AND_SETUP",["Windows checks","Desktop build"]],["INTEGRATION_NATIVE_CHECKPOINT",["Hermes contracts"]]]){
  const phase=evidence.phases.find(p=>p.id===id);
  phase.status=jobs.some(currentFailed)||phase.requiredCases.some(c=>c.status==="FAIL")?"FAIL":jobs.every(successful)&&phase.requiredCases.every(c=>c.status==="PASS"||c.status==="EXPECTED_NEGATIVE")?"PASS":"BLOCKED";
 }
 if(appPass)setCase("REGRESSION_REQUIRED","current-M05-focused-regression","PASS","docs/implementation/v3/m05-logs/continuation-m11-final-memory-regression.log; preserved focused evidence is supplemented by all four current exact-source Windows application shards in "+ciRef+". Historical failures remain recorded.");
 if(admission){review.nativeMemoryExportRepair.status="ACTUAL_INSTALLED_DEFAULT_OFF_NATIVE_SAVE_VERIFIED";review.nativeMemoryExportRepair.actualWindowsExecution=admission.reviewRef;review.platformProofPreparation.installedRetention.execution="The current exact source cut passes the independent default-off retained-memory admission, including actual normal native Save and same-profile restart.";review.platformProofPreparation.installedRetention.nativeSaveStatus="ACTUAL_OWNED_NATIVE_SAVE_VERIFIED";review.platformProofPreparation.installedRetention.currentReviewRefs.push(admission.reviewRef);}
 const sourceLock=baseFiles["docs/implementation/v3/M05-source-lock.json"];if(hash(sourceLock)!==evidence.sourceLockDigest)throw new Error("Frozen source lock changed");
 putJSON("M05-log-policy.json",policy);putJSON("M05-continuation-history.json",history);putJSON("M05-provenance.json",provenance);putJSON("M05-continuation-review.json",review);
 for(const [path,content] of Object.entries(options.markdown??{}))put(path,content);
 const generated=["M05-verification.json","M05-evidence-integrity.json","M05-continuation-file-inventory.json"].map(x=>"docs/implementation/v3/"+x);
 const allPaths=[...new Set([...evidence.changedFiles,...Object.keys(output),...generated])].sort();
 if(allPaths.some(p=>!p||p.startsWith("/")||p.split("/").includes("..")))throw new Error("Invalid changed file path");
 evidence.changedFiles=allPaths;putJSON("M05-verification.json",evidence);
 const bundle=evidence.phases.some(p=>p.status==="FAIL"||p.requiredCases.some(c=>c.status==="FAIL"))?"FAIL":evidence.phases.every(p=>p.status==="PASS")?"PASS":evidence.phases.some(p=>p.status==="PASS")?"PARTIAL":"BLOCKED";
 const integrity=options.actualIntegrity??{schemaVersion:1,status:"NOT_RUN",purpose:"Evidence integrity only; not release approval or a passing implementation bundle.",implementationBundleStatus:bundle,executionBaseSha:provenance.acceptedBaseSha,inspectedPaths:read("M05-source-lock.json").inspectedPaths.length,verifiedCommandRecords:evidence.phases.reduce((n,p)=>n+p.commands.length,0),changedFiles:allPaths.length,reviewerApproval:false,errors:["The refreshed evidence has not yet been checked by the unchanged independent verifier."]};
 putJSON("M05-evidence-integrity.json",integrity);
 const oldInventory=new Map(inventory.files.map(x=>[x.path,x]));
 inventory.scope="Accepted-base changed-file set preserved from the reviewed published tree, plus exact documentation additions. New and modified bytes are verified against immutable Git blobs; current source/test/workflow equality is checked independently before final publication.";
 inventory.files=allPaths.map(path=>{
  if(path==="docs/implementation/v3/M05-continuation-file-inventory.json")return{path,sha256:null,bytes:null,note:"Inventory excludes its own hash to avoid a recursive digest."};
  const changed=options.sourceFiles?.[path]??output[path];
  if(changed)return{path,sha256:changed.sha256??hash(changed.content),bytes:changed.bytes??u.utf8(changed.content).length,trackedAtCapture:null,captureBasis:"Exact immutable Git object; no current local filesystem capture is claimed.",note:path.endsWith("/M05-evidence-integrity.json")?(options.actualIntegrity?"Actual output of the unchanged original verifier, followed by exact-output verification on the final documentation commit.":"The capture workflow must replace NOT_RUN with actual verifier output; final exact-output verification is required."):null};
  const prior=oldInventory.get(path);if(!prior)throw new Error("Missing inventory identity "+path);return prior;
 });
 putJSON("M05-continuation-file-inventory.json",inventory);
 return{files:output,evidence,policy,history,provenance,review,inventory,integrity,summary:{sourceHead,sourceTree,ciRef,currentCodeCut:sameCut,allJobsPass,installedAdmitted:!!admission,ledgerRows:allCommands.length,commandReferences:integrity.verifiedCommandRecords,changedFiles:allPaths.length,historicalFailures:history.historicalFailures.length,bundle,integrity:integrity.status}};
})(options);
