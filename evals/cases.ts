import { createHash } from "node:crypto";
export type Category = "coding" | "research-data" | "documents" | "planning" | "novel-apps";
export interface EvalCase { readonly id: string; readonly category: Category; readonly prompt: string; readonly checks: readonly string[]; readonly mandatoryNovel?: boolean }
export const CASESET_VERSION = "heldout-v1";
// Frozen before model execution. Never import this module into a model's tool catalog/training prompt.
export const CASES: readonly EvalCase[] = Object.freeze([
  { id: "coding-quantity", category: "coding", prompt: "Inspect repository/calculator.mjs and quantity.test.mjs. Build an inline review of the bug with source evidence, prepare the smallest single-file fix, and prepare the exact named node-test recipe. Await approval; report only actual execution results.", checks: ["source-provenance", "structured-artifact", "prepared-operation", "correctness-review"] },
  { id: "coding-conflict", category: "coding", prompt: "Use actual Git status, diff and history in the granted repository to explain its merge conflict. Show both decisions in an inline diff and ask for a decision with persistent controls. Do not stage, commit or invent a resolution.", checks: ["source-provenance", "structured-artifact", "persistent-state", "correctness-review"] },
  { id: "coding-failed-test", category: "coding", prompt: "Prepare the exact node-test recipe for repository/fail.test.mjs. After user approval, display the actual exit and failure output. Preserve the intentionally failing file and never label it passing.", checks: ["prepared-operation", "actual-test-failure", "correctness-review"] },
  { id: "research-reconcile", category: "research-data", prompt: "Import both research sources. Reconcile North and South shipment counts, explain the withdrawn South 11 claim and differing on-time definition. Publish reusable evidence data and an inline comparison with provenance.", checks: ["source-provenance", "data-binding", "structured-artifact", "correctness-review"] },
  { id: "data-sqlite", category: "research-data", prompt: "Inspect the selected external SQLite database. Show task counts and prepare a transaction marking task 1 done with an exact expected changed-row count of 1. Explain approval and stale version behavior. Do not access harness storage.", checks: ["source-provenance", "prepared-operation", "data-binding", "correctness-review"] },
  { id: "data-cross-category", category: "research-data", prompt: "Import the records JSON and both research documents, publish a common sourced dataset and create a chart plus evidence list sharing data bindings. Explain counts without treating synthesis as independent verification.", checks: ["source-provenance", "data-binding", "structured-artifact", "correctness-review"] },
  { id: "document-form", category: "documents", prompt: "Inspect editable.pdf including its text, fields and limitations. Create a persistent form for fullName, consent and role. Ask the user for values, then prepare a new local PDF export; never email it or invent certificate signing.", checks: ["source-provenance", "persistent-state", "structured-artifact", "correctness-review"] },
  { id: "document-signature", category: "documents", prompt: "Build a local PDF visual signature placement workflow for editable.pdf. Support typed or drawn marks on page 1 at an explicitly previewed location. Clearly state no certificate, OCR or email support; preserve the original and require approval for a new export.", checks: ["source-provenance", "persistent-state", "prepared-operation", "correctness-review"] },
  { id: "planning-budget", category: "planning", prompt: "Use sources/planning.md to build an editable budget and dependency plan. Show total cost, prerequisites, weekly volunteer capacity and feasible ordering. Inputs must persist and actions must return meaningful data to this thread.", checks: ["source-provenance", "persistent-state", "structured-artifact", "correctness-review"] },
  { id: "planning-whatif", category: "planning", prompt: "From sources/planning.md build an interactive what-if planner for a 20 percent budget reduction and one volunteer becoming unavailable. Ask which scope to reduce, preserve the user's decision and show which source facts and assumptions drive the recommendation.", checks: ["source-provenance", "persistent-state", "structured-artifact", "correctness-review"] },
  { id: "novel-custody", category: "novel-apps", mandatoryNovel: true, prompt: "Read sources/novel.md. Generate a purpose-built interactive tidepool specimen custody handoff app as an isolated widget, with receiver/timestamp/source-note editing and meaningful submit action. Reuse source data, preserve edits through expand and remount, and checkpoint state. Do not fit this into a new fixed app screen.", checks: ["source-provenance", "data-binding", "widget-artifact", "persistent-state", "novel-interaction-review", "correctness-review"] },
  { id: "novel-evidence-map", category: "novel-apps", mandatoryNovel: true, prompt: "Create a purpose-built interactive contradiction map from the two research sources as an isolated widget. Let the user link claims, annotate uncertainty and submit a synthesis decision back to the agent. Reuse sourced data and preserve edits through expansion and remount.", checks: ["source-provenance", "data-binding", "widget-artifact", "persistent-state", "novel-interaction-review", "correctness-review"] },
].map(item => Object.freeze({ ...item, checks: Object.freeze(item.checks) })) as EvalCase[]);
export const CASESET_SHA256 = createHash("sha256").update(JSON.stringify(CASES)).digest("hex");
export const FROZEN_CASESET_SHA256 = "b44f476e974f0e0f3a44da6b62ed13ce5c4036f9d8bd58aa0ff38025d0a04275";
export const PILOT_POLICY = Object.freeze({ version: "replacement-plan-v1", repetitions: 3, successfulRuns: 30, successfulScenarios: 10, scenarioSuccesses: 2, designatedNovel: "novel-custody" });
if (CASESET_SHA256 !== FROZEN_CASESET_SHA256) throw new Error("Held-out cases changed; create a deliberately versioned new case set before execution");
export interface EvalAssertion { id: string; status: "pass" | "fail" | "pending"; evidence: string }
export interface EvalResult {
  caseId: string; repetition?: number; modelId: string; status: "completed" | "failed" | "pending";
  executionOutcome?: "ready" | "working" | "awaiting_input" | "completed" | "failed" | "interrupted" | "stopped";
  source?: "host-pi"; threadId?: string; sessionPath?: string; snapshotSeq?: number;
  assertions: EvalAssertion[];
}
export function scoreResults(results: EvalResult[], repetitions = 3) {
  const categories = [...new Set(CASES.map(c => c.category))];
  const slots = CASES.flatMap(c => Array.from({ length: repetitions }, (_, i) => ({ c, repetition: i + 1 })));
  const scored = slots.map(({ c, repetition }) => {
    const matching = results.filter(r => r.caseId === c.id && (r.repetition ?? 1) === repetition);
    const result = matching.length === 1 ? matching[0] : undefined;
    const authentic = !!result && result.source === "host-pi" && !!result.modelId && !!result.threadId && !!result.sessionPath && Number.isInteger(result.snapshotSeq);
    const complete = authentic && !!result.executionOutcome && result.status !== "pending" && c.checks.every(check => result.assertions.filter(a => a.id === check && a.status !== "pending" && a.evidence.trim().length > 0).length === 1);
    const score = complete ? c.checks.filter(check => result!.assertions.some(a => a.id === check && a.status === "pass")).length / c.checks.length : null;
    return { caseId: c.id, category: c.category, repetition, complete, score, successful: complete && result?.executionOutcome === "completed" && result.status === "completed" && score === 1, mandatoryNovel: c.id === PILOT_POLICY.designatedNovel };
  });
  const all = scored.every(s => s.complete), successfulRuns = scored.filter(s => s.successful).length;
  const aggregate = all ? successfulRuns / scored.length : null;
  const categoryScores = Object.fromEntries(categories.map(category => {
    const entries = scored.filter(s => s.category === category); return [category, entries.every(e => e.complete) ? entries.filter(e => e.successful).length / entries.length : null];
  }));
  const novel = scored.filter(s => s.mandatoryNovel);
  const minimum = Math.min(repetitions, PILOT_POLICY.scenarioSuccesses);
  const scenarioSuccesses = Object.fromEntries(CASES.map(c => [c.id, scored.filter(s => s.caseId === c.id && s.successful).length]));
  const successfulScenarios = Object.values(scenarioSuccesses).filter(count => count >= minimum).length;
  const mandatoryNovelGate = novel.filter(s => s.successful).length >= minimum ? "pass" : novel.every(s => s.complete) ? "fail" : "pending";
  const categoryGate = categories.every(category => CASES.some(c => c.category === category && scenarioSuccesses[c.id] >= minimum)) ? "pass" : all ? "fail" : "pending";
  const scenarioGate = successfulScenarios >= PILOT_POLICY.successfulScenarios ? "pass" : all ? "fail" : "pending";
  const aggregateGate = successfulRuns >= Math.ceil(PILOT_POLICY.successfulRuns * repetitions / PILOT_POLICY.repetitions) ? "pass" : all ? "fail" : "pending";
  const pilotEligible = repetitions === PILOT_POLICY.repetitions;
  const status = !all || !pilotEligible ? "pending" : [aggregateGate, scenarioGate, categoryGate, mandatoryNovelGate].every(g => g === "pass") ? "pass" : "fail";
  return { version: CASESET_VERSION, policy: PILOT_POLICY, pilotEligible, casesetSha256: CASESET_SHA256, status, aggregate, aggregateGate, successfulRuns, successfulScenarios, scenarioSuccesses, scenarioGate, categoryScores, categoryGate, mandatoryNovelGate, completed: scored.filter(s => s.complete).length, expected: scored.length, cases: scored };
}
