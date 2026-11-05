export type UpdateStatus={
 state:'unavailable'|'idle'|'checking'|'current'|'downloading'|'ready'|'deferred'|'failed'|'installing';
 message:string;
 version?:string;
 percent?:number;
};

/** Missing or unknown close evidence always defers installation. */
export interface UpdateCloseProof {
 activeWorkAtClose?:boolean;
 osSessionEnding?:boolean;
 savedStateFlushed?:boolean;
 backendStoppedCleanly?:boolean;
}

type UpdaterEvents={
 error:(error:Error)=>void;
 'download-progress':(progress:{percent:number})=>void;
 'update-downloaded':(info:{version:string})=>void;
};

/** The supported electron-updater 6.8.11 surface, without loading Electron in tests. */
export interface DesktopUpdateDriver {
 channel:string|null;
 allowPrerelease:boolean;
 allowDowngrade:boolean;
 autoDownload:boolean;
 autoInstallOnAppQuit:boolean;
 checkForUpdates():Promise<{isUpdateAvailable:boolean;updateInfo:{version:string;draft?:boolean;prerelease?:boolean}}|null>;
 downloadUpdate():Promise<string[]>;
 quitAndInstall(isSilent?:boolean,isForceRunAfter?:boolean):void;
 on<K extends keyof UpdaterEvents>(event:K,listener:UpdaterEvents[K]):unknown;
 removeListener<K extends keyof UpdaterEvents>(event:K,listener:UpdaterEvents[K]):unknown;
}

export interface DesktopUpdaterOptions {
 updater:DesktopUpdateDriver;
 /** True only for an updater-capable installation, never a development or unpacked run. */
 installed:boolean;
 currentVersion:string;
 /** Supply a semantic-version library predicate; prereleases and downgrades must return false. */
 isStableNewerVersion:(candidate:string,current:string)=>boolean;
 /** Reads the current installed plug-in inventory every time; failures must reject. */
 compatibility:(candidateVersion:string)=>Promise<{allowed:boolean}>;
 notify?:(status:UpdateStatus)=>void;
 timers?:{setInterval(callback:()=>void,delayMs:number):unknown;clearInterval(handle:unknown):void};
}

export interface DesktopUpdater {
 start():Promise<UpdateStatus>;
 check():Promise<UpdateStatus>;
 status():UpdateStatus;
 dispose():void;
 /** True means the verified installer was requested, not that installation has completed. */
 installAfterClose(proof:UpdateCloseProof|(()=>UpdateCloseProof),restart:boolean):Promise<boolean>;
}

