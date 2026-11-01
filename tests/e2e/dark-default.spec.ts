import {test,expect} from '@playwright/test';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';

test('the document paints dark before the application module starts',async({page})=>{
 await page.emulateMedia({colorScheme:'light'});await page.route('**/src/main.tsx',route=>route.abort());await page.goto('/');
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 expect(await page.locator('html').evaluate(node=>({background:getComputedStyle(node).backgroundColor,scheme:getComputedStyle(node).colorScheme}))).toEqual({background:'rgb(0, 0, 0)',scheme:'dark'});
});
test('the mounted shell stays dark while fresh settings are still loading on a light device',async({page})=>{
 const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'A source-bound task'}}}});snapshot.settings.theme='dark';await serveTaskFixture(page,snapshot);
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});await page.route('**/api/snapshot',async route=>{await gate;await route.fallback();});await page.emulateMedia({colorScheme:'light'});
 try{await page.goto('/',{waitUntil:'domcontentloaded'});await expect(page.getByRole('complementary',{name:'Thread navigation',exact:true})).toBeVisible();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');expect(await page.locator('body').evaluate(node=>getComputedStyle(node).backgroundColor)).toBe('rgb(0, 0, 0)');}finally{release();}
});
for(const theme of ['light','system']as const)test(`an existing ${theme} preference still controls the loaded application`,async({page})=>{
 const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Saved task'}}}});snapshot.settings.theme=theme;const host=await serveTaskFixture(page,snapshot);await page.emulateMedia({colorScheme:'light'});await page.goto('/');
 await expect(page.locator('.artifact')).toBeVisible();await expect(page.locator('html')).toHaveAttribute('data-theme','light');expect(await page.locator('html').evaluate(node=>getComputedStyle(node).colorScheme)).toBe('light');expect(host.commands.filter(command=>command.type==='settings.update')).toHaveLength(0);
});
