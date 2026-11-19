/** Data-only bridge for a sandboxed frame. It never carries personal commands,
 * cookies, CSRF tokens, account identities or arbitrary destination URLs. */
import {pluginIdSchema,pluginWorkspaceContributionSchema,type PluginWorkspaceContribution} from './contracts.ts';
/** One validated `gen.plugin.request` message posted by a plug-in frame:
 * the owning session, a unique request id, the plug-in id, the host operation
 * name and its JSON input. */
export interface PluginFrameRequest {
  type:'gen.plugin.request'; session:string; id:string; pluginId:string;
  operation:string; input:unknown;
}
const identity=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/;
/** True for the bounded frame operations the parent answers itself — window
 * capability/list/detach/reattach and the `presentation.set` UI preference —
 * rather than dispatching to the plug-in host over RPC. */
export const pluginWindowOperation=(operation:string)=>['window.capabilities','window.list','window.detach','window.reattach','presentation.set'].includes(operation);
/** Validate a frame message for this plug-in/session. Returns null unless it
 * is exactly the six request fields, the plug-in and session match, `id` and
 * `operation` satisfy their bounded patterns, `input` is present and the whole
 * message serializes to at most 1 MiB. */
export function parsePluginFrameRequest(value:unknown,pluginId:string,session:string):PluginFrameRequest|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const item=value as Record<string,unknown>;
  if(Object.keys(item).length!==6||item.type!=='gen.plugin.request'||item.pluginId!==pluginId||item.session!==session||typeof item.id!=='string'||!identity.test(item.id)||typeof item.operation!=='string'||!/^[a-z][a-zA-Z0-9.:-]{0,99}$/.test(item.operation)||!Object.hasOwn(item,'input'))return null;
  try{if(JSON.stringify(item).length>1024*1024)return null;}catch{return null;}
  return item as unknown as PluginFrameRequest;
}
/** Build the `/plugins/<id>/frame` URL for a plug-in view. `theme` is carried
 * for first paint. Pass `surface` for a detached window or `workspace` for a
 * contributed workspace — never both; throws on an invalid plug-in/session
 * identity or on supplying both owners. */
export function pluginFrameSource(pluginId:string,session:string,theme:'light'|'dark',surface?:{scopeId:string;surfaceId:string;resourceId?:string},workspace?:PluginWorkspaceContribution):string {
  if(!pluginIdSchema.safeParse(pluginId).success||!identity.test(session))throw Error('Invalid plug-in frame identity.');
  if(surface&&workspace)throw Error('Choose one owning plug-in view.');
  const contribution=workspace?pluginWorkspaceContributionSchema.parse(workspace):undefined;
  const query=surface?Object.entries({scopeId:surface.scopeId,surfaceId:surface.surfaceId,resourceId:surface.resourceId}).filter(([,value])=>value!==undefined).map(([key,value])=>`&${key}=${encodeURIComponent(value!)}`).join(''):'';
  return `/plugins/${pluginId}/frame?session=${encodeURIComponent(session)}&theme=${theme}${query}${contribution?`&workspace=${encodeURIComponent(contribution.id)}&view=${encodeURIComponent(contribution.entryView)}`:''}`;
}
/** Build the `gen.plugin.reply` answering a request id: the result value on
 * success, or a fixed credential-free failure message when `error` is set —
 * internal error text never crosses the frame boundary. */
export function pluginFrameReply(id:string,value:unknown,error?:unknown) {
  if(error)return {type:'gen.plugin.reply' as const,id,ok:false as const,error:'This plug-in request could not complete. Your saved work is retained.'};
  return {type:'gen.plugin.reply' as const,id,ok:true as const,value};
}
