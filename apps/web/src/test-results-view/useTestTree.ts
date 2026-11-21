import { useMemo, useState, type KeyboardEvent } from 'react';
import type { TestCaseV1, TestRunV1, TestSuite } from '../../../../packages/contracts/index.ts';

export interface TreeRow {
  id: string;
  kind: 'suite' | 'test';
  level: number;
  suite?: TestSuite;
  test?: TestCaseV1;
  expandable: boolean;
}

/** Visible rows in tree order under the current open-state. */
export function visibleRows(run: TestRunV1, open: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (suite: TestSuite, level: number, parentOpen: boolean) => {
    if (!parentOpen) return;
    rows.push({ id: suite.id, kind: 'suite', level, suite, expandable: suite.suites.length + suite.tests.length > 0 });
    if (!open.has(suite.id)) return;
    for (const child of suite.suites) walk(child, level + 1, true);
    for (const test of suite.tests) rows.push({ id: test.id, kind: 'test', level: level + 1, test, expandable: test.status === 'failed' && Boolean(test.failure) });
  };
  for (const root of run.suites) {
    rows.push({ id: root.id, kind: 'suite', level: 1, suite: root, expandable: root.suites.length + root.tests.length > 0 });
    if (open.has(root.id)) {
      for (const child of root.suites) walk(child, 2, true);
      for (const test of root.tests) rows.push({ id: test.id, kind: 'test', level: 2, test, expandable: test.status === 'failed' && Boolean(test.failure) });
    }
  }
  return rows;
}

/** Open state: suites default open when they contain a failure; tests expand via expandedTests. */
export function defaultOpen(run: TestRunV1): Set<string> {
  const open = new Set<string>();
  const visit = (suite: TestSuite) => { if (suite.status === 'failed') open.add(suite.id); suite.suites.forEach(visit); };
  run.suites.forEach(s => { open.add(s.id); visit(s); });
  return open;
}

export function useTestTree(run: TestRunV1) {
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => defaultOpen(run));
  const [expandedTests, setExpandedTests] = useState<Set<string>>(() => new Set());
  const [focusId, setFocusId] = useState<string | undefined>();
  const rows = useMemo(() => (collapsed ? [] : visibleRows(run, open)), [run, open, expandedTests, collapsed]);

  const toggleSuite = (id: string) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleTest = (id: string) => setExpandedTests(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggle = (row: TreeRow) => { if (row.kind === 'suite') toggleSuite(row.id); else if (row.expandable) toggleTest(row.id); };

  const onKeyDown = (event: KeyboardEvent, actions?: { rerun?: (id: string) => void; copy?: (id: string) => void }) => {
    const index = rows.findIndex(r => r.id === focusId);
    const row = index >= 0 ? rows[index] : undefined;
    const move = (next: number) => { const target = rows[next]; if (target) { setFocusId(target.id); } };
    switch (event.key) {
      case 'ArrowDown': if (index < rows.length - 1) { event.preventDefault(); move(index + 1); } break;
      case 'ArrowUp': if (index > 0) { event.preventDefault(); move(index - 1); } break;
      case 'Home': event.preventDefault(); move(0); break;
      case 'End': event.preventDefault(); move(rows.length - 1); break;
      case 'ArrowRight': if (row) {
        event.preventDefault();
        if (row.expandable) {
          const isOpen = row.kind === 'suite' ? open.has(row.id) : expandedTests.has(row.id);
          if (!isOpen) toggle(row); else move(index + 1);
        }
      } break;
      case 'ArrowLeft': if (row) {
        event.preventDefault();
        const isOpen = row.expandable && (row.kind === 'suite' ? open.has(row.id) : expandedTests.has(row.id));
        if (isOpen) toggle(row);
        else { const parent = rows.slice(0, index).reverse().find(r => r.level === row.level - 1 && r.kind === 'suite'); if (parent) move(rows.indexOf(parent)); }
      } break;
      case 'Enter': case ' ': if (row) { event.preventDefault(); toggle(row); } break;
      case 'r': case 'R': if (row?.kind === 'test') { event.preventDefault(); actions?.rerun?.(row.id); } break;
      case 'c': case 'C': if (row?.kind === 'test' && row.test?.status === 'failed') { event.preventDefault(); actions?.copy?.(row.id); } break;
    }
  };

  return { collapsed, setCollapsed, open, rows, focusId, setFocusId, toggle, toggleSuite, toggleTest, expandedTests, onKeyDown };
}
