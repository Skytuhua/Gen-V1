import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {contrast,evaluateColor} from '../scripts/theme-contrast.ts';

const css=readFileSync(new URL('../apps/web/src/files/files.css',import.meta.url),'utf8');
const block=(selector:string)=>{
 const marker=selector+' {',start=css.indexOf('\n'+marker);
 expect(start,`${selector} declares the §8.3 syntax variables`).toBeGreaterThan(-1);
 return css.slice(start+marker.length,css.indexOf('}',start));
};
const vars=(selector:string)=>{
 const tokens:Record<string,string>={};
 for(const match of block(selector).matchAll(/(--gen-syn-[\w-]+)\s*:\s*([^;]+)/g)) tokens[match[1]]=match[2].trim();
 return tokens;
};
const DARK=vars('.gen-code-editor');
// Light overrides a subset of the base declarations; unresolved vars inherit.
const LIGHT={...DARK,...vars('[data-theme="light"] .gen-code-editor')};
const GROUPS=['keyword','string','number','comment','function','type','property','variable','tag','link','invalid'];

describe('manual edit editor theme (§8.3)',()=>{
 it('declares every syntax variable for dark and light',()=>{
  for(const name of GROUPS){
   expect(DARK[`--gen-syn-${name}`],`--gen-syn-${name} (dark)`).toBeTruthy();
   expect(LIGHT[`--gen-syn-${name}`],`--gen-syn-${name} (light)`).toBeTruthy();
  }
 });
 it('keeps ≥ 4.5:1 on the dark editor surface #0F0F0F',()=>{
  for(const name of GROUPS){
   const value=evaluateColor(DARK[`--gen-syn-${name}`]!,{ '--danger':'#ff6b7e' });
   expect(value,`--gen-syn-${name}`).toBeTruthy();
   const ratio=contrast(value!,'#0f0f0f');
   expect(ratio,`--gen-syn-${name} ${value} on #0f0f0f = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  }
 });
 it('keeps ≥ 4.5:1 on the light editor surface #FFFFFF',()=>{
  for(const name of GROUPS){
   const value=evaluateColor(LIGHT[`--gen-syn-${name}`]!,{ '--danger':'#c92a3e' });
   expect(value,`--gen-syn-${name}`).toBeTruthy();
   const ratio=contrast(value!,'#ffffff');
   expect(ratio,`--gen-syn-${name} ${value} on #ffffff = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  }
 });
 it('pairs a reduced-motion path with every new motion declaration',()=>{
  // coverage is enforced globally by tests/reduced-motion-coverage.test.ts;
  // assert the §8.5 selectors exist so a future rename cannot silently drop them.
  expect(css).toContain('[data-motion="reduced"] .files-edit-bar');
  expect(css).toContain('[data-panel-animations="false"] .files-compare');
  expect(css).toContain('prefers-reduced-motion: reduce');
 });
});
