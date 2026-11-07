import {test,expect} from '@playwright/test';
import {taskFixture,serveTaskFixture} from './task-interface-fixture.ts';
const p={id:'project-a',name:'Alpha',authority:{kind:'local'},rootPath:'C:/Synthetic/Alpha',createdAt:'2026-01-01T00:00:00.000Z'};
async function host(page,empty=false){
  const s=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Synthetic project flow'}}}});
  s.artifacts=[];s.data=[];s.messages=[];s.userStates=[];
  s.threads[0].projectId=p.id;s.threads[0].projectName=p.name;
  if(empty){s.threads=[];s.activeThreadId=null;}
  const h=await serveTaskFixture(page,s);
  const workspace={state:{version:1,revision:1,activeCanvasId:'main',canvases:[{id:'main',version:1,name:'Workspace',preset:'workspace',viewport:{x:0,y:0,zoom:1},panels:[],filter:'all',projectIds:[]}],disabledKinds:[],integrations:{},profiles:[]},projects:[p,{...p,id:'project-b',name:'Beta',rootPath:'C:/Synthetic/Beta'}]};
  await page.route('**/api/workspace',r=>r.fulfill({json:workspace}));
  await page.route('**/api/workspace/commands',r=>{h.commands.push(r.request().postDataJSON());return r.fulfill({json:{result:workspace}});});
  await page.route('**/api/commands',async r=>{const c=r.request().postDataJSON();h.commands.push(c);let result={};
    if(c.type==='thread.create'){result={id:'created-'+h.commands.length,title:'New thread',status:'ready',epoch:0,runId:null,modelId:null,sessionPath:null,createdAt:p.createdAt,updatedAt:p.createdAt,...(c.payload.projectId?{projectId:c.payload.projectId,projectName:p.name}:{})};s.threads.push(result);}
    if(c.type==='settings.update')s.settings.preferences={...s.settings.preferences,...c.payload.preferences};
    s.seq++;return r.fulfill({json:{commandId:c.id,seq:s.seq,result}});
  });
  await page.goto('/');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeVisible({timeout:15000});return h;
}
test('actual App New thread and shortcut open selection before create, cancel preserves source draft',async({page})=>{
 const h=await host(page);const draft=page.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep existing source draft');
 await page.getByRole('button',{name:'New thread',exact:true}).click();await expect(page.getByRole('dialog',{name:'Select project'})).toBeVisible();
 expect(h.commands.filter(c=>c.type==='thread.create')).toHaveLength(0);await page.keyboard.press('Escape');await expect(draft).toHaveValue('Keep existing source draft');
 await page.keyboard.press('Control+Shift+O');await expect(page.getByRole('dialog',{name:'Select project'})).toBeVisible();await page.keyboard.press('Escape');
 expect(h.commands.filter(c=>c.type==='thread.create')).toHaveLength(0);
});
test('actual App creates with canonical selected project and retains the source conversation',async({page})=>{
 const h=await host(page);await page.getByRole('textbox',{name:'Message',exact:true}).fill('Original source');
 await page.getByRole('button',{name:'New thread',exact:true}).click();await page.getByRole('option',{name:'Alpha',exact:true}).click();
 await expect.poll(()=>h.commands.find(c=>c.type==='thread.create')?.payload).toEqual({projectId:'project-a'});
 expect(h.snapshot.threads[0].sessionPath).toBe('fixture');expect(h.snapshot.threads[0].projectId).toBe('project-a');
 await expect(page.getByRole('dialog',{name:'Select project'})).toHaveCount(0);
});
test('actual App empty composer project cancellation and Add project never create orphan threads',async({page})=>{
 const h=await host(page,true);const draft=page.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Unowned draft stays safe');
 await page.getByRole('button',{name:'Select project',exact:true}).click();await expect(page.getByRole('dialog',{name:'Select project'})).toBeVisible();
 await page.keyboard.press('Escape');expect(h.commands.filter(c=>c.type==='thread.create')).toHaveLength(0);await expect(draft).toHaveValue('Unowned draft stays safe');
 await page.getByRole('button',{name:'New thread',exact:true}).click();await page.getByRole('button',{name:'Add project',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Connect project',exact:true})).toBeVisible();expect(h.commands.filter(c=>c.type==='thread.create')).toHaveLength(0);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('dialog',{name:'Select project'})).toBeVisible();
});
test('actual App chosen project migrates a new-composer draft only after confirmation',async({page})=>{
 const h=await host(page,true);await page.getByRole('textbox',{name:'Message',exact:true}).fill('Transfer after confirmation');
 await page.getByRole('button',{name:'Select project',exact:true}).click();await page.getByRole('option',{name:'Alpha',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Select project'})).toHaveCount(0);await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Transfer after confirmation');
 expect(h.commands.filter(c=>c.type==='thread.create')).toHaveLength(1);
});

test('actual App started conversation keeps its owner and draft when another project creates a new chat',async({page})=>{
 const h=await host(page);await page.getByRole('textbox',{name:'Message',exact:true}).fill('Keep this started draft');
 await page.getByRole('button',{name:'Select project',exact:true}).click();await page.getByRole('option',{name:'Beta',exact:true}).click();
 await expect.poll(()=>h.commands.find(c=>c.type==='thread.create')?.payload).toEqual({projectId:'project-b'});
 expect(h.snapshot.threads[0].projectId).toBe('project-a');expect(h.snapshot.threads[0].sessionPath).toBe('fixture');
 expect(h.commands.filter(c=>c.type==='workspace.project.connect')).toHaveLength(0);
 await page.getByRole('button',{name:/Source-bound task fixture/}).first().click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Keep this started draft');
});
test('actual App Add project submits the existing connection command without a premature thread',async({page})=>{
 const h=await host(page,true);await page.getByRole('button',{name:'New thread',exact:true}).click();await page.getByRole('button',{name:'Add project',exact:true}).click();
 await page.getByLabel('Project name',{exact:true}).fill('Gamma');await page.getByLabel('Local folder',{exact:true}).fill('C:/Synthetic/Gamma');
 await page.getByRole('button',{name:'Connect project',exact:true}).click();
 await expect.poll(()=>h.commands.find(c=>c.type==='workspace.project.connect')?.payload).toEqual({name:'Gamma',path:'C:/Synthetic/Gamma',baseRevision:1});
 expect(h.commands.filter(c=>c.type==='thread.create')).toHaveLength(0);await expect(page.getByRole('dialog',{name:'Select project'})).toBeVisible();
});

test('actual App No project creates an unbound personal thread explicitly',async({page})=>{
 const h=await host(page);await page.getByRole('button',{name:'New thread',exact:true}).click();await page.getByRole('option',{name:'No project',exact:true}).click();
 await expect.poll(()=>h.commands.find(c=>c.type==='thread.create')?.payload).toEqual({});
 expect(h.snapshot.threads.at(-1).projectId).toBeUndefined();
});
test('actual App color save merges current profile overrides and sends validated preferences',async({page})=>{
 const h=await host(page);h.snapshot.settings.preferences={projectColors:{'["local","other"]':'#4F6EFF'}};await h.publish();
 await page.getByRole('button',{name:'Select project',exact:true}).click();await page.getByRole('button',{name:'Color for Alpha'}).click();
 await page.getByRole('textbox',{name:'Custom color'}).fill('#123abc');await page.getByRole('button',{name:'Save color',exact:true}).click();
 await expect.poll(()=>h.commands.find(c=>c.type==='settings.update')?.payload).toEqual({preferences:{projectColors:{'["local","other"]':'#4F6EFF','["local","project-a"]':'#123abc'}}});
 expect(h.commands.filter(c=>c.type==='thread.create')).toHaveLength(0);
});


test('blocking project connection reserves the native caption at short height',async({page})=>{
 await host(page,true);await page.setViewportSize({width:800,height:260});
 await page.evaluate(()=>document.documentElement.dataset.nativeTitlebar='true');
 await page.getByRole('button',{name:'New thread',exact:true}).click();await page.getByRole('button',{name:'Add project',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Connect project',exact:true});await expect(dialog).toBeVisible();
 const samples=await dialog.evaluate(async node=>{const rows=[],end=performance.now()+260;do{const r=node.getBoundingClientRect();rows.push({top:r.top,bottom:r.bottom,left:r.left,right:r.right});await new Promise(requestAnimationFrame);}while(performance.now()<end);return rows;});
 expect(samples.every(row=>row.top>=49.5&&row.bottom<=252.5&&row.left>=7.5&&row.right<=792.5)).toBe(true);
 expect(await dialog.evaluate(node=>node.contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Select project'})).toBeVisible();
});
