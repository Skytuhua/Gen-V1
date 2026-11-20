
async function checkSinglePanelOpener(page:Page,draft:string){
 const composer=page.getByRole('textbox',{name:'Message',exact:true});await composer.fill(draft);
 await expect(composer).toHaveCount(1);const retained=await composer.elementHandle();
 const opener=page.getByRole('button',{name:'Open workspace panel',exact:true});await expect(opener).toHaveCount(1);await opener.click();
 const panel=page.getByRole('complementary',{name:'Workspace panel',exact:true});await expect(panel).toBeVisible();
 const close=page.getByRole('button',{name:'Hide workspace panel',exact:true});await expect(close).toHaveCount(1);await close.click();await expect(panel).toBeHidden();
 await expect(opener).toBeFocused();await expect(composer).toHaveValue(draft);await expect(composer).toHaveCount(1);
 expect(await retained!.evaluate(element=>element.isConnected&&element===document.querySelector('textarea[aria-label="Message"]'))).toBe(true);
}

test('M15 panel opener: an ordinary new conversation has one reachable workspace control',async({page})=>{
 const snapshot=fixture();snapshot.activeThreadId=null;snapshot.threads=[];snapshot.messages=[];snapshot.artifacts=[];snapshot.userStates=[];snapshot.data=[];snapshot.usage={};
 const host=await serveTaskFixture(page,snapshot);await serveTaskSplitLayout(page,snapshot);await page.goto('/');
 await checkSinglePanelOpener(page,'Retain the ordinary new-conversation draft');
 expect(host.commands.filter(command=>['message.send','thread.create','run.stop','run.resume'].includes(command.type))).toEqual([]);
});

test('M15 panel opener: a pinned native thread retains its workspace control',async({page})=>{
 // Scripted native bridge with real App; this does not launch an installed desktop.
 await bridge(page,{kind:'thread',threadId:'task-thread'});const host=await serveTaskFixture(page,fixture());await page.goto('/');
 await checkSinglePanelOpener(page,'Retain the pinned native-thread draft');await expect(page.locator('.workspace-controls')).toHaveCount(0);
 expect(host.commands.filter(command=>['message.send','thread.create','run.stop','run.resume'].includes(command.type))).toEqual([]);
 expect(await page.evaluate(()=>(window as {__desktopCalls?:unknown[]}).__desktopCalls)).toEqual([]);
});
