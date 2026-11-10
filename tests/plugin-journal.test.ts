import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
async function setup(){
 const requests:{id:string;operation:string;input:unknown}[]=[];let receive!:(event:{source:unknown;data:unknown})=>void;
 const owner={postMessage:(value:{id:string;operation:string;input:unknown})=>requests.push(value)};
 vi.stubGlobal('location',{search:'?session=test-session'});vi.stubGlobal('document',{querySelector:()=>({content:'example-plugin'}),documentElement:{dataset:{}}});
 vi.stubGlobal('window',{parent:owner});vi.stubGlobal('parent',owner);vi.stubGlobal('addEventListener',(_type:string,listener:typeof receive)=>{receive=listener;});
 const sdk=await import('../apps/web/src/plugin-frame-client');
 const reply=(index:number,ok:boolean)=>receive({source:owner,data:{type:'gen.plugin.reply',id:requests[index].id,ok,...(ok?{value:null}:{error:'Save failed'})}});
 return {sdk,requests,reply,receive,owner};
}
it('refuses close after a failed draft save until that key is saved successfully',async()=>{
 const f=await setup(),write=f.sdk.journalWrite('company:example:manager:project:v1',{instruction:'unsaved draft'});await vi.waitFor(()=>expect(f.requests.length).toBe(1));f.reply(0,false);await expect(write).rejects.toThrow();
 await expect(f.sdk.pluginFlush()).rejects.toThrow(/draft|save/i);
 const retry=f.sdk.journalWrite('company:example:manager:project:v1',{instruction:'unsaved draft'});await vi.waitFor(()=>expect(f.requests.length).toBe(2));f.reply(1,true);await retry;await expect(f.sdk.pluginFlush()).resolves.toBeUndefined();
});
it('sends same-key writes in order so an older response cannot replace a newer draft',async()=>{
 const f=await setup(),first=f.sdk.journalWrite('company:example:key:v1','first'),second=f.sdk.journalWrite('company:example:key:v1','latest');await vi.waitFor(()=>expect(f.requests.length).toBe(1));f.reply(0,true);await first;await vi.waitFor(()=>expect(f.requests.length).toBe(2));expect(f.requests[1].input).toEqual({key:'company:example:key:v1',value:'latest'});f.reply(1,true);await second;
});
it('explicit save retry resends only the latest local journal intent',async()=>{
 const f=await setup(),write=f.sdk.journalWrite('company:example:key:v1',{instruction:'retained draft'});await vi.waitFor(()=>expect(f.requests.length).toBe(1));f.reply(0,false);await expect(write).rejects.toThrow();const retry=f.sdk.retryJournalWrites();await vi.waitFor(()=>expect(f.requests.length).toBe(2));expect(f.requests.map(request=>request.operation)).toEqual(['state.write','state.write']);expect(f.requests[1].input).toEqual(f.requests[0].input);f.reply(1,true);await retry;await expect(f.sdk.pluginFlush()).resolves.toBeUndefined();
});
it('routes a docked surface only from the current parent session and owning plug-in',async()=>{
 const f=await setup(),seen:unknown[]=[],remove=f.sdk.onPluginSurfaceFocus(value=>seen.push(value));
 const surface={kind:'plugin',pluginId:'example-plugin',scopeId:'project',surfaceId:'plan',resourceId:'order'};
 f.receive({source:f.owner,data:{type:'gen.plugin.focus-surface',id:'focus-1',session:'other',surface}});
 f.receive({source:f.owner,data:{type:'gen.plugin.focus-surface',id:'focus-1',session:'test-session',surface:{...surface,pluginId:'other-plugin'}}});
 f.receive({source:{},data:{type:'gen.plugin.focus-surface',id:'focus-1',session:'test-session',surface}});
 expect(seen).toEqual([]);
 f.receive({source:f.owner,data:{type:'gen.plugin.focus-surface',id:'focus-1',session:'test-session',surface}});expect(seen).toEqual([surface]);
 remove();f.receive({source:f.owner,data:{type:'gen.plugin.focus-surface',id:'focus-1',session:'test-session',surface}});expect(seen).toEqual([surface]);
});
