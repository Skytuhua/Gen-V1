import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const canvas=read('apps/web/src/workspace-canvas.css'),split=read('apps/web/src/workspace-split.css'),shell=read('apps/web/src/shell.css'),dock=read('packages/ui-shell/summary-dock.css');

describe('workspace chrome motion contract',()=>{
 it('keeps expanded canvas panel bodies scrollable and only clips them while collapsed',()=>{
  expect(canvas).toMatch(/\.canvas-panel-body\{[^}]*overflow:auto/);
  expect(canvas).toMatch(/\.canvas-panel-collapse>\.canvas-panel-body\{min-height:0\}/);
  expect(canvas).toMatch(/\.canvas-panel-collapse\[data-collapsed=true\]>\.canvas-panel-body\{overflow:hidden\}/);
 });
 it('kills geometry transitions while the pointer owns the surface',()=>{
  expect(canvas).toMatch(/\.workspace-canvas-interaction \.canvas-panel\s*\{\s*transition:none/);
  expect(split).toMatch(/\.resizing-panel \.split-surface\s*\{\s*transition:none/);
  expect(shell).toMatch(/\.resizing-panel \.workspace-tools>\*\s*\{\s*transition:none/);
 });
 it('declares the spec enter/exit durations through the motion tokens',()=>{
  expect(canvas).toMatch(/animation:canvas-panel-in var\(--ui-motion-panel-enter\)/);
  expect(canvas).toMatch(/animation:canvas-panel-out var\(--ui-motion-panel-exit\)/);
  expect(canvas).toMatch(/grid-template-rows var\(--ui-motion-popup-enter\)/);
  expect(canvas).toMatch(/grid-template-rows:0fr;opacity:0;transition-duration:var\(--ui-motion-popup-exit\)/);
  expect(split).toMatch(/data-arrival\]\{animation:ui-item-in var\(--ui-motion-panel-enter\)/);
  expect(split).toMatch(/data-leaving\]\{[^}]*animation:ui-item-out var\(--ui-motion-panel-exit\)/);
  expect(shell).toMatch(/desktop-browser-dock\[data-state="closed"\][^}]*animation:ui-item-out var\(--ui-motion-panel-exit\)/);
  expect(dock).toMatch(/grid-template-rows var\(--ui-motion-panel-enter\)/);
  expect(dock).toMatch(/grid-template-rows:auto 0fr[^}]*var\(--ui-motion-panel-exit\)/);
 });
 it('neutralizes every new motion rule under prefers-reduced-motion',()=>{
  const rm=(css:string)=>css.slice(css.indexOf('@media(prefers-reduced-motion:reduce)'));
  expect(rm(canvas)).toMatch(/\.canvas-panel\{[^}]*transition:none/);
  expect(rm(canvas)).toMatch(/\.canvas-panel-collapse\{transition:none\}/);
  expect(rm(split)).toMatch(/\.split-surface\{transition:none\}/);
  expect(rm(split)).toMatch(/data-arrival\][^{]*\{animation-name:ui-popover-fade/);
  expect(rm(shell)).toMatch(/workspace-tools>\*\s*\{\s*transition-property:opacity/);
 });
});
