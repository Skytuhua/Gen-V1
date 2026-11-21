import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, Copy, FlaskConical, LoaderCircle, RotateCcw, X } from 'lucide-react';
import type { Operation, TestCaseV1, TestRunV1, TestSuite } from '../../../../packages/contracts/index.ts';
import { formatDuration, latestRerunByTest, rerunLabel, rerunState, runSummary}from './test-results-model.ts';
import { useTestTree } from './useTestTree.ts';
import './test-results-view.css';

function StatusIcon({ status }: { status: string }) {
  if (status === 'passed') return <Check size={13} className="tr-icon tr-pass" aria-hidden="true" />;
  if (status === 'failed') return <X size={13} className="tr-icon tr-fail" aria-hidden="true" />;
  if (status === 'skipped' || status === 'todo') return <ChevronRight size={13} className="tr-icon tr-skip" aria-hidden="true" />;
  return <LoaderCircle size={13} className="tr-icon" aria-hidden="true" />;
}

const failureCopy = (test: TestCaseV1): string => {
  const f = test.failure;
  if (!f) return '';
  const parts = [`FAIL ${test.fullName}`, f.message];
  if (f.expected !== undefined) parts.push(`Expected: ${f.expected}`);
  if (f.actual !== undefined) parts.push(`Actual: ${f.actual}`);
  if (f.stack?.length) parts.push(...f.stack.map(frame=>frame.text));
  return parts.join('\n');
};

function middleEllipsize(path: string, max = 60): string {
  return path.length <= max ? path : `${path.slice(0, Math.ceil(max / 2))}…${path.slice(-Math.floor(max / 2))}`;
}

function FailureDetail({ test, reruns, onRerun, announce }: { test: TestCaseV1; reruns?: Map<string, Operation>; onRerun?: (testId: string) => void; announce: (t: string) => void }) {
  const f = test.failure;
  const rerun = reruns?.get(test.id);
  const state = rerunState(rerun);
  return (
    <div className="tr-detail" role="group" aria-label={`Failure details for ${test.name}`}>
      {f?.message && <pre className="tr-message">{f.message}</pre>}
      {(f?.expected !== undefined || f?.actual !== undefined) && (
        <div className="tr-diff">
          {f?.expected !== undefined && <div className="tr-diff-side"><span className="tr-diff-label">Expected</span><pre className="tr-diff-code">{f.expected}</pre></div>}
          {f?.actual !== undefined && <div className="tr-diff-side"><span className="tr-diff-label">Actual</span><pre className="tr-diff-code">{f.actual}</pre></div>}
        </div>
      )}
      {f?.stack && f.stack.length > 0 && (
        <pre className="tr-stack">{f.stack.map(frame=>frame.text).join('\n')}{f.truncated ? '\n…' : ''}</pre>
      )}
      <div className="tr-actions">
        <button type="button" className="quiet" aria-label={`Copy failure for ${test.name}`} onClick={() => {
          void navigator.clipboard?.writeText(failureCopy(test)).then(() => announce('Failure copied'), () => announce('Copy failed'));
        }}><Copy size={13} />Copy failure</button>
        {onRerun && <button type="button" className="quiet" aria-label={`Rerun this test: ${test.name}`} onClick={() => onRerun(test.id)}><RotateCcw size={13} />Rerun this test</button>}
        {state && <span className={`tr-chip tr-chip-${state}`} data-testid={`rerun-${test.id}`} aria-label={rerunLabel[state]}>
          {state === 'running' && <LoaderCircle size={12} className="tr-spin" aria-hidden="true" />}{rerunLabel[state]}</span>}
      </div>
    </div>
  );
}

