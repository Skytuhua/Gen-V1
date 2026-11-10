import {z} from 'zod';
import {journalCompareAndSwap,journalReadRecord} from './journal';
/** Frozen v1 contract shared with saved drafts. Caps include UTF-8 text, never host cursors. */
export const TERMINAL_EXCERPT_MAX_BYTES=8192,TERMINAL_EXCERPT_MAX_COUNT=4;
const encoder=new TextEncoder(),bounded=(value:string)=>encoder.encode(value).length<=TERMINAL_EXCERPT_MAX_BYTES;
export const terminalExcerptSchema=z.object({version:z.literal(1),id:z.string().uuid(),terminalId:z.string().min(1).max(1024),projectId:z.string().min(1).max(1024),threadId:z.string().min(1).max(1024),capturedAt:z.string().datetime(),originalText:z.string().min(1).refine(bounded),text:z.string().min(1).refine(bounded),truncated:z.boolean(),originalBytes:z.number().int().nonnegative()}).strict().refine(value=>value.originalBytes>=encoder.encode(value.originalText).length&&value.truncated===(value.originalBytes>encoder.encode(value.originalText).length));
export type TerminalExcerpt=z.infer<typeof terminalExcerptSchema>;
export interface TerminalExcerptOwner {projectId:string;threadId:string}
export const excerptDraftKey=(threadId:string)=>'draft-excerpts:'+threadId;
export function captureTerminalExcerpt(input:TerminalExcerptOwner&{terminalId:string;selection:string}):TerminalExcerpt{
 const originalBytes=encoder.encode(input.selection).length;let originalText='',bytes=0;
 for(const scalar of input.selection){const size=encoder.encode(scalar).length;if(bytes+size>TERMINAL_EXCERPT_MAX_BYTES)break;originalText+=scalar;bytes+=size;}
 return terminalExcerptSchema.parse({version:1,id:crypto.randomUUID(),terminalId:input.terminalId,projectId:input.projectId,threadId:input.threadId,capturedAt:new Date().toISOString(),originalText,text:originalText,truncated:bytes<originalBytes,originalBytes});
}
export function editTerminalExcerpt(excerpt:TerminalExcerpt,text:string):TerminalExcerpt{return terminalExcerptSchema.parse({...excerpt,text});}
export function readTerminalExcerpts(value:unknown,owner?:TerminalExcerptOwner):TerminalExcerpt[]{
 const excerpts=value===undefined?[]:z.array(terminalExcerptSchema).max(TERMINAL_EXCERPT_MAX_COUNT).parse(value);
 if(new Set(excerpts.map(e=>e.id)).size!==excerpts.length||owner&&excerpts.some(e=>e.projectId!==owner.projectId||e.threadId!==owner.threadId))throw Error('Terminal excerpts belong to another composer.');
 return excerpts;
}
export function serializeTerminalExcerpts(text:string,excerpts:readonly TerminalExcerpt[]):string{
 const reviewed=readTerminalExcerpts(excerpts);
 const result=[text.trim(),...reviewed.map(e=>`Terminal excerpt · project ${JSON.stringify(e.projectId)} · terminal ${JSON.stringify(e.terminalId)} · captured ${e.capturedAt}${e.truncated?' · truncated':''}\n${e.text}\nEnd terminal excerpt`)].filter(Boolean).join('\n\n');
 if(result.length>64*1024)throw Error('Prompt and excerpts exceed the message limit. Shorten the prompt or remove an excerpt.');
 return result;
}
export async function changeTerminalExcerpts(threadId:string,update:(current:TerminalExcerpt[])=>TerminalExcerpt[]){
 const key=excerptDraftKey(threadId);
 for(let attempt=0;attempt<8;attempt++){const record=await journalReadRecord(key),next=readTerminalExcerpts(update(readTerminalExcerpts(record?.value)));if(await journalCompareAndSwap(key,record?.generation,next))return;}
 throw Error('Excerpts changed in another window. Retry.');
}
export async function clearAcceptedExcerpts(threadId:string,accepted:readonly TerminalExcerpt[]){
 if(!accepted.length)return;
 await changeTerminalExcerpts(threadId,current=>current.filter(e=>!accepted.some(sent=>sent.id===e.id&&JSON.stringify(sent)===JSON.stringify(e))));
}
