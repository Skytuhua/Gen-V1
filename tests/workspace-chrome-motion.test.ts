import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const canvas=read('apps/web/src/workspace-canvas.css'),split=read('apps/web/src/workspace-split.css'),shell=read('apps/web/src/shell.css'),dock=read('packages/ui-shell/summary-dock.css');
const canvasTsx=read('apps/web/src/WorkspaceCanvas.tsx'),appTsx=read('apps/web/src/App.tsx'),hostTsx=read('apps/web/src/WorkspaceHost.tsx'),artifactTsx=read('apps/web/src/Artifact.tsx');

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
 it('scopes geometry transitions to their intended lifecycle, not every layout change',()=>{
  // Split panes only tween while an add/remove is in flight.
  expect(split).toMatch(/\.split-surface-plane:has\(>\.split-surface\[data-arrival\],>\.split-surface\[data-leaving\]\) \.split-surface\{transition:left/);
  expect(split).not.toMatch(/\.split-surface\{position:absolute[^}]*transition:[^}]*\}/);
  // Canvas panels tween height only during collapse/expand, as a measured
  // WAAPI FLIP on the collapse-flag flip — never a blanket CSS transition.
  expect(canvas).not.toMatch(/\.canvas-panel\{[^}]*transition:height/);
  expect(canvas).not.toMatch(/transition:height/);
  expect(canvasTsx).toMatch(/animateTask\(element,\[\{height:previousHeight\+'px'\},\{height:next\+'px'\}\],180,\{duration:'--ui-motion-popup-enter',easing:'--ui-ease-move'\}\)/);
 });
 it('assembles canvas panels with a capped stagger when a canvas or preset applies (M19)',()=>{
  expect(canvas).toMatch(/animation:canvas-panel-in var\(--ui-motion-panel-enter\) var\(--ui-ease-enter\) backwards/);
  expect(canvasTsx).toMatch(/canvas\.id\+':'\+canvas\.preset\+':'\+panel\.id/);
  expect(canvasTsx).toMatch(/animationDelay:assembling&&readMotionPolicy\(\)==='full'\?Math\.min\(panelIndex\*30,150\)/);
 });
 it('fades the navigation scrim in and out through the motion helper at both render sites (M20)',()=>{
  for(const source of [appTsx,hostTsx]){
   expect(source).toMatch(/animateTask\([^\n]*\[\{ opacity: 0 \}, \{ opacity: 1 \}\], 180\)/);
   expect(source).toMatch(/animateTask\([^\n]*\[\{ opacity: 1 \}, \{ opacity: 0 \}\], 140\)/);
   expect(source).toMatch(/scrimHeld/);
  }
 });
 it('tweens artifact height and eases content on expand/collapse (M10)',()=>{
  expect(artifactTsx).toMatch(/animateTask\(element, \[\{ height: previousRect\.height \+ 'px' \}, \{ height: next\.height \+ 'px' \}\], inWorkspace \|\| expanded \? 220 : 180\)/);
  expect(artifactTsx).toMatch(/animateTask\(content, \[\{ opacity: \.25 \}, \{ opacity: 1 \}\], 140\)/);
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
