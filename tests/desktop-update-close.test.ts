import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {expect,it,vi} from 'vitest';
import {createDesktopUpdater,type UpdateCloseProof} from '../apps/desktop/updater.ts';

const semver=createRequire(import.meta.url)('semver') as {valid(value:string):string|null;prerelease(value:string):unknown[]|null;gt(left:string,right:string):boolean};
const clean:UpdateCloseProof={activeWorkAtClose:false,osSessionEnding:false,savedStateFlushed:true,backendStoppedCleanly:true};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return {promise,resolve};}
class Updater extends EventEmitter {
 channel:string|null=null;allowPrerelease=true;allowDowngrade=true;autoDownload=true;autoInstallOnAppQuit=true;installs:{silent?:boolean;restart?:boolean}[]=[];
 async checkForUpdates(){return {isUpdateAvailable:true,updateInfo:{version:'0.7.0'}};}
 async downloadUpdate(){this.emit('update-downloaded',{version:'0.7.0'});return ['verified-installer'];}
 quitAndInstall(silent?:boolean,restart?:boolean){this.installs.push({silent,restart});}
}
async function ready(compatibility:(version:string)=>Promise<{allowed:boolean}>=async()=>({allowed:true})){
 const updater=new Updater(),controller=createDesktopUpdater({updater,installed:true,currentVersion:'0.6.3',isStableNewerVersion:(candidate,current)=>Boolean(semver.valid(candidate)&&!semver.prerelease(candidate)&&semver.gt(candidate,current)),compatibility});
 await controller.check();return {updater,controller};
}

it.each([
 ['active work',{activeWorkAtClose:true}],['OS shutdown',{osSessionEnding:true}],['unflushed state',{savedStateFlushed:false}],['unclean backend exit',{backendStoppedCleanly:false}],
 ['unknown work',{activeWorkAtClose:undefined}],['unknown session state',{osSessionEnding:undefined}],['unknown flush',{savedStateFlushed:undefined}],['unknown backend state',{backendStoppedCleanly:undefined}],
] as const)('defers installation for %s without forcing an update',async(_reason,delta)=>{
 const f=await ready();expect(await f.controller.installAfterClose({...clean,...delta},false)).toBe(false);expect(f.updater.installs).toEqual([]);expect(f.controller.status().state).toBe('deferred');f.controller.dispose();
});
it.each([false,true])('installs once after successful close and requests restart=%s',async restart=>{
 const f=await ready();expect(await f.controller.installAfterClose(clean,restart)).toBe(true);expect(await f.controller.installAfterClose(clean,restart)).toBe(false);
 expect(f.updater.installs).toEqual([{silent:true,restart}]);f.controller.dispose();
});
it('revalidates the current plug-in inventory immediately before installation',async()=>{
 let allowed=true,reads=0;const f=await ready(async()=>{reads++;return {allowed};});expect(reads).toBe(2);allowed=false;
 expect(await f.controller.installAfterClose(clean,false)).toBe(false);expect(reads).toBe(3);expect(f.updater.installs).toEqual([]);f.controller.dispose();
});
it('observes OS shutdown arriving during the final compatibility check',async()=>{
 const gate=deferred<{allowed:boolean}>();let reads=0;const f=await ready(async()=>++reads<3?{allowed:true}:gate.promise);let proof={...clean};
 const installing=f.controller.installAfterClose(()=>proof,true);await vi.waitFor(()=>expect(reads).toBe(3));proof={...clean,osSessionEnding:true};gate.resolve({allowed:true});
 expect(await installing).toBe(false);expect(f.updater.installs).toEqual([]);f.controller.dispose();
});
it('does not install after the candidate is invalidated during the final check',async()=>{
 const gate=deferred<{allowed:boolean}>();let reads=0;const f=await ready(async()=>++reads<3?{allowed:true}:gate.promise);
 const installing=f.controller.installAfterClose(clean,false);await vi.waitFor(()=>expect(reads).toBe(3));f.updater.emit('error',Error('verification failed'));gate.resolve({allowed:true});
 expect(await installing).toBe(false);expect(f.updater.installs).toEqual([]);f.controller.dispose();
});
it('does not install after disposal during final compatibility verification',async()=>{
 const gate=deferred<{allowed:boolean}>();let reads=0;const f=await ready(async()=>++reads<3?{allowed:true}:gate.promise);
 const installing=f.controller.installAfterClose(clean,false);await vi.waitFor(()=>expect(reads).toBe(3));f.controller.dispose();gate.resolve({allowed:true});
 expect(await installing).toBe(false);expect(f.updater.installs).toEqual([]);
});
it('cannot install before a verified candidate exists',async()=>{
 const f=await ready();f.updater.emit('error',Error('verification error'));expect(await f.controller.installAfterClose(clean,false)).toBe(false);expect(f.updater.installs).toEqual([]);f.controller.dispose();
});
it.each(['dispose','shutdown'] as const)('does not install when the installing notification causes %s',async action=>{
 const updater=new Updater();let proof={...clean};let controller:ReturnType<typeof createDesktopUpdater>;
 controller=createDesktopUpdater({updater,installed:true,currentVersion:'0.6.3',isStableNewerVersion:()=>true,compatibility:async()=>({allowed:true}),notify:state=>{if(state.state==='installing'){if(action==='dispose')controller.dispose();else proof.osSessionEnding=true;}}});
 await controller.check();expect(await controller.installAfterClose(()=>proof,false)).toBe(false);expect(updater.installs).toEqual([]);controller.dispose();
});
