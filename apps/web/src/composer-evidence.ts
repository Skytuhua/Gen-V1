import type {DataRecord} from '../../../packages/contracts';
/** Count only actual unified hunk lines from the latest recorded Git diff. */
export function recordedChangeSummary(data:DataRecord[],threadId?:string):{added:number;removed:number}|undefined{
 const latest=data.filter(item=>item.threadId===threadId&&/; git diff;/.test(item.provenance)).toSorted((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.revision-a.revision)[0];
 const value=latest?.value as {stdout?:unknown}|undefined;if(typeof value?.stdout!=='string'||value.stdout.length>1048576)return undefined;
 let added=0,removed=0,inHunk=false;for(const line of value.stdout.split('\n')){if(line.startsWith('diff --git ')){inHunk=false;continue;}if(line.startsWith('@@')){inHunk=true;continue;}if(!inHunk)continue;if(line.startsWith('+'))added++;else if(line.startsWith('-'))removed++;}
 return {added,removed};
}
