import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { TEST_RUN_LIMITS, testRunV1Schema, type TestCaseV1, type TestRunV1, type TestSuite } from '../contracts/test-results.ts';

const L = TEST_RUN_LIMITS;
const hash16 = (...parts: string[]) => createHash('sha256').update(parts.join('')).digest('hex').slice(0, 16);
const cap = (text: unknown, limit: number) => {
  if (text === undefined || text === null) return undefined;
  const s = String(text);
  return s.length > limit ? s.slice(0, limit) : s;
};
const projectPath = (file: unknown, cwd: string) => {
  if (typeof file !== 'string' || !file) return undefined;
  const rel = isAbsolute(file) ? relative(cwd, file) : file;
  if (rel.startsWith('..') || isAbsolute(rel)) return undefined;
  return rel.split(sep).join('/');
};
const emptyTotals = () => ({ tests: 0, passed: 0, failed: 0, skipped: 0, todo: 0 });

/** Fresh Gen-owned report directory for one approved run. */
export async function createReportDir(dataDir: string): Promise<string> {
  const root = join(dataDir, 'test-reports');
  await mkdir(root, { recursive: true, mode: 0o700 });
  return mkdtemp(join(root, `run-${randomBytes(8).toString('hex')}-`));
}
export async function removeReportDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

type Totals = ReturnType<typeof emptyTotals>;
interface Built { suites: TestSuite[]; totals: Totals; truncated: boolean }

function suiteStatus(suite: TestSuite): 'passed' | 'failed' | 'skipped' {
  const deep = (s: TestSuite): TestCaseV1[] => [...s.tests, ...s.suites.flatMap(deep)];
  const all = deep(suite);
  if (all.some(t => t.status === 'failed')) return 'failed';
  if (all.length > 0 && all.every(t => t.status === 'skipped' || t.status === 'todo')) return 'skipped';
  return 'passed';
}

function finalize(suite: TestSuite): TestSuite {
  suite.suites = suite.suites.map(finalize);
  suite.status = suiteStatus(suite);
  return suite;
}

function applyLimits(built: Built): { suites: TestSuite[]; truncated: boolean } {
  const countSuites = (s: TestSuite[]): number => s.reduce((n, x) => n + 1 + countSuites(x.suites), 0);
  const countTests = (s: TestSuite[]): number => s.reduce((n, x) => n + x.tests.length + countTests(x.suites), 0);
  if (countSuites(built.suites) <= L.suites && countTests(built.suites) <= L.tests) return { suites: built.suites, truncated: false };
  // Keep failures first, then the rest in run order; suites keep their tests.
  let suites = 0, tests = 0;
  const keep = (list: TestSuite[]): TestSuite[] => list.flatMap(s => {
    if (suites >= L.suites) return [];
    suites += 1;
    const failedFirst = [...s.tests].sort((a, b) => Number(b.status === 'failed') - Number(a.status === 'failed'));
    const keptTests = failedFirst.filter(() => tests < L.tests && (tests += 1, true));
    return [{ ...s, tests: keptTests, suites: keep(s.suites) }];
  });
  const order = [...built.suites].sort((a, b) => Number(b.status === 'failed') - Number(a.status === 'failed'));
  return { suites: keep(order), truncated: true };
}

/** Parses the stack of an error into project-relative frames (outside-project frames dropped). */
function parseStack(stack: unknown, cwd: string): { frames: NonNullable<NonNullable<TestCaseV1['failure']>['stack']>; truncated: boolean } {
  const frames: NonNullable<NonNullable<TestCaseV1['failure']>['stack']> = [];
  if (typeof stack !== 'string') return { frames, truncated: false };
  for (const raw of stack.split('\n')) {
    const line = raw.trimEnd();
    const m = line.match(/\(?((?:[A-Za-z]:)?[^\s()]+):(\d+):(\d+)\)?\s*$/);
    if (!m) continue;
    const file = projectPath(m[1], cwd);
    if (!file) continue; // outside the granted project
    if (frames.length < L.stackFrames) frames.push({ file, line: Number(m[2]), column: Number(m[3]), text: line.slice(0, 500) });
  }
  return { frames, truncated: frames.length >= L.stackFrames };
}

