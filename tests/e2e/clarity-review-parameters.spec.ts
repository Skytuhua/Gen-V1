import {test,expect,type Page} from '@playwright/test';
async function chooseField(page:Page,name:string,label:string){await page.getByRole('combobox',{name,exact:true}).click();await page.getByRole('option',{name:label,exact:true}).click();}
import {taskFixture,serveTaskFixture} from './task-interface-fixture';

const review={title:'Review the release notes',items:[
 {id:'compatibility',label:'Compatibility',evidence:[{label:'Proposed text',value:'Existing callers keep the items argument.'}]},
 {id:'empty',label:'Empty baskets',evidence:[{label:'Proposed text',value:'An empty basket returns zero.'}]},
]};
const parameters={title:'Export options',controls:[{id:'width',label:'Width',type:'number',value:1600,min:320,max:4096},{id:'format',label:'Format',type:'choice',value:'png',options:[{value:'png',label:'PNG'},{value:'webp',label:'WebP'}]}]};
const records={title:'Adjust the delivery list',columns:[{id:'quantity',label:'Quantity',type:'number',min:1,max:20},{id:'owner',label:'Owner',type:'choice',options:[{value:'ada',label:'Ada'},{value:'lee',label:'Lee'}]}],rows:[{id:'prints',label:'Prints',values:{quantity:4,owner:'ada'}}]};
const inputs={ReviewQueue:review,ParameterControls:parameters,EditableTable:records};
async function open(page:Page,type:keyof typeof inputs,theme:'light'|'dark'='light'){
 const snapshot=taskFixture({root:'task',elements:{task:{type,props:{dataBinding:'data',stateKey:'draft',actionId:'ask',actionLabel:type==='ReviewQueue'?'Send review':type==='ParameterControls'?'Review export':'Review changes'}}}},{data:inputs[type]});
 snapshot.settings.theme=theme; snapshot.artifacts[0].title=inputs[type].title;
 const host=await serveTaskFixture(page,snapshot);await page.goto('/');await expect(page.locator('.interaction-tools')).toBeVisible();return host;
}

test('a review names the current item and the remaining work before sending',async({page})=>{
 await open(page,'ReviewQueue');
 await expect(page.locator('.review-item-position')).toHaveText('Item 1 of 2');
 const guidance=page.locator('.interaction-footer .interaction-note');
 await expect(guidance).toHaveText('Decide on 2 more items.');
 await page.getByRole('radio',{name:'Accept',exact:true}).check();
 await expect(guidance).toHaveText('Decide on 1 more item.');
 await page.getByRole('button',{name:'Next item',exact:true}).click();
 await page.getByRole('radio',{name:'Request changes',exact:true}).check();
 await expect(guidance).toHaveText('Explain the requested changes before sending.');
 await page.getByRole('textbox',{name:'Review comment',exact:true}).fill('Mention the returned number explicitly.');
 await expect(guidance).toHaveText('Ready to send 2 decisions.');
});

for(const theme of ['light','dark'] as const)test(`${theme} review choices show a visible neutral radio and retain keyboard selection`,async({page})=>{
 await open(page,'ReviewQueue',theme);
 const radio=page.getByRole('radio',{name:'Accept',exact:true});await radio.focus();await page.keyboard.press('Space');await expect(radio).toBeChecked();
 const rendered=await radio.evaluate(node=>({width:node.getBoundingClientRect().width,opacity:getComputedStyle(node).opacity,accent:getComputedStyle(node).accentColor}));
 expect(rendered.width).toBeGreaterThanOrEqual(14);expect(Number(rendered.opacity)).toBe(1);
 const rgb=rendered.accent.match(/[\d.]+/g)!.slice(0,3).map(Number);expect(Math.max(...rgb)-Math.min(...rgb)).toBeLessThanOrEqual(2);
});

test('an adjustment labels the current and proposed values without changing the source',async({page})=>{
 const host=await open(page,'ParameterControls');
 await page.getByRole('spinbutton',{name:'Width',exact:true}).fill('1920');
 const proposal=page.getByRole('region',{name:'Changes to apply',exact:true});
 await expect(proposal.getByText('Current',{exact:true})).toBeVisible();
 await expect(proposal.getByText('Proposed',{exact:true})).toBeVisible();
 await expect(proposal).toContainText('1600');await expect(proposal).toContainText('1920');
 await page.getByRole('button',{name:'Reset Width',exact:true}).click();await expect(proposal).toHaveCount(0);
 await chooseField(page,'Format','WebP');
 await expect(proposal).toContainText('PNG');await expect(proposal).toContainText('WebP');
 await expect.poll(()=>host.snapshot.userStates[0].values.draft).toMatchObject({values:{format:'webp'}});
 await page.reload();await expect(proposal).toContainText('WebP');expect(host.snapshot.data[0].value).toEqual(parameters);
});

test('record edits show the source value and clear the changed state when restored',async({page})=>{
 const host=await open(page,'EditableTable');
 const quantity=page.getByRole('spinbutton',{name:'Prints · Quantity',exact:true});await quantity.fill('6');
 await expect(page.locator('.editable-original')).toHaveText('Was 4');
 await expect(page.locator('td.is-edited')).toHaveCount(1);
 await expect.poll(()=>host.snapshot.userStates[0].values.draft).toMatchObject({edits:{prints:{quantity:'6'}}});
 await page.reload();await expect(page.locator('.editable-original')).toHaveText('Was 4');
 await quantity.fill('4');await expect(page.locator('td.is-edited')).toHaveCount(0);await expect(page.locator('.editable-original')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Review changes',exact:true})).toBeDisabled();
 await chooseField(page,'Prints · Owner','Lee');await expect(page.locator('.editable-original')).toHaveText('Was Ada');
 expect(host.commands.some(command=>command.type==='action.submit')).toBe(false);
});

test('clarified decisions and before-after values stay legible at narrow reduced-motion width',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await open(page,'ParameterControls');
 await page.getByRole('spinbutton',{name:'Width',exact:true}).fill('1920');
 await expect(page.getByText('Current',{exact:true})).toBeVisible();await expect(page.getByText('Proposed',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 const nested=await page.locator('.interaction-tools').evaluate(node=>[...node.querySelectorAll('*')].filter(child=>['auto','scroll'].includes(getComputedStyle(child).overflowY)&&child.scrollHeight>child.clientHeight+1).length);
 expect(nested).toBe(0);
});
