/** Data-only bridge for a sandboxed frame. It never carries personal commands,
 * cookies, CSRF tokens, account identities or arbitrary destination URLs. */
import {pluginIdSchema} from './contracts.ts';
export interface PluginFrameRequest {
  type:'gen.plugin.request'; session:string; id:string; pluginId:string;
  operation:string; input:unknown;
}
const identity=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/;
export const pluginWindowOperation=(operation:string)=>['window.capabilities','window.list','window.detach','window.reattach'].includes(operation);
export function parsePluginFrameRequest(value:unknown,pluginId:string,session:string):PluginFrameRequest|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const item=value as Record<string,unknown>;
  if(Object.keys(item).length!==6||item.type!=='gen.plugin.request'||item.pluginId!==pluginId||item.session!==session||typeof item.id!=='string'||!identity.test(item.id)||typeof item.operation!=='string'||!/^[a-z][a-zA-Z0-9.:-]{0,99}$/.test(item.operation)||!Object.hasOwn(item,'input'))return null;
  try{if(JSON.stringify(item).length>1024*1024)return null;}catch{return null;}
  return item as unknown as PluginFrameRequest;
}
export function pluginFrameSource(pluginId:string,session:string,theme:'light'|'dark',surface?:{scopeId:string;surfaceId:string;resourceId?:string}):string {
  if(!pluginIdSchema.safeParse(pluginId).success||!identity.test(session))throw Error('Invalid plug-in frame identity.');
  const query=surface?Object.entries({scopeId:surface.scopeId,surfaceId:surface.surfaceId,resourceId:surface.resourceId}).filter(([,value])=>value!==undefined).map(([key,value])=>`&${key}=${encodeURIComponent(value!)}`).join(''):'';
  return `/plugins/${pluginId}/frame?session=${encodeURIComponent(session)}&theme=${theme}${query}`;
}
export function pluginFrameReply(id:string,value:unknown,error?:unknown) {
  if(error)return {type:'gen.plugin.reply' as const,id,ok:false as const,error:'This plug-in request could not complete. Your saved work is retained.'};
  return {type:'gen.plugin.reply' as const,id,ok:true as const,value};
}
