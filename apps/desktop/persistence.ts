import {desktopSurfaceKey,type DesktopSurface} from '../../packages/desktop-contract/index.ts';

/** The Store owns active windows; the local file also keeps closed history. */
export function reconcileSavedWindows<T extends {surface:DesktopSurface;open:boolean}>(local:readonly T[],active:readonly T[]):T[]{
 if(active.length>24)throw Error('The active native layout exceeds its limit.');
 const keys=new Set(active.map(entry=>desktopSurfaceKey(entry.surface))),history:T[]=[];
 for(const entry of [...local].reverse()){
  const key=desktopSurfaceKey(entry.surface);if(keys.has(key))continue;keys.add(key);
  // A local-only entry is recovery history, never permission to reopen a child.
  history.push({...entry,open:false});
 }
 return [...history.slice(0,24-active.length).reverse(),...active];
}

/** One ordered writer for native layout state, including final shutdown saves. */
export function createPersistenceQueue(){
 let pending:Promise<unknown>=Promise.resolve();
 return {enqueue<T>(action:()=>Promise<T>):Promise<T>{const next=pending.catch(()=>{}).then(action);pending=next;return next;},async flush(){await pending;}};
}
