import { expect, it } from "vitest";
import { CASES, scoreResults, type EvalResult } from "../evals/cases.ts";
import { applyReviews } from "../evals/review.ts";

// Synthetic ledger inputs test scoring only; they are never execution evidence.
function ledger(): EvalResult[] { return CASES.flatMap(c => [1,2,3].map(repetition => ({ caseId:c.id, repetition, modelId:"scoring-fixture", source:"host-pi", threadId:c.id, sessionPath:c.id, snapshotSeq:1, status:"completed", executionOutcome:"completed", assertions:c.checks.map(id => ({id,status:"pass",evidence:"Synthetic scoring fixture"})) }))); }
function fail(result: EvalResult) { result.assertions[0].status = "fail"; }
it.each(["stopped","failed","interrupted"] as const)("cannot turn a recorded %s execution into success through judgments",outcome=>{
 const results=ledger().map(row=>({...row,status:"pending" as const,executionOutcome:outcome}));
 const reviews=results.flatMap(row=>row.assertions.map(a=>({caseId:row.caseId,repetition:row.repetition,checkId:a.id,status:"pass",reviewer:"Scoring fixture",evidence:"Synthetic positive judgment"})));
 const reviewed=applyReviews(results,reviews);
 expect(reviewed.every(row=>row.executionOutcome===outcome)).toBe(true);
 expect(scoreResults(reviewed)).toMatchObject({status:"fail",successfulRuns:0});
});
it("counts whole successful runs rather than averaging partial checks",()=>{
 const results=ledger(); for(const result of results.slice(0,7))fail(result);
 expect(scoreResults(results)).toMatchObject({status:"fail",successfulRuns:29,aggregateGate:"fail"});
});
it("requires ten scenarios to succeed at least twice independently of 30 run successes",()=>{
 const results=ledger(); for(const c of CASES.slice(0,3))for(const result of results.filter(r=>r.caseId===c.id).slice(0,2))fail(result);
 expect(scoreResults(results)).toMatchObject({status:"fail",successfulRuns:30,successfulScenarios:9,scenarioGate:"fail"});
});
it("cannot pass with a completely broken category",()=>{
 const results=ledger(); for(const result of results.filter(r=>CASES.find(c=>c.id===r.caseId)?.category==="planning"))fail(result);
 expect(scoreResults(results)).toMatchObject({status:"fail",successfulRuns:30,successfulScenarios:10,categoryGate:"fail"});
});
it("requires the designated novel scenario twice",()=>{
 const results=ledger(); for(const result of results.filter(r=>r.caseId==="novel-custody").slice(0,2))fail(result);
 expect(scoreResults(results)).toMatchObject({status:"fail",successfulRuns:34,mandatoryNovelGate:"fail"});
});
it("accepts the specified 30/36, ten-scenario, category and designated-novel boundary",()=>{
 const results=ledger(); for(const id of ["coding-quantity","research-reconcile"])for(const result of results.filter(r=>r.caseId===id))fail(result);
 expect(scoreResults(results)).toMatchObject({status:"pass",successfulRuns:30,successfulScenarios:10,aggregateGate:"pass",categoryGate:"pass",mandatoryNovelGate:"pass"});
});
