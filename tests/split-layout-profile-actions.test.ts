import {expect,it} from 'vitest';
import {createSplitWorkspaceLayout} from '../packages/core/split-workspace-layout';
import {createSplitLayoutProfileActions} from '../apps/web/src/layout-profile';

it('retries metadata after a committed save without creating a second layout',async()=>{
 let list=[{id:'old',name:'Desk'}],commands=0,refreshes=0;
 const actions=createSplitLayoutProfileActions({profiles:()=>list,prepare:async()=>{},send:async()=>{commands++;list=[...list,{id:'created',name:'Desk'}];return createSplitWorkspaceLayout();},refresh:async()=>{if(++refreshes===1)throw Error('metadata temporarily unavailable');return list;}});
 await expect(actions.save('Desk')).rejects.toThrow('metadata temporarily unavailable');expect(commands).toBe(1);
 await expect(actions.save('Desk')).resolves.toMatchObject({id:'created'});expect(commands).toBe(1);expect(refreshes).toBe(2);
});
it('rename emits a name-only command without saving the current arrangement over the named record',async()=>{
 const commands:{type:string;payload:Record<string,unknown>}[]=[],actions=createSplitLayoutProfileActions({profiles:()=>[{id:'saved',name:'Desk'}],prepare:async()=>{},send:async(type,payload)=>{commands.push({type,payload});return createSplitWorkspaceLayout();},refresh:async()=>[{id:'saved',name:'Renamed'}]});
 await actions.rename('saved','Renamed');expect(commands).toEqual([{type:'profile.rename',payload:{profileId:'saved',name:'Renamed'}}]);
});
it('failed prepare or apply leaves canonical state with the host and never returns a false selection',async()=>{
 let sends=0;const actions=createSplitLayoutProfileActions({profiles:()=>[],prepare:async()=>{throw Error('draft not flushed');},send:async()=>{sends++;return createSplitWorkspaceLayout();},refresh:async()=>[]});await expect(actions.apply('saved')).rejects.toThrow('draft not flushed');await expect(actions.save('Desk')).rejects.toThrow('draft not flushed');expect(sends).toBe(0);
});
