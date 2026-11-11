import {useEffect,useSyncExternalStore} from 'react';
import {attentionItemSchema,type AttentionEnvelope} from '../../../packages/contracts/attention.ts';
import {authenticated,csrfToken,read,subscribe} from './api';

let state:AttentionEnvelope&{error:string}={items:[],unread:0,sequence:0,error:''};
const listeners=new Set<()=>void>();let stop:(()=>void)|undefined,flight:Promise<void>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
const publish=()=>{for(const listener of listeners)listener();};
export function refreshAttention():Promise<void>{
 return flight??=(async()=>{try{const value=await authenticated(()=>fetch('/api/attention',{credentials:'same-origin',cache:'no-store',redirect:'error'})).then(read<AttentionEnvelope>);if(!Array.isArray(value.items)||value.items.length>1000||!Number.isSafeInteger(value.sequence))throw Error('The Inbox response is invalid.');state={...value,items:value.items.map(item=>attentionItemSchema.parse(item)),error:''};publish();}catch(cause){state={...state,error:cause instanceof Error?cause.message:'Inbox could not load.'};publish();}finally{flight=undefined;}})();
}
function listen(listener:()=>void){listeners.add(listener);if(listeners.size===1){let cancelled=false,disconnect:(()=>void)|undefined;const changed=()=>{clearTimeout(timer);timer=setTimeout(()=>void refreshAttention(),60);};void refreshAttention().then(()=>{if(cancelled||!listeners.size)return;disconnect=subscribe(state.sequence,changed,connected=>{if(!connected){state={...state,error:'Inbox is reconnecting…'};publish();}},refreshAttention);});window.addEventListener('focus',changed);stop=()=>{cancelled=true;disconnect?.();window.removeEventListener('focus',changed);};}return()=>{listeners.delete(listener);if(!listeners.size){clearTimeout(timer);stop?.();stop=undefined;}};}
async function change(eventId:string,type:'read'|'unread'|'dismiss-popup'){const body=JSON.stringify({id:crypto.randomUUID(),type});await authenticated(()=>fetch(`/api/attention/${encodeURIComponent(eventId)}/commands`,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json','x-harness-csrf':csrfToken},body})).then(read);await refreshAttention();}
export function useAttention(enabled=true){const current=useSyncExternalStore(enabled?listen:()=>()=>{},()=>state,()=>state);useEffect(()=>{if(enabled)void refreshAttention();},[enabled]);return{...current,refresh:refreshAttention,markRead:(id:string)=>change(id,'read'),markUnread:(id:string)=>change(id,'unread'),dismissPopup:(id:string)=>change(id,'dismiss-popup')};}