interface NodeEvent { type: string; name?: string; nesting?: number; file?: string; line?: number; column?: number; kind?: string; skip?: boolean; todo?: boolean; durationMs?: number; error?: { message?: string; expected?: unknown; actual?: unknown; stack?: string } }

function normalizeNodeTest(text: string, cwd: string): Built {
  const roots = new Map<string, TestSuite>();
  const stack: TestSuite[] = [];
  const totals = emptyTotals();
  const rootFor = (file: string): TestSuite => {
    let root = roots.get(file);
    if (!root) { root = { id: `s${hash16(file)}`, name: file, file, status: 'passed', suites: [], tests: [] }; roots.set(file, root); }
    return root;
  };
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    let ev: NodeEvent;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type !== 'pass' && ev.type !== 'fail') continue;
    const file = projectPath(ev.file, cwd) ?? 'unknown';
    const root = rootFor(file);
    const nesting = typeof ev.nesting === 'number' ? ev.nesting : 0;
    while (stack.length > nesting) stack.pop();
    const parent = stack.length ? stack[stack.length - 1] : root;
    if (ev.kind === 'suite') {
      const name = cap(ev.name, L.nameChars) ?? '';
      const suite: TestSuite = { id: `s${hash16(file, name, String(nesting), String(parent.id))}`, name, file, status: 'passed', suites: [], tests: [] };
      parent.suites.push(suite);
      stack.push(suite);
      continue;
    }
    const name = cap(ev.name, L.nameChars) ?? '';
    const ancestors = stack.map(s => s.name).filter(Boolean);
    const fullName = cap([...ancestors, name].filter(Boolean).join(' '), L.nameChars * 4) ?? name;
    const status: TestCaseV1['status'] = ev.todo ? 'todo' : ev.skip ? 'skipped' : ev.type === 'pass' ? 'passed' : 'failed';
    const t: TestCaseV1 = {
      id: `t${hash16(file, fullName)}`, name, fullName, status,
      ...(typeof ev.durationMs === 'number' ? { durationMs: ev.durationMs } : {}),
      ...(typeof ev.line === 'number' ? { location: { file, line: ev.line, ...(typeof ev.column === 'number' ? { column: ev.column } : {}) } } : {}),
    };
    if (ev.type === 'fail' && ev.error) {
      const { frames, truncated } = parseStack(ev.error.stack, cwd);
      t.failure = {
        message: cap(ev.error.message, L.messageChars) ?? 'Test failed',
        ...(ev.error.expected !== undefined ? { expected: cap(ev.error.expected, L.expectedChars) } : {}),
        ...(ev.error.actual !== undefined ? { actual: cap(ev.error.actual, L.expectedChars) } : {}),
        stack: frames, truncated,
      };
    }
    totals.tests += 1;
    totals[t.status === 'todo' ? 'todo' : t.status] += 1;
    parent.tests.push(t);
  }
  return { suites: [...roots.values()].map(finalize), totals, truncated: false };
}

interface VitestAssertion { ancestorTitles?: string[]; title?: string; fullName?: string; status?: string; duration?: number; failureMessages?: string[]; location?: { line?: number; column?: number } }
interface VitestFile { name?: string; assertionResults?: VitestAssertion[] }
interface VitestReport { numTotalTests?: number; numPassedTests?: number; numFailedTests?: number; numPendingTests?: number; numTodoTests?: number; testResults?: VitestFile[]; startTime?: number; endTime?: number }

