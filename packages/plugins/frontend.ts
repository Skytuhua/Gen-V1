import {pluginManifestSchema,pluginWorkspacesSchema,type ConversationAdapter,type PluginManifest,type PluginWorkspaceContribution} from './contracts.ts';
export interface PluginRegistration {
  navigation:{id:string;title:string}[];
  conversation:ConversationAdapter;
  panels?:{id:string;title:string}[];
  windowBehavior?:{surfaceId:string;detachable:boolean}[];
  workspaces?:PluginWorkspaceContribution[];
}
let registered:{manifest:PluginManifest;registration:PluginRegistration}|undefined;
/** Registers presentation contributions inside the isolated plug-in runtime.
 * Native declarations are requests; the trusted host validates every window. */
export function registerPlugin(manifest:PluginManifest,registration:PluginRegistration){
  const parsed=pluginManifestSchema.parse(manifest);
  const expected=typeof document==='undefined'?undefined:document.querySelector<HTMLMetaElement>('meta[name="gen-plugin-id"]')?.content;
  if(expected&&expected!==parsed.id||registered)throw Error('This plug-in cannot register in another workspace.');
  if(!registration||!Array.isArray(registration.navigation)||registration.navigation.length>32||registration.navigation.some(item=>!/^[A-Za-z0-9_.:-]{1,100}$/.test(item.id)||!item.title||item.title.length>100)||!['load','send','submitArtifactAction','cancel'].every(key=>typeof registration.conversation?.[key as keyof ConversationAdapter]==='function'))throw Error('Invalid plug-in contributions.');
  if(registration.workspaces){const workspaces=pluginWorkspacesSchema.parse(registration.workspaces);if(JSON.stringify(workspaces)!==JSON.stringify(parsed.workspaces??[]))throw Error('Workspace contributions must match the installed manifest.');}
  const value={manifest:parsed,registration};registered=value;
  return ()=>{if(registered===value)registered=undefined;};
}
