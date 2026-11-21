import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {build} from 'esbuild';
import {chromium,expect as pwExpect,type Browser} from '@playwright/test';
import {mapSelectedText} from '../apps/web/src/SourceSelectionActions';
describe('M15 exact rendered selection mapping',()=>{
 it('uses UTF16 offsets across non-BMP text',()=>expect(mapSelectedText('A😀 selected text.','selected')).toEqual({start:4,end:12,text:'selected'}));
 it('refuses ambiguous repeated text rather than citing the wrong range',()=>expect(mapSelectedText('same then same','same')).toBeNull());
 it('refuses forged or empty selection content',()=>{expect(mapSelectedText('canonical','forged')).toBeNull();expect(mapSelectedText('canonical','')).toBeNull();});
 it('retains exact whitespace and newlines',()=>expect(mapSelectedText('prefix\n  selected\nend','\n  selected\n')).toEqual({start:6,end:18,text:'\n  selected\n'}));
});

const fixture=`import React from 'react';import {createRoot} from 'react-dom/client';import {SourceSelectionActions} from './apps/web/src/SourceSelectionActions.tsx';window.actions=[];createRoot(document.getElementById('root')).render(<SourceSelectionActions text="Visible selected text from an assistant." enabled onAction={(kind,selection)=>{window.actions.push(kind+':'+selection.text)}}><p id="source-text">Visible selected text from an assistant.</p></SourceSelectionActions>);`;

describe('source selection keyboard affordances',()=>{
 let browser:Browser,script:string;
 beforeAll(async()=>{
  script=(await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},loader:{'.css':'empty'}})).outputFiles[0]!.text;
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 });
 afterAll(async()=>{await browser?.close();});
 it('exposes the keyboard contract, hint, active-range marker and live announcements',async()=>{
  const page=await browser.newPage();
  try {
   await page.setContent('<body><div id="root"></div></body>');
   await page.addScriptTag({content:script});
   const source=page.locator('.source-selection-text'),hint=page.locator('.source-selection-hint'),region=page.locator('.source-selection > [role="status"]');
   await pwExpect(source).toHaveAttribute('aria-keyshortcuts','shift+ArrowRight control+a shift+f10');
   const describedBy=await source.getAttribute('aria-describedby');
   expect(describedBy).toBeTruthy();
   await pwExpect(page.locator(`[id="${describedBy}"]`)).toHaveText('Selectable source. Use Shift plus arrow keys to select text, Control A to select all, Shift F10 for actions.');
   await pwExpect(hint).toHaveAttribute('aria-hidden','true');
   await pwExpect(hint).toHaveText('Shift+arrows select · Ctrl+A all · Shift+F10 actions');
   await pwExpect(region).toHaveAttribute('aria-live','polite');
   await source.focus();
   await page.evaluate(()=>{const element=document.querySelector('.source-selection-text')!,node=element.firstChild!.firstChild!,range=document.createRange();range.setStart(node,0);range.setEnd(node,7);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
   await pwExpect(hint).toHaveCount(0);
   await pwExpect(source).toHaveAttribute('data-selection','active');
   await pwExpect(region).toHaveText('Selected “Visible”. Press Shift F10 or Tab for actions.');
   await page.keyboard.press('Escape');
   await pwExpect(source).not.toHaveAttribute('data-selection','active');
   await pwExpect(region).toHaveText('Selection cleared.');
  } finally {await page.close();}
 });
});
