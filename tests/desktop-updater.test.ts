import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {afterEach,expect,it,vi} from 'vitest';
import {createDesktopUpdater,type UpdateStatus} from '../apps/desktop/updater.ts';

const semver=createRequire(import.meta.url)('semver') as {valid(value:string):string|null;prerelease(value:string):unknown[]|null;gt(left:string,right:string):boolean};
const isStableNewerVersion=(candidate:string,current:string)=>Boolean(semver.valid(candidate)&&!semver.prerelease(candidate)&&semver.gt(candidate,current));
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
class FakeUpdater extends EventEmitter {
 channel:string|null=null;allowPrerelease=true;allowDowngrade=true;autoDownload=true;autoInstallOnAppQuit=true;
 checks=0;downloads=0;installs:{silent?:boolean;restart?:boolean}[]=[];
 info:{isUpdateAvailable:boolean;updateInfo:{version:string;draft?:boolean;prerelease?:boolean}}|null={isUpdateAvailable:true,updateInfo:{version:'0.7.0'}};
 checkAction?:()=>Promise<typeof this.info>;
 downloadAction?:()=>Promise<string[]>;
 async checkForUpdates(){this.checks++;return this.checkAction?this.checkAction():this.info;}
 async downloadUpdate(){this.downloads++;if(this.downloadAction)return this.downloadAction();this.emit('download-progress',{percent:25});this.emit('update-downloaded',{version:this.info!.updateInfo.version});return ['verified-installer.exe'];}
 quitAndInstall(silent?:boolean,restart?:boolean){this.installs.push({silent,restart});}
}
function fixture(options:{installed?:boolean;compatible?:(version:string)=>Promise<{allowed:boolean}>}={}){
 const updater=new FakeUpdater(),notifications:UpdateStatus[]=[];
 const controller=createDesktopUpdater({updater,installed:options.installed??true,currentVersion:'0.6.3',isStableNewerVersion,compatibility:options.compatible??(async()=>({allowed:true})),notify:state=>notifications.push(state)});
 return {updater,notifications,controller};
}
afterEach(()=>vi.useRealTimers());

