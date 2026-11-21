import {describe,it,expect,vi} from 'vitest';
import {canLoadConversationHistory, conversationRanges, findTextOffsets, nextFindIndex, retainFindIndex} from '../apps/web/src/conversation-find';
describe('conversation find',()=>{
 it('finds literal phrases without interpreting regex or losing Unicode offsets',()=>{
  expect(findTextOffsets('😀 WorkSPACE workspace [a]. [a].','workspace')).toEqual([{start:3,end:12},{start:13,end:22}]);
  expect(findTextOffsets('a+b aab a+b','a+b')).toEqual([{start:0,end:3},{start:8,end:11}]);
  expect(findTextOffsets('İ test TEST','test')).toEqual([{start:2,end:6},{start:7,end:11}]);
  expect(findTextOffsets('anything','')).toEqual([]);
 });
 it('wraps in both directions and handles no results',()=>{
  expect(nextFindIndex(2,1,3)).toBe(0);expect(nextFindIndex(0,-1,3)).toBe(2);expect(nextFindIndex(0,1,0)).toBe(-1);
 });
 it('retains the active message offset through prepend and background arrivals',()=>{
  expect(retainFindIndex(['older:0','m:4','later:0'],'m:4')).toBe(1);
  expect(retainFindIndex(['new:0'],'removed:0')).toBe(0);expect(retainFindIndex([],null)).toBe(-1);
 });
});

it('maps non-overlapping matches across inline nodes without rescanning each prefix',()=>{
 const chunks=Array.from({length:100},()=>['x ','pr',' review ']).flat();
 let lengthReads=0;
 const nodes=chunks.map(textContent=>({textContent,get length(){lengthReads++;return textContent.length;}}));
 const ranges:{setStart:ReturnType<typeof vi.fn>;setEnd:ReturnType<typeof vi.fn>}[]=[];
 const walker={currentNode:null as unknown,nextNode(){this.currentNode=nodes.shift()??null;return this.currentNode;}};
 const originals=[...nodes];
 const block={closest:()=>null};
 const root={querySelectorAll:()=>[block],ownerDocument:{
  createTreeWalker:()=>walker,
  createRange:()=>{const range={setStart:vi.fn(),setEnd:vi.fn()};ranges.push(range);return range;},
 }};
 vi.stubGlobal('NodeFilter',{SHOW_TEXT:4});
 try{
  expect(conversationRanges(root as unknown as HTMLElement,'pr review')).toHaveLength(100);
  expect(ranges[0]?.setStart).toHaveBeenCalledExactlyOnceWith(originals[1],0);
  expect(ranges[0]?.setEnd).toHaveBeenCalledExactlyOnceWith(originals[2],7);
  expect(ranges.at(-1)?.setStart).toHaveBeenCalledExactlyOnceWith(originals[298],0);
  expect(ranges.at(-1)?.setEnd).toHaveBeenCalledExactlyOnceWith(originals[299],7);
  expect(lengthReads).toBeLessThanOrEqual(chunks.length*2);
 }finally{vi.unstubAllGlobals();}
});
it('excludes message times and day headers from find matches',()=>{
 const entries:[string,string][]=[['tell me about ','p'],['3:42 PM','time'],['tomorrow','p'],['Today','div']];
 let filter:{acceptNode?:(n:unknown)=>number}|undefined;
 const nodes=entries.map(([textContent,tag])=>({textContent,get length(){return textContent.length;},parentElement:{
  closest:(sel:string)=>(tag==='time'&&sel.includes('[data-message-time]'))||(tag==='div'&&textContent==='Today'&&sel.includes('[data-day]'))?{}:null,
  getClientRects:()=>[{}],
 }}));
 const block={closest:()=>null};
 const root={querySelectorAll:()=>[block],ownerDocument:{
  createTreeWalker:(_b:unknown,_t:unknown,f:typeof filter)=>{filter=f;const pending=[...nodes];return {currentNode:null as unknown,nextNode():unknown{const n=pending.shift();if(!n)return null;if(f?.acceptNode?.(n)===2){return this.nextNode();}this.currentNode=n;return n;}};},
  createRange:()=>({setStart:vi.fn(),setEnd:vi.fn()}),
 }};
 vi.stubGlobal('NodeFilter',{SHOW_TEXT:4,FILTER_ACCEPT:1,FILTER_REJECT:2,FILTER_SKIP:3});
 vi.stubGlobal('getComputedStyle',()=>({visibility:'visible'}));
 try{
  expect(conversationRanges(root as unknown as HTMLElement,'PM')).toHaveLength(0);
  expect(conversationRanges(root as unknown as HTMLElement,'Today')).toHaveLength(0);
  expect(conversationRanges(root as unknown as HTMLElement,'tomorrow')).toHaveLength(1);
 }finally{vi.unstubAllGlobals();}
});
it('offers older history at the end of the local window when the server still has rows',()=>{
 expect(canLoadConversationHistory(25,0,0)).toBe(true);
 expect(canLoadConversationHistory(0,120,100)).toBe(true);
 expect(canLoadConversationHistory(0,120,120)).toBe(false);
 expect(canLoadConversationHistory(0,0,0)).toBe(false);
});
