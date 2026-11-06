import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { applyOverlayPolicy, lintUiProgram, scanUi, type UiViolation } from '../scripts/ui-guard';

const root = mkdtempSync(join(tmpdir(), 'gen-ui-guard-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
function source(file: string, text: string) {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}
source('types.ts', 'export type Count = number;');
source('jsx.d.ts', 'declare namespace JSX { interface Element { readonly jsx: unique symbol } interface IntrinsicElements { [tag: string]: any } }');
source('packages/ui-shell/Popover.tsx', 'export declare function Popover(props: any): JSX.Element;');
function lintFixture(name: string) {
  const file = source(`${name}.tsx`, readFileSync(new URL(`./fixtures/ui-guard/${name}.tsx.txt`, import.meta.url), 'utf8'));
  const program = ts.createProgram([file, join(root, 'jsx.d.ts')], { strict: true, jsx: ts.JsxEmit.Preserve, types: [], skipLibCheck: true });
  return lintUiProgram(program, [file], root);
}
const numeric = (violations: UiViolation[]) => violations.filter(item => item.rule === 'numeric-jsx-child');
function lintText(name: string, text: string) {
  const file = source(name, text);
  const program = ts.createProgram([file, join(root, 'jsx.d.ts')], { strict: true, jsx: ts.JsxEmit.Preserve, types: [], skipLibCheck: true });
  return lintUiProgram(program, [file], root);
}

describe('type-aware rendered numeric guards', () => {
  it('rejects aliases, optional numbers, mapped/array children, nested conditionals and component returns', () => {
    const violations = numeric(lintFixture('numeric-negative'));
    expect(violations.map(item => item.line)).toEqual([9, 11, 12, 13, 14, 14, 15, 17, 18, 19, 21, 22]);
    expect(violations.every(item => item.message.includes('0'))).toBe(true);
  });
  it('allows explicit boolean gates and ignores non-rendered event/attribute/call/test expressions', () => {
    expect(numeric(lintFixture('numeric-positive'))).toEqual([]);
  });
  it('follows returned render aliases and named array render callbacks, and checks children props', () => {
    const violations = lintText('render-aliases.tsx', `declare const count: number;
const render = () => { const child = count && <b/>; return child; };
const row = () => count && 'label';
export const View = () => <>{[1].map(row)}<div children={count && 'text'}/></>;
export { render };`);
    expect(numeric(violations).map(item => item.line)).toEqual([2, 3, 4]);
  });
  it('checks number constraints, length aliases, enums and bigint zero without rejecting known nonzero literals', () => {
    expect(numeric(lintText('numeric-types.tsx', `declare const rows: string[];
const length = rows.length;
enum State { Empty, Ready }
declare const state: State;
declare const optional: bigint | undefined;
export const View = <>{length && <b/>}{state && <b/>}{optional && <b/>}{1n && <b/>}</>;
export function Generic<N extends number>(value: N) { return <>{value && <b/>}</>; }`)).map(item => item.line)).toEqual([6, 6, 6, 7]);
  });
  it('checks React factory/portal children through import aliases without treating arbitrary call arguments as children', () => {
    expect(numeric(lintText('factory.ts', `import { createElement as h } from 'react';
import { createPortal as mount } from 'react-dom';
declare const count: number;
h('div', null, count && 'child');
mount(count && 'child', document.body);`)).map(item => item.line)).toEqual([4, 5]);
  });
  it('does not let an outer fallback hide zero leaks inside truthy arrays or mapped children', () => {
    expect(numeric(lintText('array-fallback.tsx', `declare const count: number;
export const View = <>{([count && <b/>]) || null}{([1].map(() => count && 'text')) || null}</>;`))).toHaveLength(2);
  });
});

describe('overlay architecture policy', () => {
  it('rejects intrinsic overlays, roles, class templates, imported portal aliases and imperative DOM overlays', () => {
    const violations = lintFixture('overlays-negative').filter(item => item.rule === 'ad-hoc-overlay');
    expect(violations.map(item => item.line)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19]);
  });
  it('allows shared consumers, ordinary disclosures, documentation text and unrelated local functions', () => {
    expect(lintFixture('overlays-positive')).toEqual([]);
  });
  it('allows only named primitive internals, never the whole ui-shell directory', () => {
    const files = [source('packages/ui-shell/Popover.tsx', 'export const Primitive = <div role="dialog"/>;'),
      source('packages/ui-shell/Accidental.tsx', 'export const NewOverlay = <dialog/>;')];
    const program = ts.createProgram(files, { jsx: ts.JsxEmit.Preserve, types: [] });
    expect(lintUiProgram(program, files, root).map(item => item.file)).toEqual(['packages/ui-shell/Accidental.tsx']);
  });
  it('still rejects numeric leaks inside approved primitive implementations', () => {
    expect(numeric(lintText('packages/ui-shell/Select.tsx', 'declare const count: number; export const Select = <>{count && <b/>}</>;'))).toHaveLength(1);
  });
  it('matches legacy occurrences individually; a second identical violation in the same file fails', () => {
    const [violation] = lintFixture('overlays-negative');
    const entry = { ...violation!, reason: 'Legacy select; migrate with shared controls.' };
    const result = applyOverlayPolicy([violation!, violation!], [entry]);
    expect(result.legacy).toHaveLength(1);
    expect(result.violations).toEqual([violation]);
  });
  it('does not approve changed syntax or numeric bugs through the legacy overlay inventory', () => {
    const [violation] = lintFixture('overlays-negative');
    const entry = { ...violation!, reason: 'Legacy menu; staged migration.' };
    expect(applyOverlayPolicy([{ ...violation!, fingerprint: 'changed' }], [entry]).violations).toHaveLength(1);
    const number = { ...violation!, rule: 'numeric-jsx-child' as const };
    expect(applyOverlayPolicy([number], [{ ...number, reason: 'Invalid exception' }]).violations).toEqual([number]);
  });
  it('rejects React factory aliases, attribute spreads, fixed overlay geometry and DOM markup sinks', () => {
    expect(lintText('imperative.tsx', `import { createElement as h } from 'react';
const attributes = { role: 'dialog', 'aria-modal': true } as const;
export const View = <><div {...attributes}/><div style={{position:'fixed',zIndex:10}}/></>;
h('select', null);
h('div', { role: 'menu' });
document.body.innerHTML = '<div role="dialog">Unsafe modal</div>';
document.body.insertAdjacentHTML('beforeend', '<dialog>Unsafe modal</dialog>');
document.body.style.cssText = 'position: fixed; z-index: 100;';`).map(item => item.line)).toEqual([3, 3, 4, 5, 6, 7, 8]);
  });
});

it('scans every public frontend and trusted receiver root, including new untracked source files', () => {
  source('tsconfig.json', JSON.stringify({ compilerOptions: { jsx: 'preserve', strict: true, types: [] } }));
  const paths = ['apps/web/src/New.tsx', 'packages/ui-catalog/new.tsx', 'packages/ui-shell/New.tsx',
    'packages/widgets/receiver.ts', 'packages/plugins/frontend.ts', 'plugins/personal-visuals/src/New.tsx',
    'apps/web/index.html', 'apps/web/src/new.css'];
  for (const path of paths) source(path, path.endsWith('.css') ? '.new-surface { position: fixed; z-index: 100; }'
    : path.endsWith('.html') ? '<!doctype html><html><body><dialog>New modal</dialog></body></html>'
    : path.endsWith('.tsx') ? 'export const Bad = <dialog/>;' : "document.createElement('dialog');");
  const result = scanUi(root);
  expect(result.files).toEqual(expect.arrayContaining(paths));
  expect(result.violations.map(item => item.file)).toEqual(expect.arrayContaining(paths));
});

it('the CLI exits nonzero for seeded numeric and overlay violations in an existing legacy file', () => {
  const project = join(root, 'cli');
  source('cli/tsconfig.json', JSON.stringify({ compilerOptions: { jsx: 'preserve', strict: true, types: [] } }));
  source('cli/apps/web/src/Legacy.tsx', 'export const Legacy = <dialog/>;');
  const legacy = scanUi(project).violations[0]!;
  source('cli/scripts/ui-overlay-legacy.json', JSON.stringify({ version: 1, entries: [{ ...legacy, reason: 'Legacy dialog; staged shared Modal migration.' }] }));
  const command = ['--import', 'tsx', resolve('scripts/lint-ui.ts'), '--root', project];
  expect(spawnSync(process.execPath, command, { encoding: 'utf8' }).status).toBe(0);
  source('cli/apps/web/src/Legacy.tsx', 'export const Legacy = <dialog/>; declare const count: number; export const Seeded = <>{count && <b/>}<dialog/></>;');
  const result = spawnSync(process.execPath, command, { encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('apps/web/src/Legacy.tsx:1:');
  expect(result.stdout).toContain('[numeric-jsx-child]');
  expect(result.stdout).toContain('[ad-hoc-overlay]');
});

it('parses inline HTML receiver scripts as code and reports their original HTML location', () => {
  const project = join(root, 'html-receiver');
  source('html-receiver/tsconfig.json', JSON.stringify({ compilerOptions: { types: [] } }));
  source('html-receiver/apps/web/entry.ts', 'export {};');
  source('html-receiver/apps/web/index.html', '<!doctype html>\n<script>\ndocument.createElement("dialog");\n</script>');
  expect(scanUi(project).violations.map(item => [item.file, item.line])).toEqual([['apps/web/index.html', 3]]);
});