it('checks on startup and every six hours, and releases its timer on disposal',async()=>{
 vi.useFakeTimers();const f=fixture();f.updater.info=null;
 await f.controller.start();await f.controller.start();expect(f.updater.checks).toBe(1);
 await vi.advanceTimersByTimeAsync(21_599_999);expect(f.updater.checks).toBe(1);
 await vi.advanceTimersByTimeAsync(1);expect(f.updater.checks).toBe(2);
 f.controller.dispose();await vi.advanceTimersByTimeAsync(21_600_000);expect(f.updater.checks).toBe(2);
});
it('uses stable metadata and requires explicit installation through the owned close path',async()=>{
 const f=fixture();await f.controller.check();
 expect(f.updater).toMatchObject({channel:'latest',allowPrerelease:false,allowDowngrade:false,autoDownload:false,autoInstallOnAppQuit:false});
 expect(f.updater.downloads).toBe(1);expect(f.controller.status()).toMatchObject({state:'ready',version:'0.7.0'});expect(f.updater.installs).toEqual([]);
 expect(f.notifications).toContainEqual(expect.objectContaining({state:'downloading',percent:25}));f.controller.dispose();
});
it('keeps unpacked or development applications outside automatic updating',async()=>{
 vi.useFakeTimers();const f=fixture({installed:false});await f.controller.start();await f.controller.check();
 await vi.advanceTimersByTimeAsync(43_200_000);expect(f.updater.checks).toBe(0);expect(f.updater.downloads).toBe(0);expect(f.controller.status().state).toBe('unavailable');f.controller.dispose();
});
it.each(['0.7.0-beta.1','0.6.3','0.5.9','main','abc123','0.7','vNext'])('does not download a nonstable or nonnewer candidate %s',async version=>{
 const f=fixture();f.updater.info={isUpdateAvailable:true,updateInfo:{version}};await f.controller.check();expect(f.updater.downloads).toBe(0);expect(f.updater.installs).toEqual([]);f.controller.dispose();
});
it.each([{draft:true},{prerelease:true}])('rejects unpublished release metadata %j',async flags=>{
 const f=fixture();f.updater.info={isUpdateAvailable:true,updateInfo:{version:'0.7.0',...flags}};await f.controller.check();expect(f.updater.downloads).toBe(0);f.controller.dispose();
});
it('coalesces overlapping checks before and during the compatibility check',async()=>{
 const gate=deferred<{allowed:boolean}>(),f=fixture({compatible:()=>gate.promise});
 const first=f.controller.check(),second=f.controller.check();await vi.waitFor(()=>expect(f.updater.checks).toBe(1));
 const third=f.controller.check();gate.resolve({allowed:true});await Promise.all([first,second,third]);expect(f.updater.checks).toBe(1);expect(f.updater.downloads).toBe(1);f.controller.dispose();
});
it('holds an incompatible or unreadable plug-in inventory before download',async()=>{
 for(const compatible of [async()=>({allowed:false}),async()=>{throw Error('private-plugin-path');}]){
  const f=fixture({compatible});await f.controller.check();expect(f.updater.downloads).toBe(0);expect(['deferred','failed']).toContain(f.controller.status().state);expect(JSON.stringify(f.controller.status())).not.toContain('private-plugin-path');f.controller.dispose();
 }
});
it('rechecks plug-ins after a verified download and defers if the inventory changed',async()=>{
 let reads=0;const f=fixture({compatible:async()=>({allowed:++reads===1})});await f.controller.check();expect(f.updater.downloads).toBe(1);expect(reads).toBe(2);expect(f.controller.status().state).toBe('deferred');f.controller.dispose();
});
it('requires the verified download event and a completed nonempty download result',async()=>{
 for(const mode of ['no-event','wrong-version','empty-result','failed-download'] as const){
  const f=fixture();f.updater.downloadAction=async()=>{if(mode==='failed-download')throw Error('private-native-error');if(mode!=='no-event')f.updater.emit('update-downloaded',{version:mode==='wrong-version'?'0.8.0':'0.7.0'});return mode==='empty-result'?[]:['installer'];};
  await f.controller.check();expect(f.controller.status().state).toBe('failed');expect(JSON.stringify(f.controller.status())).not.toContain('private-native-error');expect(f.updater.installs).toEqual([]);f.controller.dispose();
 }
});
it('invalidates a failed check and permits a later successful retry',async()=>{
 const f=fixture();f.updater.checkAction=async()=>{throw Error('credential-bearing-error');};await f.controller.check();expect(f.controller.status().state).toBe('failed');expect(JSON.stringify(f.controller.status())).not.toContain('credential-bearing-error');
 f.updater.checkAction=undefined;await f.controller.check();expect(f.controller.status().state).toBe('ready');f.controller.dispose();
});
it('ignores late download completions after disposal and removes its listeners',async()=>{
 const download=deferred<string[]>(),f=fixture();f.updater.downloadAction=()=>download.promise;const checking=f.controller.check();await vi.waitFor(()=>expect(f.updater.downloads).toBe(1));
 f.controller.dispose();f.updater.emit('update-downloaded',{version:'0.7.0'});download.resolve(['installer']);await checking;
 expect(f.controller.status().state).toBe('unavailable');expect(f.updater.listenerCount('update-downloaded')).toBe(0);expect(f.updater.installs).toEqual([]);
});
it('handles an in-flight driver error after disposal without leaving listeners behind',async()=>{
 const download=deferred<string[]>(),f=fixture();f.updater.downloadAction=()=>download.promise;const checking=f.controller.check();await vi.waitFor(()=>expect(f.updater.downloads).toBe(1));
 f.controller.dispose();expect(()=>f.updater.emit('error',Error('interrupted download'))).not.toThrow();download.reject(Error('interrupted download'));await checking;
 expect(f.updater.listenerCount('error')).toBe(0);expect(f.controller.status().state).toBe('unavailable');
});
it('does not start a download when notification handling disposes the updater',async()=>{
 const updater=new FakeUpdater();let controller:ReturnType<typeof createDesktopUpdater>;
 controller=createDesktopUpdater({updater,installed:true,currentVersion:'0.6.3',isStableNewerVersion,compatibility:async()=>({allowed:true}),notify:state=>{if(state.state==='downloading')controller.dispose();}});
 await controller.check();expect(updater.downloads).toBe(0);expect(controller.status().state).toBe('unavailable');
});
it('does not accept unsolicited download events or publish invalid progress',async()=>{
 const f=fixture();f.updater.emit('update-downloaded',{version:'0.7.0'});expect(f.controller.status().state).toBe('idle');
 f.updater.downloadAction=async()=>{for(const percent of [NaN,Infinity,-1,101])f.updater.emit('download-progress',{percent});f.updater.emit('update-downloaded',{version:'0.7.0'});return ['installer'];};
 await f.controller.check();expect(f.notifications.some(item=>item.percent!==undefined&&(!Number.isFinite(item.percent)||item.percent<0||item.percent>100))).toBe(false);f.controller.dispose();
});

it('honors the updater rollout and OS eligibility decision before downloading',async()=>{const f=fixture();f.updater.info!.isUpdateAvailable=false;await f.controller.check();expect(f.updater.downloads).toBe(0);expect(f.controller.status().state).toBe('current');f.controller.dispose();});
