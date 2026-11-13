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
  it('follows declared map callbacks and array-returning components', () => {
    expect(numeric(lintText('declared-render.tsx', `declare const count: number;
function row() { return count && 'text'; }
const children = [count && <span/>];
export const View = () => children;
export const Mapped = <div>{[1].map(row)}</div>;`)).map(item=>item.line)).toEqual([2,3]);
  });
  it('keeps hoisted discarded callbacks equivalent to inline handlers, while checking dual render use', () => {
    expect(numeric(lintText('discarded-callback.tsx', `declare const count: number;
const onClick = () => count && <span/>;
function declaredHandler() { return count && <span/>; }
export const View = <><button onClick={onClick}/><button onClick={declaredHandler}/><button onClick={()=>count && <span/>}/></>;`))).toEqual([]);
    expect(numeric(lintText('dual-use-callback.tsx', `declare const count: number;
const row = () => count && <span/>;
export const View = <><button onClick={row}/>{[1].map(row)}</>;`))).toHaveLength(1);
  });
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
  it('checks numeric children supplied through JSX spreads and shorthand factory props', () => {
    expect(numeric(lintText('spread-children.tsx', `declare const count: number;
const children = count && 'spread child';
const props = { children };
export const View = <div {...props}/>;`)).map(item => item.line)).toEqual([2]);
    expect(numeric(lintText('shorthand-children.ts', `import { createElement } from 'react';
declare const count: number;
const children = count && 'factory child';
createElement('div', { children });`)).map(item => item.line)).toEqual([3]);
  });
  it('uses the effective children value when spreads or factory arguments override children props', () => {
    expect(numeric(lintText('overridden-children.tsx', `import { createElement } from 'react';
declare const count: number;
const props = { children: count && 'discarded' };
export const View = <><div {...props}>Visible child</div><div {...props} children="Visible child"/><div {...props} {...{children:'Visible child'}}/><div children={count && 'discarded'}>Visible child</div><div children={count && 'discarded'} {...{children:'Visible child'}}/></>;
createElement('div', props, 'Visible child');`))).toEqual([]);
  });
  it('treats inline JSX whitespace as an explicit override of children props', () => {
    expect(numeric(lintText('inline-whitespace-children.tsx', `declare const count: number;
const props = { children: count && 'discarded' };
export const View = <><div {...props}> </div><div children={count && 'discarded'}> </div><div {...props}>\t</div><div {...props}>&#32;</div><div {...props}>\u00a0</div><div {...props}> {/* Inline comment */} </div></>;`))).toEqual([]);
  });
  it('keeps children props effective when JSX only contains multiline indentation', () => {
    expect(numeric(lintText('indented-children.tsx', `declare const count: number;
const props = { children: count && 'visible zero' };
export const View = <><div {...props}>
  \t
</div><div {...props}>
  {/* This comment is not an explicit child. */}
</div></>;`)).map(item => item.line)).toEqual([2]);
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
  it('allows inline list semantics owned by shared surfaces and triggers controlling their exact IDs', () => {
    source('packages/ui-shell/Modal.tsx', 'export declare function Modal(props: any): JSX.Element;');
    expect(lintText('shared-list-ownership.tsx', `import {Popover} from './packages/ui-shell/Popover';
import {Modal} from './packages/ui-shell/Modal';
export function Model() { const id='model'; const open=true; return <><button role="combobox" aria-controls={open?id+'-list':undefined}/><Popover id={id+'-surface'}><div id={id+'-list'} role="listbox"/></Popover></>; }
export const Project = <Modal><input role="combobox"/><div role="listbox"/></Modal>;`)).toEqual([]);
  });
  it('does not approve unrelated controls or native/positioned overlays merely beside a shared consumer', () => {
    const result=lintText('unowned-list.tsx', `import {Popover} from './packages/ui-shell/Popover';
export const View = <><button role="combobox" aria-controls="unowned"/><div id="unowned" role="listbox"/><Popover id="owned"><dialog/><div role="menu" style={{position:'fixed',zIndex:4}}/></Popover></>;`);
    expect(result.filter(item=>item.rule==='ad-hoc-overlay')).toHaveLength(4);
  });
  it.each(['literal','template'])('preserves %s contents when checking exact shared popup IDs',kind=>{
    const control=kind==='literal'?'"owned id"':'{`owned ${suffix}`}';
    const target=kind==='literal'?'"ownedid"':'{`owned${suffix}`}';
    expect(lintText(`id-${kind}.tsx`, `import {Popover} from './packages/ui-shell/Popover';
export function View(){const suffix='id';return <><button role="combobox" aria-controls=${control}/><Popover id=${target}/></>;}`).filter(item=>item.rule==='ad-hoc-overlay')).toHaveLength(1);
  });
  it('checks helper HTML at srcdoc and explicit HTML response sinks without flagging unused documentation', () => {
    expect(lintText('rendered-document.ts', `declare const frame: HTMLIFrameElement;
declare const reply: any;
function widgetDocument() { return '<dialog>New modal</dialog>'; }
frame.srcdoc = widgetDocument();
reply.type('text/html; charset=utf-8').send(widgetDocument());
const documentation = '<dialog>Unused documentation</dialog>';`).map(item=>item.line)).toEqual([4,5]);
    expect(lintText('iframe-document.tsx', `declare const frame: HTMLIFrameElement;
const html = '<dialog>New modal</dialog>';
frame.setAttribute('srcdoc', html);
export const View = <><iframe srcDoc={html}/><div dangerouslySetInnerHTML={{__html: html}}/></>;`).map(item=>item.line)).toEqual([3,4,4]);
  });
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

it('follows an imported trusted document helper at a discovered server HTML response sink', () => {
  source('tsconfig.json', JSON.stringify({ compilerOptions: { jsx: 'preserve', strict: true, types: [] } }));
  source('packages/widgets/rendered-document.ts', "export function widgetShellDocument() { return '<dialog>New modal</dialog>'; }");
  source('apps/server/rendered-page.ts', `import {widgetShellDocument} from '../../packages/widgets/rendered-document';
declare const reply: any;
reply.type('text/html; charset=utf-8').send(widgetShellDocument());`);
  expect(scanUi(root).violations.some(item=>item.file==='apps/server/rendered-page.ts' && item.rule==='ad-hoc-overlay')).toBe(true);
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

it('flags motion literals equal to token values, including seconds, leading zeros and later durations', () => {
  const project = join(root, 'motion-tokens');
  source('motion-tokens/tsconfig.json', JSON.stringify({ compilerOptions: { types: [] } }));
  source('motion-tokens/apps/web/entry.ts', 'export {};');
  source('motion-tokens/apps/web/src/motion.css', `.seconds { transition: opacity .12s ease-out; }
.later { transition: opacity 420ms ease, color 120ms ease; }
.ms { animation: pulse 600ms linear; }
.curve { transition: transform 300ms cubic-bezier(0.16, 1, 0.3, 1); }
.other-duration { transition: opacity 500ms ease; }
.other-curve { transition: transform 300ms cubic-bezier(.25, .1, .25, 1); }
.token { transition: opacity var(--ui-motion-hover) var(--ui-ease-enter); }
.stagger { transition-delay: calc(var(--ui-motion-stagger) * 3); }
.decorative { animation: spin 800ms linear infinite; }`);
  const violations = scanUi(project).violations.filter(item => item.rule === 'off-token-motion');
  expect(violations.map(item => item.line)).toEqual([1, 2, 3, 4]);
});
