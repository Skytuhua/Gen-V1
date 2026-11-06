import {test,expect} from '@playwright/test';
import {taskFixture,serveTaskFixture} from './task-interface-fixture';
import {createWorkspaceCanvas} from '../../packages/core/workspace-layout';
import type {HostCommand} from '../../packages/contracts';
import type {PluginManifest} from '../../packages/plugins/contracts';

test('failed handoffs have one dismissible shell presenter and keep drafts and commands guarded',async({page})=>{
 const message='The plug-in could not confirm saved state.';
 const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Synthetic handoff ownership'}}}});snapshot.artifacts=[];snapshot.userStates=[];snapshot.messages=[];snapshot.data=[];
 const fixture=await serveTaskFixture(page,snapshot),envelope={state:{version:1,revision:0,activeCanvasId:'main',canvases:[createWorkspaceCanvas('workspace','Workspace','main')],profiles:[],disabledKinds:[],integrations:{}},projects:[]};
 const workspaceCommands:HostCommand[]=[];
 await page.route('**/api/workspace',route=>route.fulfill({json:envelope}));
 await page.route('**/api/workspace/commands',route=>{workspaceCommands.push(route.request().postDataJSON());return route.fulfill({json:{result:envelope}});});
 await page.goto('/');const draft=page.getByRole('textbox',{name:'Message',exact:true});await expect(draft).toBeEnabled();await draft.fill('Keep this draft after a failed handoff');
 await page.evaluate(async message=>{const path='/src/editor-handoff.ts',module=await import(/* @vite-ignore */ path);(window as Window & {releaseSyntheticGuard?:()=>void}).releaseSyntheticGuard=module.registerEditorHandoff('synthetic-unsaved',async()=>{throw Error(message);});},message);
 await page.getByRole('button',{name:'New thread',exact:true}).click();const alerts=page.getByRole('alert').filter({hasText:message});await expect(alerts).toHaveCount(1);
 const custom=page.getByRole('button',{name:'Custom',exact:true});await custom.click();await expect(custom).toBeEnabled();await expect(alerts).toHaveCount(1);
 await expect(alerts.getByRole('button',{name:'Refresh',exact:true})).toBeVisible();await page.getByRole('button',{name:'Dismiss error',exact:true}).click();await expect(alerts).toHaveCount(0);
 await custom.click();await expect(custom).toBeEnabled();await expect(alerts).toHaveCount(1);await expect(draft).toHaveValue('Keep this draft after a failed handoff');
 expect(workspaceCommands).toHaveLength(0);expect(fixture.commands.filter(command=>command.type==='thread.create')).toHaveLength(0);
});

test('the shell error remains visible while a plug-in workspace owns the main surface',async({page})=>{
 const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Synthetic plug-in workspace error'}}}});snapshot.artifacts=[];snapshot.userStates=[];snapshot.messages=[];snapshot.data=[];
 const host=await serveTaskFixture(page,snapshot),envelope={state:{version:1,revision:0,activeCanvasId:'main',canvases:[createWorkspaceCanvas('workspace','Workspace','main')],profiles:[],disabledKinds:[],integrations:{}},projects:[]};
 const plugin:PluginManifest={id:'sample-visuals',name:'Sample visuals',version:'1.0.0',apiVersion:1,compatibleGenVersions:'>=0.6.5 <0.7.0',frontendEntry:'frontend/index.html',hostEntry:'host/index.mjs',workspaces:[{id:'studio',title:'Studio',entryView:'map',defaultLayout:'studio'}]};
 await page.route('**/api/workspace',route=>route.fulfill({json:envelope}));await page.route('**/api/plugins',route=>route.fulfill({json:{plugins:[plugin]}}));
 await page.route('**/plugins/*/frame?*',route=>{const url=new URL(route.request().url()),session=url.searchParams.get('session');return route.fulfill({contentType:'text/html',body:`<html><body>Scoped plug-in fixture<script>
 const channel=new MessageChannel();window.fixtureConnected=false;channel.port1.onmessage=event=>{if(event.data.type==='gen.plugin.connected'){window.fixtureConnected=true;channel.port1.postMessage({type:'gen.plugin.ready',pluginId:'sample-visuals',session:${JSON.stringify(session)}});}if(event.data.type==='gen.plugin.flush')channel.port1.postMessage({type:'gen.plugin.flushed',session:${JSON.stringify(session)},id:event.data.id,ok:true});};channel.port1.start();parent.postMessage({type:'gen.plugin.connect',pluginId:'sample-visuals',session:${JSON.stringify(session)}},'*',[channel.port2]);</script></body></html>`});});
 await page.goto('/');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Studio',exact:true}).click();
 const iframe=page.getByTitle('Studio',{exact:true});await expect(iframe).toBeVisible();const frame=await(await iframe.elementHandle())!.contentFrame();if(!frame)throw Error('Owned fixture frame missing');await frame.waitForFunction(()=>(window as Window & {fixtureConnected?:boolean}).fixtureConnected===true);
 await page.evaluate(async()=>{const path='/src/editor-handoff.ts',module=await import(/* @vite-ignore */ path);module.registerEditorHandoff('synthetic-private-save',async()=>{throw Error('Source edits must be confirmed before leaving.');});});
 await page.getByRole('button',{name:'New thread',exact:true}).click();const error=page.getByRole('alert').filter({hasText:'Source edits must be confirmed before leaving.'});await expect(error).toBeVisible();await expect(error).toHaveCount(1);await expect(iframe).toBeVisible();
 await error.getByRole('button',{name:'Dismiss error',exact:true}).click();await expect(error).toHaveCount(0);await expect(iframe).toBeVisible();expect(host.commands.filter(command=>command.type==='thread.create')).toHaveLength(0);
});