function normalizeVitest(text: string, cwd: string): Built & { durationMs?: number } {
  const parsed = JSON.parse(text) as VitestReport;
  const totals = emptyTotals();
  const suites: TestSuite[] = [];
  for (const fileResult of parsed.testResults ?? []) {
    const file = projectPath(fileResult.name, cwd) ?? 'unknown';
    const root: TestSuite = { id: `s${hash16(file)}`, name: file, file, status: 'passed', suites: [], tests: [] };
    const byPath = new Map<string, TestSuite>();
    for (const a of fileResult.assertionResults ?? []) {
      const ancestors = (a.ancestorTitles ?? []).map(x => cap(x, L.nameChars) ?? '');
      let parent = root;
      let prefix = '';
      for (const name of ancestors) {
        prefix = prefix ? `${prefix} ${name}` : name;
        let next = parent.suites.find(s => s.name === name) ?? byPath.get(prefix);
        if (!next) {
          next = { id: `s${hash16(file, prefix)}`, name, file, status: 'passed', suites: [], tests: [] };
          parent.suites.push(next); byPath.set(prefix, next);
        }
        parent = next;
      }
      const title = cap(a.title, L.nameChars) ?? '';
      const fullName = cap(a.fullName ?? [...ancestors, title].filter(Boolean).join(' '), L.nameChars * 4) ?? title;
      const status: TestCaseV1['status'] = a.status === 'passed' ? 'passed' : a.status === 'failed' ? 'failed' : a.status === 'todo' ? 'todo' : 'skipped';
      const t: TestCaseV1 = {
        id: `t${hash16(file, fullName)}`, name: title || fullName, fullName, status,
        ...(typeof a.duration === 'number' ? { durationMs: a.duration } : {}),
        ...(a.location?.line ? { location: { file, line: a.location.line, ...(a.location.column ? { column: a.location.column } : {}) } } : {}),
      };
      if (status === 'failed' && (a.failureMessages?.length ?? 0) > 0) {
        const message = cap(a.failureMessages!.join('\n'), L.messageChars) ?? 'Test failed';
        const { frames, truncated } = parseStack(message, cwd);
        t.failure = { message, stack: frames, truncated };
      }
      totals.tests += 1;
      totals[status] += 1;
      parent.tests.push(t);
    }
    suites.push(root);
  }
  const durationMs = typeof parsed.startTime === 'number' && typeof parsed.endTime === 'number' ? Math.max(0, parsed.endTime - parsed.startTime) : undefined;
  return { suites: suites.map(finalize), totals, truncated: false, durationMs };
}

const emptyRun = (recipe: 'node-test' | 'vitest', reportState: TestRunV1['reportState'], reportProblem?: string): TestRunV1 =>
  ({ version: 1, runner: recipe, reportState, ...(reportProblem ? { reportProblem: cap(reportProblem, 500) } : {}), totals: emptyTotals(), suites: [], truncated: false });

/**
 * Reads and normalizes the runner report inside a Gen-owned report directory.
 * Never throws: every failure degrades to a reportState with empty suites.
 */
export async function collectTestReport(dir: string | undefined, recipe: 'node-test' | 'vitest', cwd: string,
  filter?: { testName: string }, rerunOf?: { operationId: string; testId: string }): Promise<TestRunV1> {
  const decorate = (run: TestRunV1): TestRunV1 => ({ ...run, ...(filter ? { filter } : {}), ...(rerunOf ? { rerunOf } : {}) });
  if (!dir) return decorate(emptyRun(recipe, 'missing', 'No report directory was available'));
  const file = join(dir, recipe === 'node-test' ? 'node-test.jsonl' : 'vitest.json');
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.nlink !== 1) return decorate(emptyRun(recipe, 'invalid', 'Report output was not a regular file'));
    if (info.size > L.reportBytes) return decorate(emptyRun(recipe, 'invalid', 'Report output exceeded the size limit'));
    if (info.size === 0) return decorate(emptyRun(recipe, 'missing', 'The runner produced no report output'));
    const handle = await open(file, 'r');
    const text = await handle.readFile('utf8');
    await handle.close();
    let built: Built & { durationMs?: number };
    try { built = recipe === 'node-test' ? normalizeNodeTest(text, cwd) : normalizeVitest(text, cwd); }
    catch { return decorate(emptyRun(recipe, 'invalid', 'Report output could not be parsed')); }
    const { suites, truncated } = applyLimits(built);
    const run: TestRunV1 = {
      version: 1, runner: recipe, reportState: truncated ? 'partial' : 'complete',
      ...(truncated ? { reportProblem: 'Results were truncated to the display limits' } : {}),
      totals: built.totals, ...(built.durationMs !== undefined ? { durationMs: built.durationMs } : {}),
      suites, truncated,
    };
    const check = testRunV1Schema.safeParse(run);
    if (!check.success) return decorate(emptyRun(recipe, 'invalid', 'Normalized report failed schema validation'));
    return decorate(check.data);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    return decorate(emptyRun(recipe, 'missing', code === 'ENOENT' ? 'The runner produced no report output' : 'Report output could not be read'));
  }
}
