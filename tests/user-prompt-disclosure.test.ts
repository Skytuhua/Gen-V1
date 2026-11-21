import {describe,it,expect} from 'vitest';
import {promptCapPx,promptOverflows} from '../apps/web/src/UserPromptDisclosure';
import {isPromptClipBoundary,promptClipBoundary,rangeClippedBy,registerPromptClip} from '../apps/web/src/prompt-clips';

const CAP=184.8; // 14px * 1.65 line-height * 8 lines

describe('user prompt disclosure threshold',()=>{
 it('caps the preview at eight rendered line heights',()=>{
  expect(promptCapPx(23.1)).toBeCloseTo(184.8);
  expect(promptCapPx(18)).toBe(144);
  expect(promptCapPx(31.2)).toBe(249.6);
 });
 it('keeps prompts at or under the cap uncollapsed, including subpixel tolerance',()=>{
  expect(promptOverflows(100,CAP)).toBe(false);
  expect(promptOverflows(CAP-0.4,CAP)).toBe(false);
  expect(promptOverflows(CAP,CAP)).toBe(false);
  expect(promptOverflows(CAP+0.9,CAP)).toBe(false);
  expect(promptOverflows(CAP+1,CAP)).toBe(false);
 });
 it('collapses prompts taller than cap + 1px',()=>{
  expect(promptOverflows(CAP+1.01,CAP)).toBe(true);
  expect(promptOverflows(CAP+2,CAP)).toBe(true);
  expect(promptOverflows(400,CAP)).toBe(true);
 });
});

describe('prompt clip registry',()=>{
 const boundary={parentElement:null} as unknown as Element;
 it('registers and unregisters a clip boundary',()=>{
  const release=registerPromptClip(boundary,{clip:()=>null,collapsed:()=>true,reveal:()=>{}});
  expect(isPromptClipBoundary(boundary)).toBe(true);
  release();
  expect(isPromptClipBoundary(boundary)).toBe(false);
 });
 it('finds the containing registered boundary for a node and ignores unregistered ancestors',()=>{
  const inner={parentElement:boundary} as unknown as Element;
  const text={parentElement:inner} as unknown as Text;
  const release=registerPromptClip(boundary,{clip:()=>null,collapsed:()=>true,reveal:()=>{}});
  expect(promptClipBoundary(text)).toBe(boundary);
  expect(promptClipBoundary(inner)).toBe(boundary);
  release();
  expect(promptClipBoundary(text)).toBeNull();
  expect(promptClipBoundary({parentElement:{parentElement:null} as unknown as Element} as unknown as Node)).toBeNull();
 });
});

describe('range clipped by cap minus fade',()=>{
 const clip={getBoundingClientRect:()=>({top:0,bottom:CAP,left:0,right:200,width:200,height:CAP,x:0,y:0,toJSON:()=>({})})} as unknown as Element;
 const range=(rects:{top:number;bottom:number;width:number;height:number}[])=>({getClientRects:()=>rects.map(r=>({...r,left:0,right:100,x:0,y:r.top,toJSON:()=>({})}))}) as unknown as Range;
 it('treats rects fully inside the usable area as visible',()=>{
  expect(rangeClippedBy(clip,range([{top:20,bottom:40,width:80,height:20}]))).toBe(false);
  expect(rangeClippedBy(clip,range([{top:140,bottom:160.7,width:80,height:20}]))).toBe(false);
 });
 it('treats a rect crossing or below the usable edge as clipped',()=>{
  expect(rangeClippedBy(clip,range([{top:150,bottom:165,width:80,height:15}]))).toBe(true);
  expect(rangeClippedBy(clip,range([{top:200,bottom:220,width:80,height:20}]))).toBe(true);
 });
 it('ignores empty rects but reveals an unmeasurable range inside a collapsed clip',()=>{
  expect(rangeClippedBy(clip,range([{top:0,bottom:0,width:0,height:0},{top:20,bottom:40,width:80,height:20}]))).toBe(false);
  expect(rangeClippedBy(clip,range([]))).toBe(true);
  expect(rangeClippedBy(clip,range([{top:0,bottom:0,width:0,height:0}]))).toBe(true);
 });
});
