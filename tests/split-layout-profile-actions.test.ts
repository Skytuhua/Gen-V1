import {expect,it} from 'vitest';
import {createSplitWorkspaceLayout} from '../packages/core/split-workspace-layout';
import {createSplitLayoutProfileActions,type SplitProfileResult} from '../apps/web/src/layout-profile';

const result=(id='saved',updatedAt='2026-11-06T00:00:00.000Z'):SplitProfileResult=>({id,updatedAt,layout:createSplitWorkspaceLayout()});
it('binds selection to the host receipt despite concurrent creation and initially unavailable metadata',async()=>{
 let commands=0;const actions=createSplitLayoutProfileActions({prepare:async()=>{},save:async()=>{commands++;return result('exact');},send:async()=>createSplitWorkspaceLayout(),refresh:async()=>[{id:'concurrent',name:'Desk'},{id:'exact',name:'Desk'}]});
 await expect(actions.save('Desk')).resolves.toMatchObject({id:'exact'});expect(commands).toBe(1);
});
it('retries metadata after a committed save without creating a second layout',async()=>{
 let commands=0,refreshes=0;const actions=createSplitLayoutProfileActions({prepare:async()=>{},save:async()=>{commands++;return result();},send:async()=>createSplitWorkspaceLayout(),refresh:async()=>{if(++refreshes===1)throw Error('metadata temporarily unavailable');return[{id:'saved',name:'Desk'}];}});
 await expect(actions.save('Desk')).rejects.toThrow('metadata temporarily unavailable');expect(commands).toBe(1);
 await expect(actions.save('Desk')).resolves.toMatchObject({id:'saved'});expect(commands).toBe(1);expect(refreshes).toBe(2);
});
it('keeps the committed version when another client updates metadata before recovery',async()=>{
 const committed=result();let reads=0;const actions=createSplitLayoutProfileActions({prepare:async()=>{},save:async()=>committed,send:async()=>createSplitWorkspaceLayout(),refresh:async()=>{if(++reads===1)throw Error('offline');return[{id:'saved',name:'Changed elsewhere',updatedAt:'2026-11-06T01:00:00.000Z'}];}});
 await expect(actions.save('Desk')).rejects.toThrow('offline');await expect(actions.save('Desk')).resolves.toEqual(committed);
});
it('clears a missing-record recovery lock so a later explicit save can proceed',async()=>{
 let saves=0;const actions=createSplitLayoutProfileActions({prepare:async()=>{},save:async()=>result(++saves===1?'deleted':'new'),send:async()=>createSplitWorkspaceLayout(),refresh:async()=>saves===1?[]:[{id:'new',name:'New'}]});
 await expect(actions.save('Deleted')).rejects.toThrow('no longer available');await expect(actions.save('New')).resolves.toMatchObject({id:'new'});expect(saves).toBe(2);
});
it('finishes a known committed save before a different explicit save without duplicating it',async()=>{
 let saves=0,reads=0;const actions=createSplitLayoutProfileActions({prepare:async()=>{},save:async()=>result(++saves===1?'first':'second'),send:async()=>createSplitWorkspaceLayout(),refresh:async()=>{if(++reads===1)throw Error('offline');return[{id:'first',name:'First'},{id:'second',name:'Second'}];}});
 await expect(actions.save('First')).rejects.toThrow('offline');await expect(actions.save('Second')).resolves.toMatchObject({id:'second'});expect(saves).toBe(2);
});
it('rename emits a name-only command without saving the current arrangement over the named record',async()=>{
 const commands:{type:string;payload:Record<string,unknown>}[]=[],actions=createSplitLayoutProfileActions({prepare:async()=>{},save:async()=>{throw Error('must not save');},send:async(type,payload)=>{commands.push({type,payload});return createSplitWorkspaceLayout();},refresh:async()=>[{id:'saved',name:'Renamed'}]});
 await actions.rename('saved','Renamed');expect(commands).toEqual([{type:'profile.rename',payload:{profileId:'saved',name:'Renamed'}}]);
});
it('failed prepare leaves canonical state with the host and sends no mutation',async()=>{
 let sends=0;const actions=createSplitLayoutProfileActions({prepare:async()=>{throw Error('draft not flushed');},save:async()=>{sends++;return result();},send:async()=>{sends++;return createSplitWorkspaceLayout();},refresh:async()=>[]});await expect(actions.apply('saved')).rejects.toThrow('draft not flushed');await expect(actions.save('Desk')).rejects.toThrow('draft not flushed');expect(sends).toBe(0);
});
it('rejects an update receipt that identifies a different saved record',async()=>{
 const actions=createSplitLayoutProfileActions({prepare:async()=>{},save:async()=>result('wrong'),send:async()=>createSplitWorkspaceLayout(),refresh:async()=>[]});await expect(actions.save('Desk','expected')).rejects.toThrow('identity changed');
});
