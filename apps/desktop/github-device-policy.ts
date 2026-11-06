import type {DesktopSurface} from '../../packages/desktop-contract/index.ts';

export const GITHUB_DEVICE_URL='https://github.com/login/device';
interface Popup {url:string;referrer:{url:string}}
interface AppSource {surface:DesktopSurface;expectedUrl:string;currentUrl:string}
function appUrl(raw:string){
 try{const url=new URL(raw);return url.href===raw&&url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&!url.username&&!url.password&&url.pathname==='/'&&!url.hash&&/^\?desktopWindow=[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(url.search);}catch{return false;}
}

/** Main-process policy only. The injected opener accepts no renderer URL. */
export function githubDevicePopup(details:Popup,source:AppSource,openDevice:()=>Promise<void>|void):{action:'deny'}{
 const eligible=source.surface.kind==='main'||source.surface.kind==='thread'||source.surface.kind==='workspace'&&(source.surface.tab==='pull-request'||source.surface.tab==='linked-pull-requests');
 if(eligible&&appUrl(source.expectedUrl)&&details.url===GITHUB_DEVICE_URL&&source.currentUrl===source.expectedUrl&&details.referrer.url===source.expectedUrl){
  try{void Promise.resolve(openDevice()).catch(()=>{});}catch{/* Popup remains denied if the OS opener fails. */}
 }
 return{action:'deny'};
}
