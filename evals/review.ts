import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CASES, CASESET_SHA256, scoreResults, type EvalResult } from "./cases.ts";
const reviewSchema = z.strictObject({ caseId: z.string(), repetition: z.number().int().min(1).max(3), checkId: z.string(), status: z.enum(["pass", "fail"]), evidence: z.string().min(1).max(10_000), reviewer: z.string().min(1).max(200) });
export function applyReviews(results: EvalResult[], reviews: unknown[]): EvalResult[] {
  const parsed = z.array(reviewSchema).parse(reviews), updated = structuredClone(results), used = new Set<string>();
  for (const review of parsed) {
    const id = `${review.caseId}/${review.repetition}/${review.checkId}`;
    if (used.has(id)) throw new Error(`Duplicate review ${id}`); used.add(id);
    const testCase = CASES.find(c => c.id === review.caseId);
    if (!testCase?.checks.includes(review.checkId)) throw new Error(`Unknown frozen case/check: ${id}`);
    const matching = updated.filter(r => r.caseId === review.caseId && (r.repetition ?? 1) === review.repetition);
    if (matching.length !== 1) throw new Error(`Review requires one existing execution result: ${id}`);
    const result = matching[0];
    const assertion = { id: review.checkId, status: review.status, evidence: `Human reviewer ${review.reviewer}: ${review.evidence}` };
    result.assertions = [...result.assertions.filter(a => a.id !== review.checkId), assertion];
    if (testCase.checks.every(check => result.assertions.some(a => a.id === check && a.status !== "pending"))) {
      // Judgments cannot turn a stopped, failed or unfinished execution into a
      // completed task. That outcome comes only from the recorded host snapshot.
      result.status = result.executionOutcome === "completed" ? result.assertions.some(a => a.status === "fail") ? "failed" : "completed" : ["failed", "stopped", "interrupted"].includes(result.executionOutcome ?? "") ? "failed" : "pending";
    }
  }
  // This changes assertions only; it never supplies model/session/source identity. Missing real-model runs remain pending in scoreResults.
  return updated;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [resultsPath, reviewsPath, outputPath] = process.argv.slice(2);
  if (!resultsPath || !reviewsPath || !outputPath || process.argv.length !== 5) { console.error("Usage: pnpm exec tsx evals/review.ts <results.json> <judgments.json> <NEW-report.json>"); process.exitCode = 2; }
  else (async () => {
    const report = JSON.parse(await readFile(resultsPath, "utf8"));
    if (report.score?.casesetSha256 !== CASESET_SHA256) throw new Error("Results do not match the frozen case set");
    const results = applyReviews(report.results, JSON.parse(await readFile(reviewsPath, "utf8")));
    const repetitions = report.score.expected / CASES.length;
    const reviewed = { ...report, reviewedAt: new Date().toISOString(), results, score: scoreResults(results, repetitions) };
    await writeFile(outputPath, JSON.stringify(reviewed, null, 2), { flag: "wx" }); console.log(JSON.stringify(reviewed.score, null, 2)); if (reviewed.score.status !== "pass") process.exitCode = 2;
  })().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
