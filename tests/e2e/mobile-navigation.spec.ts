import {test,expect} from '@playwright/test';
import {taskFixture,serveTaskFixture} from './task-interface-fixture';
import {createWorkspaceCanvas} from '../../packages/core/workspace-layout';

test('mobile navigation backdrop remains clickable after a nested Settings dialog closes',async({page})=>{
 await page.setViewportSize({width:600,height:500});
 const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Synthetic mobile navigation'}}}});snapshot.artifacts=[];snapshot.userStates=[];snapshot.messages=[];snapshot.data=[];
 const host=await serveTaskFixture(page,snapshot),envelope={state:{version:1,revision:0,activeCanvasId:'main',canvases:[createWorkspaceCanvas('workspace','Workspace','main')],profiles:[],disabledKinds:[],integrations:{}},projects:[]};
 await page.route('**/api/workspace',route=>route.fulfill({json:envelope}));await page.goto('/');const draft=page.getByRole('textbox',{name:'Message',exact:true});await expect(draft).toBeEnabled();await draft.fill('Keep this mobile draft');
 const opener=page.getByRole('button',{name:'Open navigation',exact:true});await opener.click();const scrim=page.locator('.sidebar-scrim');await expect(scrim).toBeVisible();await expect(scrim).toHaveJSProperty('inert',false);
 await page.getByRole('button',{name:'Settings',exact:true}).click();const settings=page.getByRole('dialog',{name:'Settings',exact:true});await expect(settings).toBeVisible();await page.keyboard.press('Escape');await expect(settings).toHaveCount(0);await expect(scrim).toHaveJSProperty('inert',false);
 await scrim.click({position:{x:590,y:100}});await expect(scrim).toHaveCount(0);await expect(opener).toBeFocused();await expect(draft).toHaveValue('Keep this mobile draft');
 expect(host.commands.filter(command=>command.type==='thread.create'||command.type==='message.send')).toHaveLength(0);
});
