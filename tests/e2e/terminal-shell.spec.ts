import {test,expect,type Page,type Route} from '@playwright/test';
import type {TerminalShellFixture} from './fixtures/terminal-shell';

declare global{interface Window{terminalShellFixture:TerminalShellFixture}}
type Read={id:string;projectId:string;threadId?:string;output:string;start:number;cursor:number;exited:boolean;exitCode:number|null;shell?:{kind:string;label:string;distro?:string}};
type RequestRecord={path:string;method:string;body:Record<string,unknown>|null};
const catalog={platform:'win32',options:[
 {kind:'default',label:'System default (Command Prompt)',availability:'available'},
 {kind:'cmd',label:'Command Prompt',availability:'available'},
 {kind:'pwsh',label:'PowerShell 7',availability:'missing',reason:'PowerShell 7 was not found.'},
 {kind:'powershell',label:'Windows PowerShell',availability:'available'},
 {kind:'git-bash',label:'Git Bash',availability:'available'},
 {kind:'wsl',label:'WSL',availability:'available'}],
 wsl:{availability:'available',distributions:['Ubuntu','Debian']}};
const result=(id='terminal-a',extra:Partial<Read>={}):Read=>({id,projectId:'project-a',threadId:'thread-a',output:'ready\r\n',start:0,cursor:6,exited:false,exitCode:null,...extra});
const json=(route:Route,body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
async function mount(page:Page,options:{catalog?:unknown;create?:(route:Route,body:Record<string,unknown>,index:number)=>Promise<void>}={}){
 const requests:RequestRecord[]=[];let creates=0;const errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!=='http://127.0.0.1:5818'){await route.abort();return;}
  if(!url.pathname.startsWith('/api/')){await route.continue();return;}
  const body=request.method()==='POST'?request.postDataJSON() as Record<string,unknown>:null;
  requests.push({path:url.pathname+url.search,method:request.method(),body});
  if(url.pathname==='/api/bootstrap'){await json(route,{csrfToken:'synthetic-csrf'});return;}
  if(url.pathname==='/api/terminal-shells'){await json(route,options.catalog??catalog);return;}
  if(url.pathname==='/api/terminals'&&body){creates++;if(options.create)await options.create(route,body,creates);else await json(route,result(String(body.terminalId)));return;}
  if(/^\/api\/terminals\/[^/]+$/.test(url.pathname)&&request.method()==='GET'){await json(route,result(url.pathname.split('/').at(-1)!,{output:'',start:Number(url.searchParams.get('cursor')),cursor:Number(url.searchParams.get('cursor'))}));return;}
  if(/^\/api\/terminals\/[^/]+\/commands$/.test(url.pathname)&&body){await json(route,result(url.pathname.split('/').at(-2)!,{exited:body.type==='stop'}));return;}
  await route.abort();
 });
 await page.goto('/tests/e2e/fixtures/terminal-shell.html');
 await expect(page.locator('.xterm')).toHaveCount(1);
 return {requests,creates:()=>requests.filter(item=>item.path==='/api/terminals'),errors};
}

test('shell picker lists catalog options, disables unavailable shells, and saves the selection',async({page})=>{
 await mount(page);
 const picker=page.getByRole('combobox',{name:'Terminal shell'});
 await expect(picker).toBeVisible();
 await picker.click();
 await expect(page.getByRole('option',{name:'PowerShell 7'})).toBeDisabled();
 await page.getByRole('option',{name:'Git Bash'}).click();
 await expect.poll(()=>page.evaluate(()=>window.terminalShellFixture.saves.map(value=>JSON.stringify(value)))).toEqual(['{"kind":"git-bash"}']);
 // A failed save keeps the draft selection visible and retryable.
 await page.evaluate(()=>window.terminalShellFixture.saveResult(false));
 await picker.click();await page.getByRole('option',{name:'Windows PowerShell'}).click();
 await expect(page.getByRole('alert')).toContainText('could not be saved');
 await expect(picker).toHaveText(/Windows PowerShell/);
});
test('wsl selection exposes the distribution picker including a retained missing distro',async({page})=>{
 await mount(page);
 await page.getByRole('combobox',{name:'Terminal shell'}).click();
 await page.getByRole('option',{name:'WSL'}).click();
 await expect.poll(()=>page.evaluate(()=>window.terminalShellFixture.saves.length)).toBe(1);
 const distro=page.getByRole('combobox',{name:'WSL distribution'});
 await expect(distro).toBeVisible();
 await distro.click();
 await expect(page.getByRole('option',{name:'Ubuntu'})).toBeVisible();
 await expect(page.getByRole('option',{name:'Debian'})).toBeVisible();
 await page.getByRole('option',{name:'Ubuntu'}).click();
 await expect.poll(()=>page.evaluate(()=>window.terminalShellFixture.saves.at(-1)?.kind)).toBe('wsl');
 expect(await page.evaluate(()=>window.terminalShellFixture.saves.at(-1))).toEqual({kind:'wsl',distro:'Ubuntu'});
});
test('toolbar shows the actual shell label from the host response',async({page})=>{
 await mount(page,{create:async route=>{await json(route,result('terminal-a',{shell:{kind:'pwsh',label:'PowerShell 7'}}));}});
 await expect(page.locator('.live-terminal .panel-toolbar')).toContainText('PowerShell 7');
});
test('unconfirmed start retry reuses the pending terminal ID',async({page})=>{
 let first=true;
 const api=await mount(page,{create:async(route,body)=>{
  if(first){first=false;await json(route,{error:{code:'HTTP_ERROR',message:'Synthetic create failure'}},503);return;}
  await json(route,result(String(body.terminalId),{shell:{kind:'git-bash',label:'Git Bash'}}));
 }});
 const retry=page.getByRole('button',{name:'Retry start'});await expect(retry).toBeVisible();
 const firstId=api.creates()[0]?.body?.terminalId;
 await retry.click();
 await expect(page.locator('.live-terminal .panel-toolbar')).toContainText('Running');
 expect(api.creates()).toHaveLength(2);
 expect(api.creates()[1]?.body?.terminalId).toBe(firstId);
});
