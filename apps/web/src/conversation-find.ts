export interface TextOffset {start:number;end:number}
export function findTextOffsets(text:string,query:string):TextOffset[]{
 if(!query)return [];
 const literal=query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 return Array.from(text.matchAll(new RegExp(literal,'giu')),match=>({start:match.index,end:match.index+match[0].length}));
}
export function nextFindIndex(index:number,direction:number,count:number){return count?(index+direction+count)%count:-1;}
export function retainFindIndex(keys:string[],key:string|null){return keys.length?Math.max(0,key===null?-1:keys.indexOf(key)):-1;}
const blockKeys=new WeakMap<Element,string>();
let blockSequence=0;
export interface ConversationMatch {key:string;range:Range}
/** Search only rendered transcript bodies; Range/CSS Highlights leave copied code intact. */
export function conversationRanges(root:HTMLElement,query:string):ConversationMatch[]{
 const result:ConversationMatch[]=[];
 if(!query)return result;
 const blocks=root.querySelectorAll<HTMLElement>('[data-conversation-text], .message-content, .scoped-conversation-text');
 blocks.forEach(block=>{
  const nodes:Text[]=[];let text='';
  const walker=root.ownerDocument.createTreeWalker(block,NodeFilter.SHOW_TEXT,{acceptNode(node){
   const parent=node.parentElement;
   if(!parent||parent.closest('button, input, textarea, select, [hidden], [aria-hidden="true"], [inert], script, style')||!parent.getClientRects().length||getComputedStyle(parent).visibility==='hidden')return NodeFilter.FILTER_REJECT;
   return NodeFilter.FILTER_ACCEPT;
  }});
  while(walker.nextNode()){nodes.push(walker.currentNode as Text);text+=walker.currentNode.textContent;}
  for(const offset of findTextOffsets(text,query)){
   const range=root.ownerDocument.createRange();let cursor=0;
   for(const node of nodes){const end=cursor+node.length;if(offset.start>=cursor&&offset.start<end)range.setStart(node,offset.start-cursor);if(offset.end>cursor&&offset.end<=end){range.setEnd(node,offset.end-cursor);break;}cursor=end;}
   if(!blockKeys.has(block))blockKeys.set(block,String(++blockSequence));
   const id=block.closest<HTMLElement>('[data-message-id]')?.dataset.messageId??blockKeys.get(block)!;
   result.push({key:`${id}:${offset.start}`,range});
  }
 });
 return result;
}
const owners=new WeakMap<Document,Map<string,{all:Range[];current:Range[]}>>();
export function highlightConversation(document:Document,id:string,matches:ConversationMatch[],current:number){
 let records=owners.get(document);if(!records){records=new Map();owners.set(document,records);}
 if(matches.length)records.set(id,{all:matches.map(m=>m.range),current:matches[current]?[matches[current].range]:[]});else records.delete(id);
 const view=document.defaultView;
 if(!view||!('Highlight' in view)||!('highlights' in view.CSS))return;
 const values=[...records.values()];
 view.CSS.highlights.set('conversation-find-all',new view.Highlight(...values.flatMap(v=>v.all)));
 view.CSS.highlights.set('conversation-find-current',new view.Highlight(...values.flatMap(v=>v.current)));
}