export function TestResults({ run, operation, rerunable, onRerun }: { run: TestRunV1; operation?: Operation; rerunable?: Operation[]; onRerun?: (testId: string) => void }) {
  const reruns = useMemo(() => (operation && rerunable ? latestRerunByTest(rerunable, operation.id) : new Map<string, Operation>()), [operation, rerunable]);
  const { collapsed, setCollapsed, open, rows, focusId, setFocusId, toggle, expandedTests, onKeyDown } = useTestTree(run);
  const [announcement, setAnnouncement] = useState('');
  const liveRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const seenChips = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    // New or changed rerun chips scroll into view and take focus (§7.4).
    for (const [testId, op] of reruns) {
      const state = rerunState(op);
      if (!state || seenChips.current.get(testId) === `${op.id}:${state}`) continue;
      seenChips.current.set(testId, `${op.id}:${state}`);
      const chip = cardRef.current?.querySelector<HTMLElement>(`[data-testid="rerun-${testId}"]`);
      chip?.scrollIntoView({ block: 'nearest' });
    }
  }, [reruns]);
  useEffect(() => {
    if (!focusId) return;
    cardRef.current?.querySelector<HTMLElement>(`[data-row-id="${focusId}"]`)?.focus();
  }, [focusId]);
  const announce = useCallback((text: string) => { setAnnouncement(''); requestAnimationFrame(() => setAnnouncement(text)); }, []);
  const copyTest = useCallback((testId: string) => {
    const test = run.suites.flatMap(function collect(s: TestSuite): TestCaseV1[] { return [...s.tests, ...s.suites.flatMap(collect)]; }).find(t => t.id === testId);
    if (test?.failure) void navigator.clipboard?.writeText(failureCopy(test)).then(() => announce('Failure copied'), () => announce('Copy failed'));
  }, [run, announce]);

  return (
    <section ref={cardRef} className="tr-card" aria-label="Test results" onKeyDown={event => onKeyDown(event, { rerun: onRerun ? t => onRerun(t) : undefined, copy: copyTest })}>
      <button type="button" className="tr-summary" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
        <FlaskConical size={14} className="tr-flask" aria-hidden="true" />
        <span className="tr-summary-text">{runSummary(run)}</span>
        <span className="tr-duration">{formatDuration(run.durationMs)}</span>
        <StatusIcon status={run.totals.failed > 0 ? 'failed' : run.totals.tests === 0 ? 'skipped' : 'passed'} />
      </button>
      {!collapsed && (
        <ul className="tr-tree" role="tree" aria-label="Test tree">
          {rows.map(row => {
            const status = row.kind === 'suite' ? row.suite!.status : row.test!.status;
            const expanded = row.kind === 'suite' ? open.has(row.id) : expandedTests.has(row.id);
            const rerun = row.kind === 'test' ? reruns.get(row.id) : undefined;
            const state = rerunState(rerun);
            return (
              <li key={row.id} role="treeitem" aria-expanded={row.expandable ? expanded : undefined} aria-selected={false}
                  aria-level={row.level} data-row-id={row.id} className={`tr-row tr-row-${status} ${focusId === row.id ? 'tr-focus' : ''}`}
                  style={{ paddingInlineStart: `${row.level * 16 + 8}px` }} tabIndex={focusId === row.id ? 0 : -1}
                  onClick={() => { setFocusId(row.id); toggle(row); }}
                  onFocus={() => setFocusId(row.id)}
                  aria-label={row.kind === 'suite' ? `${row.suite!.name} test file` : `${row.test!.name} ${status}`}>
                {row.expandable ? <ChevronRight size={12} className={`tr-caret ${expanded ? 'tr-caret-open' : ''}`} aria-hidden="true" /> : <span className="tr-caret-space" />}
                <StatusIcon status={status} />
                <span className="tr-name" title={row.kind === 'suite' ? row.suite!.file : row.test!.fullName}>
                  {row.kind === 'suite' ? middleEllipsize(row.suite!.name) : row.test!.name}
                </span>
                <span className="tr-row-duration">{formatDuration(row.kind === 'suite' ? row.suite!.tests.reduce((a, t) => a + (t.durationMs ?? 0), 0) || undefined : row.test!.durationMs)}</span>
                {row.kind === 'test' && row.test!.status === 'failed' && onRerun && !state && (
                  <button type="button" className="tr-rerun-quiet" aria-label={`Rerun ${row.test!.name}`} onClick={event => { event.stopPropagation(); onRerun(row.id); }}><RotateCcw size={12} /></button>
                )}
                {row.kind === 'test' && state && <span className={`tr-chip tr-chip-${state}`} aria-label={rerunLabel[state]}>{state === 'running' && <LoaderCircle size={11} className="tr-spin" aria-hidden="true" />}{rerunLabel[state]}</span>}
                {row.kind === 'test' && expanded && row.test!.failure && (
                  <FailureDetail test={row.test!} reruns={reruns} onRerun={onRerun} announce={announce} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div ref={liveRef} role="status" className="tr-live">{announcement}</div>
    </section>
  );
}
