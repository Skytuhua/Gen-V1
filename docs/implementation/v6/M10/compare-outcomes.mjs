import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Identity comparison of full-suite outcomes on separate source cuts.
// Usage: node compare-outcomes.mjs <candidate-vitest-log> <baseline-vitest-log> [candidate-browser-root] [baseline-browser-root]
const [candidateLog, baselineLog, candidateBrowser, baselineBrowser] = process.argv.slice(2);
const failedIdentities = log => {
  const text = readFileSync(log, 'utf8').replace(/\x1b\[[0-9;]*m/g, '');
  const identities = new Set();
  for (const match of text.matchAll(/^\s*FAIL\s+(tests\/[^\s>]+(?:\s>\s[^\n]+)?)$/gm)) identities.add(match[1].replace(/\s+/g, ' ').trim());
  return identities;
};
const summary = log => {
  const text = readFileSync(log, 'utf8');
  const files = text.match(/Test Files\s+(.+)/)?.[1] ?? 'unknown';
  const tests = text.match(/Tests\s+(.+)/)?.[1] ?? 'unknown';
  return { files, tests };
};
if (candidateLog && baselineLog) {
  const candidate = failedIdentities(candidateLog), baseline = failedIdentities(baselineLog);
  const candidateOnly = [...candidate].filter(id => !baseline.has(id)).sort();
  const baselineOnly = [...baseline].filter(id => !candidate.has(id)).sort();
  const shared = [...candidate].filter(id => baseline.has(id)).sort();
  console.log(JSON.stringify({
    candidateSummary: summary(candidateLog), baselineSummary: summary(baselineLog),
    candidateFailedIdentities: candidate.size, baselineFailedIdentities: baseline.size,
    shared: shared.length, candidateOnly, baselineOnly,
  }, null, 2));
}
const browserFailures = root => {
  if (!root || !existsSync(root)) return null;
  const failures = new Set();
  const suites = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === 'results.json') {
        try {
          const report = JSON.parse(readFileSync(path, 'utf8'));
          for (const suite of report.suites ?? []) {
            const collect = (node, file) => {
              for (const spec of node.specs ?? []) for (const test of spec.tests ?? []) for (const result of test.results ?? []) if (result.status === 'failed' || result.status === 'timedOut') failures.add(`${file} > ${spec.title}`);
              for (const child of node.suites ?? []) collect(child, file);
            };
            collect(suite, suite.file ?? suite.title);
          }
        } catch { /* partial report */ }
      }
    }
  };
  walk(root);
  return failures;
};
if (candidateBrowser && baselineBrowser) {
  const candidate = browserFailures(candidateBrowser) ?? new Set(), baseline = browserFailures(baselineBrowser) ?? new Set();
  console.log(JSON.stringify({
    browserCandidateFailures: candidate.size, browserBaselineFailures: baseline.size,
    browserCandidateOnly: [...candidate].filter(id => !baseline.has(id)).sort(),
    browserBaselineOnly: [...baseline].filter(id => !candidate.has(id)).sort(),
  }, null, 2));
}