/** The host owns the feed, integrity verification, plug-in inventory and close evidence. */
export function createDesktopUpdater(options:DesktopUpdaterOptions):DesktopUpdater {
 const updater=options.updater;
 updater.channel='latest';
 updater.allowPrerelease=false;
 // The channel setter enables downgrades, so explicitly turn them off afterward.
 updater.allowDowngrade=false;
 updater.autoDownload=false;
 updater.autoInstallOnAppQuit=false;
 const timers=options.timers??{
  setInterval(callback:()=>void,delayMs:number){const timer=setInterval(callback,delayMs);timer.unref();return timer;},
  clearInterval(handle:unknown){clearInterval(handle as ReturnType<typeof setInterval>);},
 };
 let state:UpdateStatus=options.installed?{state:'idle',message:'Gen checks for stable updates automatically.'}:{state:'unavailable',message:'Install Gen to receive automatic updates.'};
 let disposed=false,started=false,generation=0,installationRequested=false,installPending=false;
 let timer:unknown,checkPending:Promise<UpdateStatus>|undefined;
 type Candidate={version:string;generation:number;phase:'checking'|'downloading'|'ready';downloadVerified:boolean};
 let candidate:Candidate|undefined;
 const status=():UpdateStatus=>({...state});
 const publish=(next:UpdateStatus)=>{state=next;try{options.notify?.(status());}catch{/* A notification failure cannot change update authority. */}};
 const current=(entry:Candidate)=>!disposed&&candidate===entry&&generation===entry.generation;
 const failure=()=>{generation++;candidate=undefined;if(!disposed)publish({state:'failed',message:'The update could not be verified. Gen will keep the current version.'});};
 const defer=(version:string,message='An installed plug-in needs attention before Gen can update.')=>publish({state:'deferred',version,message});
 const onError=()=>failure();
 const onProgress=(progress:{percent:number})=>{
  if(candidate?.phase==='downloading'&&current(candidate)&&typeof progress?.percent==='number'&&Number.isFinite(progress.percent)&&progress.percent>=0&&progress.percent<=100)publish({state:'downloading',version:candidate.version,percent:progress.percent,message:'Downloading the next stable version of Gen.'});
 };
 const onDownloaded=(info:{version:string})=>{
  const entry=candidate;if(!entry||entry.phase!=='downloading'||!current(entry))return;
  if(!info||info.version!==entry.version){failure();return;}
  entry.downloadVerified=true;
 };
 updater.on('error',onError);updater.on('download-progress',onProgress);updater.on('update-downloaded',onDownloaded);

 const check=():Promise<UpdateStatus>=>{
  if(disposed||!options.installed||installationRequested||installPending)return Promise.resolve(status());
  if(checkPending)return checkPending;
  const token=++generation;candidate=undefined;
  checkPending=Promise.resolve().then(async()=>{
   try{
    if(disposed||generation!==token)return status();
    const result=await updater.checkForUpdates();
    if(disposed||generation!==token)return status();
    const info=result?.updateInfo;
    if(result?.isUpdateAvailable!==true||!info||typeof info.version!=='string'||info.version.length>200||info.draft===true||info.prerelease===true||!options.isStableNewerVersion(info.version,options.currentVersion)){
     publish({state:'current',message:'Gen is using the latest available stable version.'});return status();
    }
    const entry:Candidate={version:info.version,generation:token,phase:'checking',downloadVerified:false};candidate=entry;
    const before=await options.compatibility(entry.version);
    if(!current(entry))return status();
    if(before?.allowed!==true){defer(entry.version);return status();}
    entry.phase='downloading';publish({state:'downloading',version:entry.version,percent:0,message:'Downloading the next stable version of Gen.'});
    if(!current(entry))return status();
    const files=await updater.downloadUpdate();
    if(!current(entry))return status();
    if(!entry.downloadVerified||!Array.isArray(files)||!files.length||files.some(file=>typeof file!=='string'||!file.trim())){failure();return status();}
    const after=await options.compatibility(entry.version);
    if(!current(entry))return status();
    if(after?.allowed!==true){defer(entry.version);return status();}
    entry.phase='ready';publish({state:'ready',version:entry.version,message:'An update is ready. Gen will install it after a safe close.'});
   }catch{if(!disposed&&generation===token)failure();}
   return status();
  }).finally(()=>{checkPending=undefined;});
  publish({state:'checking',message:'Checking for stable updates…'});
  return checkPending;
 };
 const safeClose=(proof:UpdateCloseProof|(()=>UpdateCloseProof))=>{
  try{const value=typeof proof==='function'?proof():proof;return value?.activeWorkAtClose===false&&value.osSessionEnding===false&&value.savedStateFlushed===true&&value.backendStoppedCleanly===true;}catch{return false;}
 };
 return {
  status,check,
  start(){
   if(disposed||!options.installed||started)return checkPending??Promise.resolve(status());
   started=true;timer=timers.setInterval(()=>{void check();},21_600_000);return check();
  },
  dispose(){
   if(disposed)return;disposed=true;generation++;candidate=undefined;
   if(timer!==undefined)timers.clearInterval(timer);
   // A driver can still emit an error while its pending download is settling.
   // Keep this inert error listener until then so disposal cannot crash Electron.
   if(checkPending)void checkPending.finally(()=>updater.removeListener('error',onError));else updater.removeListener('error',onError);
   updater.removeListener('download-progress',onProgress);updater.removeListener('update-downloaded',onDownloaded);
   publish({state:'unavailable',message:'Automatic update checks have stopped.'});
  },
  async installAfterClose(proof,restart){
   const entry=candidate;
   if(disposed||!options.installed||installationRequested||installPending||checkPending||!entry||entry.phase!=='ready'||!entry.downloadVerified||!current(entry))return false;
   if(!safeClose(proof)){defer(entry.version,'The update is waiting for work, saved state and normal shutdown to finish.');return false;}
   installPending=true;
   try{
    const compatible=await options.compatibility(entry.version);
    if(!current(entry))return false;
    if(compatible?.allowed!==true){defer(entry.version);return false;}
    if(!safeClose(proof)){defer(entry.version,'The update is waiting for work, saved state and normal shutdown to finish.');return false;}
    if(!options.isStableNewerVersion(entry.version,options.currentVersion)){failure();return false;}
    publish({state:'installing',version:entry.version,message:'Installing the verified Gen update.'});
    if(!current(entry)||!safeClose(proof))return false;
    installationRequested=true;
    updater.quitAndInstall(true,restart);
    return current(entry);
   }catch{if(current(entry))failure();return false;}
   finally{installPending=false;}
  },
 };
}
