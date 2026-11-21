import {test,expect,type Page} from '@playwright/test';

/** Synthetic host catalog: every option present on Windows with two WSL distributions. */
const WINDOWS_CATALOG={
 platform:'win32',
 options:[
  {kind:'default',label:'System default (Command Prompt)',availability:'available'},
  {kind:'cmd',label:'Command Prompt',availability:'available'},
  {kind:'pwsh',label:'PowerShell 7',availability:'available'},
  {kind:'powershell',label:'Windows PowerShell',availability:'available'},
  {kind:'git-bash',label:'Git Bash',availability:'available'},
  {kind:'wsl',label:'WSL',availability:'available'},
 ],
 wsl:{distributions:['Ubuntu','Debian'],availability:'available'},
};
const NON_WINDOWS_REASON='Windows shell selection requires a Windows host.';
const LINUX_CATALOG={
 platform:'linux',
 options:[
  {kind:'default',label:'System shell',availability:'available'},
  {kind:'cmd',label:'Command Prompt',availability:'unsupported',reason:NON_WINDOWS_REASON},
  {kind:'pwsh',label:'PowerShell 7',availability:'unsupported',reason:NON_WINDOWS_REASON},
  {kind:'powershell',label:'Windows PowerShell',availability:'unsupported',reason:NON_WINDOWS_REASON},
  {kind:'git-bash',label:'Git Bash',availability:'unsupported',reason:NON_WINDOWS_REASON},
  {kind:'wsl',label:'WSL',availability:'unsupported',reason:NON_WINDOWS_REASON},
 ],
 wsl:{distributions:[],availability:'unsupported',reason:'Windows Subsystem for Linux requires a Windows host.'},
};
const NON_WINDOWS_NOTICE='Windows shell selection is unavailable on this host; using the system shell.';

interface Selection {kind:string;distro?:string}
interface MutableCatalog{platform:string;options:{kind:string;label:string;availability:string;reason?:string}[];wsl:{distributions:string[];availability:string;reason?:string}}
const catalogWith = (patch:(catalog:MutableCatalog)=>void)=>{
 const catalog=JSON.parse(JSON.stringify(WINDOWS_CATALOG)) as MutableCatalog;
 patch(catalog);
 return catalog;
};

