return (function finalizeM05Evidence(draft, options) {
 const u=new Function(load("m05ByteUtilities"))(),hash=s=>u.sha256(u.utf8(s));
 const files={...draft.files};
 const put=(path,content)=>files[path]={path,content,bytes:u.utf8(content).length,sha256:hash(content)};
 const putJSON=(name,data)=>put("docs/implementation/v3/"+name,JSON.stringify(data,null,2)+"\n");
 const lockFile=options.sourceLock,lock=JSON.parse(lockFile.content);
 if(hash(lockFile.content)!==lockFile.sha256||lock.executionBaseSha!==options.acceptedBaseSha)throw Error("Unreviewed accepted source lock");
 if(new Set(lock.publicContracts.map(c=>c.name)).size!==lock.publicContracts.length)throw Error("Duplicate accepted contract names");
 if(!options.sourceInventory||!Array.isArray(options.sourceChangedPaths)||!options.sourceChangedPaths.length)throw Error("Actual immutable Git source inventory required");
 const baselineLock=load("m05NativePayload").entries.find(f=>f.path==="docs/implementation/v3/M05-source-lock.json");
 if(hash(baselineLock.content)!==options.historicalLock.sha256||baselineLock.content!==options.historicalLock.content)throw Error("Historical source lock changed");
 const evidence=JSON.parse(files["docs/implementation/v3/M05-verification.json"].content);
 const provenance=JSON.parse(files["docs/implementation/v3/M05-provenance.json"].content);
 const review=JSON.parse(files["docs/implementation/v3/M05-continuation-review.json"].content);
 const history=JSON.parse(files["docs/implementation/v3/M05-continuation-history.json"].content);
 const policy=JSON.parse(files["docs/implementation/v3/M05-log-policy.json"].content);
 put("docs/implementation/v3/M05-source-lock-399cde39.json",options.historicalLock.content);
 put("docs/implementation/v3/M05-source-lock.json",lockFile.content);
 evidence.baseSha=lock.executionBaseSha;evidence.sourceLockDigest=hash(lockFile.content);evidence.dependencyContracts=lock.publicContracts;
 provenance.acceptedBaseSha=lock.executionBaseSha;provenance.acceptedDependencyCommits=lock.acceptedDependencyCommits;
 provenance.repositoryRoot="/workspace/scratch/36f66011d961/m05-restored";
 provenance.origin="https://github.com/skytuhua-org/Gen-V1.git";
 provenance.currentPlatform="Current required application/native proof uses GitHub Actions Windows. Additional actual restored Linux command records retain their own platform, executable, times and outcomes.";
 provenance.commandCutLimitation="Historical command identities and failures remain unchanged. The selected Windows receipt binds the exact source head, checked-out commit and tree. The final source inventory is measured from immutable Git objects against the reviewed accepted main. Final documentation changes are validated by the unchanged original evidence verifier.";
 provenance.restoredWorkspace={source:"Fresh clone of the same canonical repository after executor restoration",originalWorktreesRecreated:false,localExecution:"Only separately captured actual commands are claimed; no former process or filesystem state is reconstructed as current."};
 provenance.evidenceAssembly.localExecutionClaim="Separately recorded restored Linux commands only; source and final artifact bytes are independently bound by their actual Git objects.";
 const refresh={recordedAt:options.recordedAt,priorAcceptedBaseSha:"399cde39ff4ee82272c7a7700944325c44b36070",acceptedBaseSha:lock.executionBaseSha,sourceLockDigest:hash(lockFile.content),historicalLockRef:"docs/implementation/v3/M05-source-lock-399cde39.json",reviewRef:options.baseReviewRef,contractRowsBefore:51,contractRowsAfter:16,purpose:"Accept already merged main fixes and deduplicate identical contract references. Prior execution remains bound to its actual historical source; no result is promoted."};
 if(options.intermediateAcceptedBases)refresh.intermediateAcceptedBases=options.intermediateAcceptedBases;
 provenance.acceptedBaseRefresh=refresh;history.acceptedBaseRefresh=refresh;review.acceptedMainSha=lock.executionBaseSha;review.acceptedBaseRefresh=refresh;
 const currentRefresh=history.refreshes.at(-1);
 if(!currentRefresh||currentRefresh.sourceParentHeadSha!==draft.summary.sourceHead||currentRefresh.recordedAt!==options.recordedAt)throw Error("Current history refresh identity mismatch");
 currentRefresh.executionBaseSha=lock.executionBaseSha;currentRefresh.acceptedBaseReviewRef=options.baseReviewRef;
 review.previousInstalledNativeSaveWindowsAttempt={runId:43760736519,headSha:"013c044d66f40136752df4f1903132d601d57851",treeSha:"f33ce0eac447d79520a0a98f120dac69c095a6be",jobsPassed:8,jobsFailed:1,application:{passed:3865,skipped:39,failed:0},browser:{passed:267,skipped:2,failed:0,flaky:0},installedRetention:{status:"FAIL_NATIVE_SAVE_DIALOG_TIMEOUT",completedLaunches:0,successfulSemanticSteps:["installed-default-off-read","exact-pinned-source","review-edit-accept-reject","rejected-record-retained"],nativeSave:"FAIL",forget:"NOT_RUN",restart:"NOT_RUN",reviewRef:"docs/implementation/v3/M05-installed-independent-phase-review-43760736519.json"}};
 review.priorFailedWindowsAttemptRefs=[...new Set([...review.priorFailedWindowsAttemptRefs,"docs/implementation/v3/M05-windows-ci-43760736519.json"])];

 // Keep the most recent historical attempts explicit without rewriting their receipts.
 if (options.priorWindowsReceiptRefs?.length) {
  const attempts = options.priorWindowsReceiptRefs.map(ref => {
   const file = files[ref]; if (!file) throw Error("Historical Windows receipt missing: " + ref);
   const receipt = JSON.parse(file.content);
   if (!receipt.complete || !Number.isSafeInteger(receipt.workflow?.id) || !/^[a-f0-9]{40}$/.test(receipt.headSha) || !/^[a-f0-9]{40}$/.test(receipt.treeSha)) throw Error("Historical Windows receipt is not terminal and immutable: " + ref);
   return {receiptRef:ref,runId:receipt.workflow.id,headSha:receipt.headSha,treeSha:receipt.treeSha,checkoutSha:receipt.testedCheckout.commitSha,checkoutTreeSha:receipt.testedCheckout.treeSha,matchesPublishedTree:receipt.testedCheckout.matchesPublishedTree,conclusion:receipt.workflow.conclusion,jobs:receipt.jobs.map(job=>({name:job.name,conclusion:job.conclusion})),application:receipt.applicationTestCounts,browser:receipt.jobs.find(job=>job.name==="Browser tests")?.testCounts?.totals??null};
  });
  review.priorWindowsAttempts=attempts;
  review.previousReviewedWindowsAttempt=attempts.at(-1);
  review.priorFailedWindowsAttemptRefs=[...new Set([...review.priorFailedWindowsAttemptRefs,...attempts.filter(attempt=>attempt.conclusion!=="success").map(attempt=>attempt.receiptRef)])];
  review.historicalFieldScope.previousInstalledNativeSaveWindowsAttempt="Earlier preserved Save-timeout attempt. Later immutable full-run outcomes are listed in priorWindowsAttempts; none is relabeled by subsequent repairs.";
 }
 const extraRefs=[options.baseReviewRef,"docs/implementation/v3/M05-installed-independent-phase-review-43760736519.json","docs/implementation/v3/M05-installed-ui-review-43760736519.json","docs/implementation/v3/M05-installed-artifact-recovery-43760736519.json","docs/implementation/v3/M05-installed-source-bindings-43760736519.json",...(options.additionalReviewRefs??[])];
 review.evidenceRefs=[...new Set([...review.evidenceRefs,...extraRefs])];
 const installed=evidence.phases.find(p=>p.id==="PLATFORM_NATIVE_STORAGE_AND_INSTALLED_DESKTOP");
 installed.artifactRefs=[...new Set([...installed.artifactRefs,...extraRefs.filter(p=>p!==options.baseReviewRef)])];
 evidence.phases.find(p=>p.id==="CORE").artifactRefs=[...new Set([...evidence.phases.find(p=>p.id==="CORE").artifactRefs,options.baseReviewRef,"docs/implementation/v3/M05-source-lock-399cde39.json"])];
 if(options.nativeSaveRepair)review.currentNativeSaveRepair=options.nativeSaveRepair;
 if(options.mainFixtureRepair)review.acceptedMainFixtureRepair=options.mainFixtureRepair;
 if(options.runtimeTaskPoolRepair)review.runtimeTaskPoolRepair=options.runtimeTaskPoolRepair;
 if(options.startupDiagnostics){review.currentStartupDiagnostics=options.startupDiagnostics;review.historicalFieldScope.installedStartupRepair="Earlier page-discovery budget repair, preserved with its original source and test claims. The later metadata-only startup diagnostics are documented in currentStartupDiagnostics.";}
 if(options.guardStartupRepair){review.currentGuardStartupRepair=options.guardStartupRepair;review.historicalFieldScope.currentStartupDiagnostics="Metadata-only startup diagnostics, preserved with their original source and test claims. The later measured Hermes guard startup allowance and nested-session bound are documented in currentGuardStartupRepair.";}
 // Reproduce capture provenance accurately for actual local subprocess records.
 for(const entry of policy.entries){
  const metaFile=files[entry.boundedLogRef.replace(/\.log$/,".meta.json")];if(!metaFile)continue;
  const meta=JSON.parse(metaFile.content);
  if(meta.capture==="Actual restored Linux process output; no reconstructed CI step envelope"){
   entry.fullRawOutputDigest=meta.rawOutputSha256;
   entry.rawOutputLimit="Actual restored Linux subprocess stdout/stderr capture. The full raw output digest/byte count is retained in metadata. A bounded derivative is identified separately if needed.";
  }
 }
 if(evidence.flags.some(f=>f.enabled!==false))throw Error("Memory flag activation refused");
 putJSON("M05-provenance.json",provenance);putJSON("M05-continuation-review.json",review);putJSON("M05-continuation-history.json",history);putJSON("M05-log-policy.json",policy);
 const generated=["M05-verification.json","M05-evidence-integrity.json","M05-continuation-file-inventory.json"].map(x=>"docs/implementation/v3/"+x);
 const paths=[...new Set([...options.sourceChangedPaths,...Object.keys(files),...generated])].sort();
 if(paths.some(p=>!p||p.startsWith("/")||p.split("/").includes("..")))throw Error("Invalid final changed path");
 evidence.changedFiles=paths;putJSON("M05-verification.json",evidence);
 const bundle=evidence.phases.some(p=>p.status==="FAIL"||p.requiredCases.some(c=>c.status==="FAIL"))?"FAIL":evidence.phases.every(p=>p.status==="PASS")?"PASS":evidence.phases.some(p=>p.status==="PASS")?"PARTIAL":"BLOCKED";
 const integrity=options.actualIntegrity??{schemaVersion:1,status:"NOT_RUN",purpose:"Evidence integrity only; not release approval or a passing implementation bundle.",implementationBundleStatus:bundle,executionBaseSha:lock.executionBaseSha,inspectedPaths:lock.inspectedPaths.length,verifiedCommandRecords:evidence.phases.reduce((n,p)=>n+p.commands.length,0),changedFiles:paths.length,reviewerApproval:false,errors:["The refreshed evidence has not yet been checked by the unchanged independent verifier."]};
 if(options.actualIntegrity&&(integrity.status!=="PASS"||integrity.errors.length||integrity.executionBaseSha!==lock.executionBaseSha||integrity.verifiedCommandRecords!==evidence.phases.reduce((n,p)=>n+p.commands.length,0)||integrity.changedFiles!==paths.length||integrity.implementationBundleStatus!==bundle))throw Error("Actual verifier output differs from the final frozen evidence shape");
 putJSON("M05-evidence-integrity.json",integrity);
 const inventory={schemaVersion:1,executionBaseSha:lock.executionBaseSha,scope:"Exact changed-file set from the current immutable source commit against accepted main, plus reviewed documentation additions. Current file identities are read from actual Git objects or computed from the exact final bytes; no historical filesystem scan is relabeled.",files:paths.map(path=>{
  if(path==="docs/implementation/v3/M05-continuation-file-inventory.json")return{path,sha256:null,bytes:null,note:"Inventory excludes its own hash to avoid a recursive digest."};
  const file=files[path]??options.sourceInventory[path];
  if(!file||!Number.isSafeInteger(file.bytes)||file.bytes<0||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error("Missing current file identity "+path);
  return{path,sha256:file.sha256,bytes:file.bytes,trackedAtCapture:files[path]?null:true,captureBasis:files[path]?"Exact final documentation bytes; current tracked state is verified separately.":"Actual immutable source Git object at "+draft.summary.sourceHead,note:path.endsWith("/M05-evidence-integrity.json")?(options.actualIntegrity?"Actual unchanged verifier output; exact final bytes are checked again after publication.":"Pending actual unchanged verifier execution."):null};
 })};
 putJSON("M05-continuation-file-inventory.json",inventory);
 return{...draft,files,evidence,policy,provenance,review,history,inventory,integrity,summary:{...draft.summary,acceptedBaseSha:lock.executionBaseSha,changedFiles:paths.length,bundle,integrity:integrity.status}};
})(draft,options);
