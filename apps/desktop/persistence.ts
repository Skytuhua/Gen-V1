/** One ordered writer for native layout state, including final shutdown saves. */
export function createPersistenceQueue(){
 let pending:Promise<unknown>=Promise.resolve();
 return {enqueue<T>(action:()=>Promise<T>):Promise<T>{const next=pending.catch(()=>{}).then(action);pending=next;return next;},async flush(){await pending;}};
}
