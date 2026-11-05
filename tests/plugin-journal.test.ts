import {afterEach,expect,it,vi} from 'vitest';
const cleanups:(()=>void)[]=[];
afterEach(()=>{for(const cleanup of cleanups.splice(0))cleanup();vi.unstubAllGlobals();vi.resetModules();});
async function setup(){
 const requests:{id:string;operation:string;input:unknown}[]=[],listeners=new Map<string,((event:{source:unknown;data:unknown})=>void)[]>();let port!:MessagePort;
 // Exercise the real document-owned channel. The global parent message only
 // transfers the bootstrap port; it is not an RPC or a saved-state reply.
 const owner={postMessage:(value:{type:string;session:string;pluginId:string},_target:string,ports:MessagePort[])=>{
  expect(value).toEqual({type:'gen.plugin.connect',pluginId:'example-plugin',session:'test-session'});expect(ports).toHaveLength(1);
  port=ports[0];port.onmessage=event=>{if(event.data?.type==='gen.plugin.request')requests.push(event.data);};port.start();
  port.postMessage({type:'gen.plugin.connected',session:'test-session'});
 }};
 vi.stubGlobal('location',{search:'?session=test-session'});vi.stubGlobal('document',{querySelector:()=>({content:'example-plugin'}),documentElement:{dataset:{}}});
 vi.stubGlobal('window',{parent:owner});vi.stubGlobal('parent',owner);vi.stubGlobal('addEventListener',(type:string,listener:(event:{source:unknown;data:unknown})=>void)=>{listeners.set(type,[...(listeners.get(type)??[]),listener]);});
 const receive=(event:{source:unknown;data:unknown})=>{for(const listener of listeners.get('message')??[])listener(event);};
 cleanups.push(()=>{for(const listener of listeners.get('pagehide')??[])listener({source:owner,data:null});port?.close();});
 const sdk=await import('../apps/web/src/plugin-frame-client');
 const reply=(index:number,ok:boolean)=>port.postMessage({type:'gen.plugin.reply',id:requests[index].id,ok,...(ok?{value:null}:{error:'Save failed'})});
 const barrier=async()=>{const index=requests.length,read=sdk.journalRead('example:barrier');await vi.waitFor(()=>expect(requests).toHaveLength(index+1));reply(index,true);await read;};
 return {sdk,requests,reply,receive,owner,barrier,send:(data:unknown)=>port.postMessage(data)};
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
it('routes a docked surface only through the current document channel and owning plug-in',async()=>{
 const f=await setup(),seen:unknown[]=[],remove=f.sdk.onPluginSurfaceFocus(value=>seen.push(value));
 const surface={kind:'plugin',pluginId:'example-plugin',scopeId:'project',surfaceId:'plan',resourceId:'order'};
 f.send({type:'gen.plugin.focus-surface',id:'invalid-session',session:'other',surface});
 f.send({type:'gen.plugin.focus-surface',id:'invalid-plugin',session:'test-session',surface:{...surface,pluginId:'other-plugin'}});
 f.receive({source:{},data:{type:'gen.plugin.focus-surface',id:'focus-1',session:'test-session',surface}});
 f.receive({source:f.owner,data:{type:'gen.plugin.focus-surface',id:'focus-1',session:'test-session',surface}});
 // Port messages are asynchronous. A reply sent after these focus messages
 // proves they were delivered before the negative assertion runs.
 await f.barrier();expect(seen).toEqual([]);
 f.send({type:'gen.plugin.focus-surface',id:'focus-1',session:'test-session',surface});await vi.waitFor(()=>expect(seen).toEqual([surface]));
 remove();f.send({type:'gen.plugin.focus-surface',id:'focus-2',session:'test-session',surface});
 // A later port reply is an ordering barrier for the removed subscription.
 await f.barrier();expect(seen).toEqual([surface]);
});
it('ignores global replies even from the parent with the current request identity',async()=>{
 const f=await setup();let resolved=false;
 const read=f.sdk.journalRead('example:key').then(value=>{resolved=true;return value;});await vi.waitFor(()=>expect(f.requests).toHaveLength(1));
 f.receive({source:f.owner,data:{type:'gen.plugin.reply',id:f.requests[0].id,ok:true,value:'untrusted global reply'}});await Promise.resolve();expect(resolved).toBe(false);
 f.reply(0,true);await expect(read).resolves.toBeNull();
});
