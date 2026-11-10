// One registry per renderer, shared by browser navigation and native window handoffs.
const guards=new Map<symbol,()=>Promise<void>>();

export function registerEditorHandoff(key:string,guard:()=>Promise<void>){
 const registration=Symbol(key);
 guards.set(registration,guard);
 return()=>{guards.delete(registration);};
}

export async function prepareEditorHandoff(){
 const results=await Promise.allSettled(Array.from(guards.values(),guard=>Promise.resolve().then(guard)));
 const failure=results.find(result=>result.status==='rejected');
 if(failure?.status==='rejected')throw failure.reason;
}