interface Harness {
 preferences:Record<string,unknown>;
 commands:{type:string;payload?:{preferences?:Record<string,unknown>}}[];
 opens:{terminalId:string;projectId:string;threadId?:string}[];
 terminalCommands:{type:string}[];
}
interface HarnessOptions {
 platform?:'win32'|'linux';
 preferences?:Record<string,unknown>;
 catalog?:unknown|(()=>unknown|Promise<unknown>);
 openFailures?:number;
 openError?:{code:string;message:string};
 commandFailures?:number;
}
const effectiveShell=(platform:string,preferences:Record<string,unknown>)=>{
 if(platform!=='win32')return{kind:'default',label:'System shell',notice:NON_WINDOWS_NOTICE};
 const selection=(preferences.terminalShell??{kind:'default'}) as Selection;
 switch(selection.kind){
  case'pwsh':return{kind:'pwsh',label:'PowerShell 7'};
  case'powershell':return{kind:'powershell',label:'Windows PowerShell'};
  case'git-bash':return{kind:'git-bash',label:'Git Bash'};
  case'wsl':return selection.distro?{kind:'wsl',label:`WSL (${selection.distro})`,distro:selection.distro}:{kind:'wsl',label:'WSL'};
  case'cmd':return{kind:'cmd',label:'Command Prompt'};
  default:return{kind:'cmd',label:'System default (Command Prompt)'};
 }
};
async function install(page:Page,options:HarnessOptions={}):Promise<Harness>{
 const platform=options.platform??'win32';
 const state={
  preferences:options.preferences??{terminalShell:{kind:'default'}},
  catalog:options.catalog??(platform==='win32'?WINDOWS_CATALOG:LINUX_CATALOG),
  openFailures:options.openFailures??0,
  openError:options.openError??{code:'TERMINAL_SHELL_UNAVAILABLE',message:'PowerShell 7 is not installed on this host. Choose a different shell in Settings.'},
  commandFailures:options.commandFailures??0,
  seq:0,
  commands:[] as Harness['commands'],
  opens:[] as Harness['opens'],
  terminalCommands:[] as Harness['terminalCommands'],
  shells:new Map<string,unknown>(),
 };
 await page.route('**/api/bootstrap',route=>route.fulfill({json:{csrfToken:'fixture-csrf'}}));
 await page.route('**/api/shell-settings',route=>route.fulfill({json:{theme:'dark',preferences:state.preferences}}));
 await page.route('**/api/models**',route=>route.fulfill({json:{models:[]}}));
 await page.route('**/api/terminal-shells**',async route=>{
  const value=typeof state.catalog==='function'?await state.catalog():state.catalog;
  const response=value as {status?:number;json?:unknown}|null;
  if(response&&typeof response==='object'&&'status' in response)return route.fulfill({status:response.status,json:response.json});
  return route.fulfill({json:value});
 });
 await page.route('**/api/commands',async route=>{
  const body=route.request().postDataJSON() as {id:string;type:string;payload?:{preferences?:Record<string,unknown>}};
  state.commands.push(body);
  if(body.type==='settings.update'){
   if(state.commandFailures>0){state.commandFailures--;return route.fulfill({status:400,json:{error:{code:'PREFERENCE_REJECTED',message:'Synthetic save rejection'}}});}
   Object.assign(state.preferences,body.payload?.preferences??{});
  }
  return route.fulfill({json:{commandId:body.id,result:{ok:true},eventSeq:++state.seq}});
 });
 await page.route('**/api/terminals',async route=>{
  if(route.request().method()!=='POST')return route.fallback();
  const body=route.request().postDataJSON() as {projectId:string;threadId?:string;terminalId:string};
  state.opens.push(body);
  if(state.openFailures>0){state.openFailures--;return route.fulfill({status:400,json:{error:state.openError}});}
  const shell=effectiveShell(platform,state.preferences);
  state.shells.set(body.terminalId,shell);
  return route.fulfill({json:{id:body.terminalId,projectId:body.projectId,threadId:body.threadId??null,output:'synthetic shell ready\r\n',start:0,cursor:25,exited:false,exitCode:null,shell}});
 });
 await page.route('**/api/terminals/**',async route=>{
  const request=route.request(),url=new URL(request.url()),tail=decodeURIComponent(url.pathname.slice('/api/terminals/'.length));
  if(tail.endsWith('/commands')&&request.method()==='POST'){
   const id=tail.slice(0,-'/commands'.length),body=request.postDataJSON() as {projectId:string;threadId?:string;type:string};
   state.terminalCommands.push(body);
   return route.fulfill({json:{id,projectId:body.projectId,threadId:body.threadId??null,output:'',start:0,cursor:25,exited:body.type==='stop',exitCode:body.type==='stop'?0:null,shell:state.shells.get(id)}});
  }
  if(request.method()==='GET'){
   return route.fulfill({json:{id:tail,projectId:url.searchParams.get('projectId'),threadId:url.searchParams.get('threadId'),output:'',start:0,cursor:25,exited:false,exitCode:null,shell:state.shells.get(tail)}});
  }
  return route.fallback();
 });
 return state as unknown as Harness;
}

const shellSelect=(page:Page)=>page.getByRole('combobox',{name:'Default terminal shell'});
const openTerminal=(page:Page)=>page.locator('.fixture-terminal[data-terminal="a"]');
const terminalLabel=(page:Page)=>openTerminal(page).locator('.panel-toolbar strong');
const pickOption=async(page:Page,label:string)=>{
 await shellSelect(page).click();
 await page.getByRole('option',{name:label,exact:true}).click();
};

