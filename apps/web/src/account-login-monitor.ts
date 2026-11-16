import type {DesktopBridge} from '../../../packages/desktop-contract';
import type {AccountLoginFlow} from '../../../packages/contracts/authentication';
import type {ConnectionProviderId} from '../../../packages/contracts/connections';
import {getAccountAuth,type AccountAuthChanged} from './account-api';

export const accountTargetKey=(providerId:string,accountId?:string|null)=>JSON.stringify([providerId,accountId??null]);
const polling=(flow:AccountLoginFlow)=>['opening','waiting','cancelling'].includes(flow.state);
/** Renderer observation never releases or cancels native ownership on disposal. */
export function createAccountLoginMonitor(bridge:DesktopBridge,changed:(flows:Record<string,AccountLoginFlow>)=>void,onAuthChanged:AccountAuthChanged){
  let flows:Record<string,AccountLoginFlow>={},disposed=false,sequence=0;
  const versions=new Map<string,number>(),notified=new Set<string>(),control=new AbortController();
  const publish=()=>{if(!disposed)changed({...flows});};
  const accept=(flow:AccountLoginFlow,replace=false)=>{
    if(disposed)return;
    const key=accountTargetKey(flow.providerId,flow.accountId),previous=flows[key];
    if(previous&&previous.id!==flow.id&&!replace)return;
    sequence++;flows={...flows,[key]:{...flow}};publish();
    if(flow.state!=='completed'||notified.has(flow.id))return;
    notified.add(flow.id);
    const target={providerId:flow.providerId,accountId:flow.accountId};
    void getAccountAuth(target,control.signal).then(async()=>{
      if(!disposed&&flows[key]?.id===flow.id)await onAuthChanged(target,'completed',flow.id);
    }).catch(()=>{
      if(!disposed&&flows[key]?.id===flow.id){flows={...flows,[key]:{...flows[key],message:flow.message+' Connection refresh failed. Check connection and refresh models.'}};publish();}
    });
  };
  let timer:ReturnType<typeof setTimeout>;
  const tick=async()=>{
    try{await Promise.all(Object.values(flows).filter(polling).map(async flow=>{
      if(!bridge.signInStatus)return;
      const version=versions.get(flow.id)??0;
      try{
        const next=await bridge.signInStatus(flow.id);
        if(!disposed&&(versions.get(flow.id)??0)===version&&flows[accountTargetKey(flow.providerId,flow.accountId)]?.id===flow.id&&next?.id===flow.id&&next.providerId===flow.providerId&&next.accountId===flow.accountId)accept(next);
      }catch{/* Keep the owned flow visible; the next serialized poll can recover. */}
    }));}finally{if(!disposed)timer=setTimeout(()=>void tick(),750);}
  };
  timer=setTimeout(()=>void tick(),750);
  return {
    async recover(){const version=sequence,next=await bridge.activeSignIn?.();if(!disposed&&version===sequence&&next)accept(next,true);return next??null;},
    async start(providerId:ConnectionProviderId,accountId?:string){const version=++sequence,next=await bridge.signIn(providerId,accountId);if(!disposed&&version===sequence&&next)accept(next,true);return next;},
    async cancel(id:string){if(!bridge.cancelSignIn)throw Error('Native cancellation is unavailable.');sequence++;versions.set(id,(versions.get(id)??0)+1);const next=await bridge.cancelSignIn(id);if(!disposed)accept(next);return next;},
    close(){disposed=true;control.abort();clearTimeout(timer);},
  };
}