test('loads the catalog and persists each shell choice, including WSL distributions',async({page})=>{
 const state=await install(page);
 await page.goto('/tests/e2e/fixtures/terminal-shell.html');
 await expect(shellSelect(page)).toBeVisible();
 await expect(shellSelect(page)).toContainText('System default (Command Prompt)');
 // Every catalog kind appears in the flat list; WSL expands per distribution.
 await shellSelect(page).click();
 for(const label of['System default (Command Prompt)','Command Prompt','PowerShell 7','Windows PowerShell','Git Bash','WSL · Default distribution','WSL · Ubuntu','WSL · Debian'])
  await expect(page.getByRole('option',{name:label,exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 for(const [label,expected] of[
  ['Command Prompt',{terminalShell:{kind:'cmd'}}],
  ['PowerShell 7',{terminalShell:{kind:'pwsh'}}],
  ['Windows PowerShell',{terminalShell:{kind:'powershell'}}],
  ['Git Bash',{terminalShell:{kind:'git-bash'}}],
  ['WSL · Default distribution',{terminalShell:{kind:'wsl'}}],
  ['WSL · Ubuntu',{terminalShell:{kind:'wsl',distro:'Ubuntu'}}],
 ]as const){
  const before=state.commands.length;
  await pickOption(page,label);
  await expect.poll(()=>state.commands.length).toBe(before+1);
  await expect(shellSelect(page)).toContainText(label);
  expect(state.commands.at(-1)?.payload?.preferences).toEqual(expected);
 }
});

test('keeps a missing saved shell visible with an explanation',async({page})=>{
 await install(page,{
  preferences:{terminalShell:{kind:'pwsh'}},
  catalog:catalogWith(catalog=>{
   const pwsh=catalog.options.find(option=>option.kind==='pwsh')!;
   pwsh.availability='missing';pwsh.reason='pwsh.exe was not found under Program Files or PATH.';
  }),
 });
 await page.goto('/tests/e2e/fixtures/terminal-shell.html');
 await expect(shellSelect(page)).toContainText('PowerShell 7 (not installed)');
 await expect(page.getByText('This shell is no longer available. Choose another shell.')).toBeVisible();
 // The disabled saved option keeps its reason; other options stay pickable.
 await shellSelect(page).click();
 await expect(page.getByRole('option',{name:/PowerShell 7 \(not installed\) — pwsh\.exe was not found/})).toBeDisabled();
 await page.getByRole('option',{name:'Command Prompt',exact:true}).click();
 await expect(shellSelect(page)).toContainText('Command Prompt');
});

test('shows a catalog error with Retry and recovers',async({page})=>{
 let calls=0;
 await install(page,{catalog:()=>++calls===1?{status:500,json:{error:{code:'SHELL_DISCOVERY_FAILED',message:'synthetic discovery failure'}}}:WINDOWS_CATALOG});
 await page.goto('/tests/e2e/fixtures/terminal-shell.html');
 await expect(page.getByRole('status').filter({hasText:'Could not check available shells.'})).toBeVisible();
 await page.getByRole('button',{name:'Retry'}).click();
 await expect(shellSelect(page)).toBeVisible();
 expect(calls).toBe(2);
});

test('keeps the draft when saving fails and retries the write',async({page})=>{
 const state=await install(page,{commandFailures:1});
 await page.goto('/tests/e2e/fixtures/terminal-shell.html');
 await expect(shellSelect(page)).toBeVisible();
 await pickOption(page,'PowerShell 7');
 await expect(page.getByRole('alert')).toContainText('The shell choice could not be saved.');
 // The draft survives the failed write; the saved preference is unchanged.
 await expect(shellSelect(page)).toContainText('PowerShell 7');
 expect(state.preferences.terminalShell).toEqual({kind:'default'});
 await page.getByRole('button',{name:'Retry'}).click();
 await expect.poll(()=>state.preferences.terminalShell).toEqual({kind:'pwsh'});
 await expect(page.getByRole('alert')).toHaveCount(0);
});

test('hides the row on non-Windows hosts and shows the system-shell notice',async({page})=>{
 await install(page,{platform:'linux',preferences:{terminalShell:{kind:'pwsh'}}});
 await page.goto('/tests/e2e/fixtures/terminal-shell.html');
 // The Windows-only picker is absent entirely; a preserved Windows selection still
 // reaches the terminal as the host's system shell with an explanatory notice.
 await expect(page.getByRole('heading',{name:'Default terminal shell'})).toHaveCount(0);
 await expect(terminalLabel(page)).toHaveText('System shell');
 await expect(openTerminal(page).getByRole('status').filter({hasText:NON_WINDOWS_NOTICE})).toBeVisible();
});

test('leaves a running terminal untouched when the preference changes',async({page})=>{
 const state=await install(page,{preferences:{terminalShell:{kind:'pwsh'}}});
 await page.goto('/tests/e2e/fixtures/terminal-shell.html');
 await expect(terminalLabel(page)).toHaveText('PowerShell 7');
 await expect(openTerminal(page).getByRole('status')).toContainText('Running');
 // Changing the saved shell never respawns or relabels the live terminal.
 await pickOption(page,'Git Bash');
 await expect.poll(()=>state.preferences.terminalShell).toEqual({kind:'git-bash'});
 await expect(terminalLabel(page)).toHaveText('PowerShell 7');
 expect(state.opens).toHaveLength(1);
 expect(state.opens[0].terminalId).toBe('terminal-a');
 // A second terminal opened afterwards picks up the new shell.
 await page.evaluate(()=>{(window as {terminalShellFixture?:{setSecondTerminal:(value:boolean)=>void}}).terminalShellFixture!.setSecondTerminal(true);});
 const second=page.locator('.fixture-terminal[data-terminal="b"]');
 await expect(second.locator('.panel-toolbar strong')).toHaveText('Git Bash');
 expect(state.opens).toHaveLength(2);
 expect(state.opens[1].terminalId).not.toBe('terminal-a');
 await expect(terminalLabel(page)).toHaveText('PowerShell 7');
});

test('retries a failed start with the same terminal ID after correcting the shell',async({page})=>{
 const state=await install(page,{preferences:{terminalShell:{kind:'pwsh'}},openFailures:1});
 await page.goto('/tests/e2e/fixtures/terminal-shell.html');
 await expect(openTerminal(page).getByRole('status')).toContainText('Start unconfirmed');
 await expect(openTerminal(page).getByRole('alert')).toContainText('PowerShell 7');
 // Correct the saved shell, then retry: the pending terminal ID is reused, not duplicated.
 await pickOption(page,'Command Prompt');
 await expect.poll(()=>state.preferences.terminalShell).toEqual({kind:'cmd'});
 await openTerminal(page).getByRole('button',{name:'Retry start'}).click();
 await expect(openTerminal(page).getByRole('status')).toContainText('Running');
 await expect(terminalLabel(page)).toHaveText('Command Prompt');
 expect(state.opens).toHaveLength(2);
 expect(state.opens[1].terminalId).toBe(state.opens[0].terminalId);
});

test('supports keyboard selection and restores focus to the trigger',async({page})=>{
 const state=await install(page);
 await page.goto('/tests/e2e/fixtures/terminal-shell.html');
 const select=shellSelect(page);
 await select.focus();
 await page.keyboard.press('ArrowDown');
 await expect(page.getByRole('listbox')).toBeVisible();
 await page.keyboard.press('ArrowDown');
 await page.keyboard.press('Enter');
 await expect.poll(()=>state.commands.length).toBe(1);
 await expect(select).toBeFocused();
 await expect(select).toContainText('Command Prompt');
});

test('discards a late catalog response after unmount',async({page})=>{
 let calls=0;
 await install(page,{catalog:()=>++calls===1?new Promise(()=>{}):WINDOWS_CATALOG});
 const errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/tests/e2e/fixtures/terminal-shell.html');
 await expect(page.getByRole('status').filter({hasText:'Checking available shells'})).toBeVisible();
 await page.evaluate(()=>{(window as {terminalShellFixture?:{setSettingsVisible:(value:boolean)=>void}}).terminalShellFixture!.setSettingsVisible(false);});
 await expect(page.getByRole('status').filter({hasText:'Checking available shells'})).toHaveCount(0);
 await page.evaluate(()=>{(window as {terminalShellFixture?:{setSettingsVisible:(value:boolean)=>void}}).terminalShellFixture!.setSettingsVisible(true);});
 await expect(shellSelect(page)).toBeVisible();
 expect(errors).toEqual([]);
 expect(calls).toBe(2);
});

test('restores the saved shell across a reload',async({page})=>{
 const state=await install(page);
 await page.goto('/tests/e2e/fixtures/terminal-shell.html');
 await pickOption(page,'PowerShell 7');
 await expect.poll(()=>state.preferences.terminalShell).toEqual({kind:'pwsh'});
 await page.reload();
 await expect(shellSelect(page)).toContainText('PowerShell 7');
});
