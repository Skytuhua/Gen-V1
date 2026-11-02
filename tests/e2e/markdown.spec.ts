import {test,expect,type Page} from '@playwright/test';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {taskFixture,serveTaskFixture} from './task-interface-fixture';

// Retained historical model-output text, without its private session snapshot.
const actualTraceTable=readFileSync(resolve('tests/fixtures/pi-trace-table.md'),'utf8');
const evidence=resolve('.harness-markdown-evidence');
const spec=(text:string)=>({root:'document',elements:{document:{type:'Markdown',props:{text}}}});
async function documentFixture(page:Page,text:string){const snapshot=taskFixture(spec(text));await serveTaskFixture(page,snapshot);await page.goto('/');const markdown=page.locator('[data-artifact-id="task-surface"] .markdown');await expect(markdown).toBeVisible();return markdown;}

test('renders the genuine Pi trace table with semantic headers and numeric alignment',async({page})=>{
 const markdown=await documentFixture(page,actualTraceTable),table=markdown.getByRole('table');
 await expect(table).toBeVisible();await expect(table.getByRole('columnheader')).toHaveText(['Span','Parent','Interval','Duration','Result']);
 await expect(table.getByRole('row')).toHaveCount(8);await expect(table.getByRole('row').nth(1).getByRole('cell')).toHaveText(['Checkout','—','0–620','620','HTTP 503']);
 await expect(table.getByRole('columnheader',{name:'Duration',exact:true})).toHaveCSS('text-align','right');
 await expect(table.getByRole('cell',{name:'620',exact:true})).toHaveCSS('text-align','right');
 await expect(markdown).not.toContainText('|---');await expect(markdown).toContainText('parent and child durations overlap');
});

test('keeps literal pipes and fenced tables literal while recognizing escaped and code-span pipes',async({page})=>{
 const markdown=await documentFixture(page,String.raw`Plain input | output stays prose.

Bad | separator
-- | no

\`\`\`text
| Not | a table |
| --- | --- |
| inside | code |
\`\`\`

| Expression | Label |
| :--- | ---: |
| \`a | b\` | left\|right |
| literal\|pipe | 2 |`.replaceAll('\\`','`'));
 await expect(markdown.getByRole('table')).toHaveCount(1);
 await expect(markdown.getByRole('table').getByRole('cell')).toHaveText(['a | b','left|right','literal|pipe','2']);
 await expect(markdown.locator('pre code')).toContainText('| Not | a table |');
 await expect(markdown).toContainText('Plain input | output stays prose.');await expect(markdown).toContainText('Bad | separator');
 await expect(markdown.getByRole('columnheader').nth(0)).toHaveCSS('text-align','left');await expect(markdown.getByRole('columnheader').nth(1)).toHaveCSS('text-align','right');
});

test('retains heading, inline, nested list and non-default ordered-list semantics',async({page})=>{
 const markdown=await documentFixture(page,'# Diagnosis\nThe **retry** in `payment.ts` is early. [Source](https://example.com/source)\n\n- Keep the receipt\n  - Preserve its identity\n- Cancel safely\n\n3. Inspect the deadline\n4. Compare the retry\n\n```ts\nconst markup = "<script>";\n```');
 await expect(markdown.getByRole('heading',{name:'Diagnosis',exact:true})).toBeVisible();await expect(markdown.locator('strong')).toHaveText('retry');await expect(markdown.getByRole('link',{name:'Source',exact:true})).toHaveAttribute('href','https://example.com/source');
 await expect(markdown.locator('ol')).toHaveAttribute('start','3');await expect(markdown.locator('ol>li')).toHaveText(['Inspect the deadline','Compare the retry']);
 await expect(markdown.locator('ul>li>ul>li')).toHaveText('Preserve its identity');await expect(markdown.locator('pre code')).toHaveText('const markup = "<script>";');
});

test('renders hostile HTML and javascript links as inert text inside tables',async({page})=>{
 const markdown=await documentFixture(page,'| Input | Link |\n| --- | --- |\n| <img src=x onerror="globalThis.markdownExecuted=true"> | [Bad](javascript:alert(1)) |\n| <script>globalThis.markdownExecuted=true</script> | [Good](https://example.com) |');
 await expect(markdown.getByRole('table')).toBeVisible();await expect(markdown.locator('img,script,iframe')).toHaveCount(0);await expect(markdown.getByRole('link')).toHaveCount(1);await expect(markdown.getByRole('link')).toHaveAttribute('href','https://example.com');
 expect(await page.evaluate(()=>(globalThis as unknown as {markdownExecuted?:boolean}).markdownExecuted)).toBeUndefined();await expect(markdown).toContainText('<img src=x');await expect(markdown).toContainText('[Bad](javascript:alert(1))');
});

test('preserves every supplied value when a table row has extra columns',async({page})=>{
 const markdown=await documentFixture(page,'| Name | Value |\n| --- | --- |\n| first | 1 |\n| second | 2 | EXTRA_EVIDENCE |\n\nAfter the table.');
 await expect(markdown.getByRole('table')).toBeVisible();await expect(markdown).toContainText('EXTRA_EVIDENCE');await expect(markdown).toContainText('After the table.');
});

for(const budget of [{name:'columns',columns:150,rows:150},{name:'derived cells',columns:24,rows:180},{name:'rows',columns:2,rows:250}])test(`falls back without dropping content when ${budget.name} exceed the table budget`,async({page})=>{
 const header='| '+Array.from({length:budget.columns},(_,index)=>'Field'+index).join(' | ')+' |';
 const separator='| '+Array(budget.columns).fill('---').join(' | ')+' |';
 const text=[header,separator,...Array(budget.rows-1).fill('| x |'),'| TAIL_EVIDENCE |'].join('\n');
 const markdown=await documentFixture(page,text);
 await expect(markdown.getByRole('table')).toHaveCount(0);
 await expect(markdown).toContainText('Field'+(budget.columns-1));await expect(markdown).toContainText('TAIL_EVIDENCE');
 expect(await markdown.locator('*').count()).toBeLessThan(100);
});

test('shares the derived-cell budget across separate ragged tables without losing their source',async({page})=>{
 const header='| '+Array.from({length:24},(_,index)=>'Field'+index).join(' | ')+' |';
 const separator='| '+Array(24).fill('---').join(' | ')+' |';
 const tables=Array.from({length:20},(_,index)=>[header,separator,...Array(168).fill('| x |'),`| TABLE_${index}_TAIL |`].join('\n'));
 const markdown=await documentFixture(page,tables.join('\n\n'));
 expect(await markdown.locator('th,td').count()).toBeLessThanOrEqual(4096);
 await expect(markdown.getByRole('table')).toHaveCount(1);
 await expect(markdown.locator('.markdown-table-fallback')).toHaveCount(19);
 for(let index=0;index<20;index++)await expect(markdown).toContainText(`TABLE_${index}_TAIL`);
 expect(await markdown.locator('*').count()).toBeLessThan(9000);
});

test('new prose before and after a table never paints a veil over its cells',async({page})=>{
 const table='\n\n| Name | Value |\n| --- | --- |\n| Payment | 620 |\n\n';
 const snapshot=taskFixture(spec('Retained artifact.'));snapshot.threads[0].status='working';snapshot.threads[0].runId='stream-fixture';snapshot.messages[0].runId='stream-fixture';snapshot.messages[0].content='Old prose.'+table+'Old conclusion.';
 const fixture=await serveTaskFixture(page,snapshot);await page.goto('/');const prose=page.locator('.message-assistant>.message-content .markdown');await expect(prose.getByRole('table')).toBeVisible();
 await prose.evaluate(root=>{
  const probe={peakVeils:0,overlaps:0};(root as HTMLElement&{probe?:typeof probe}).probe=probe;
  new MutationObserver(()=>{const bounds=root.querySelector('table')!.getBoundingClientRect(),veils=[...root.querySelectorAll('.sentence-reveal-veil')];probe.peakVeils=Math.max(probe.peakVeils,veils.length);probe.overlaps=Math.max(probe.overlaps,veils.filter(node=>{const rect=node.getBoundingClientRect();return rect.left<bounds.right&&rect.right>bounds.left&&rect.top<bounds.bottom&&rect.bottom>bounds.top;}).length);}).observe(root,{subtree:true,childList:true,attributes:true});
 });
 snapshot.messages[0].content='New before prose.'+table+'New after prose.';await fixture.publish();await expect(prose).toContainText('New before prose.');
 await expect.poll(()=>prose.evaluate(root=>(root as HTMLElement&{probe:{peakVeils:number}}).probe.peakVeils)).toBeGreaterThan(0);
 expect(await prose.evaluate(root=>(root as HTMLElement&{probe:{overlaps:number}}).probe.overlaps)).toBe(0);
});

test('streamed tables stay unmasked while prose updates retain sentence reveal',async({page})=>{
 const snapshot=taskFixture(spec('Retained artifact.'));snapshot.threads[0].status='working';snapshot.threads[0].runId='stream-fixture';snapshot.messages[0].runId='stream-fixture';snapshot.messages[0].content='The request is slow.';
 const fixture=await serveTaskFixture(page,snapshot);await page.goto('/');const prose=page.locator('.message-assistant>.message-content .markdown');await expect(prose).toHaveText('The request is slow.');
 snapshot.messages[0].content+='\n\n| Span | Duration |\n| --- | ---: |\n| Payment | 620 |\n\nChoose the next check.';await fixture.publish();await expect(prose.getByRole('table')).toBeVisible();
 const masked=await prose.evaluate(root=>{const table=root.querySelector('table')!.getBoundingClientRect();return [...root.querySelectorAll('.sentence-reveal-veil')].filter(node=>{const r=node.getBoundingClientRect();return r.left<table.right&&r.right>table.left&&r.top<table.bottom&&r.bottom>table.top;}).length;});expect(masked).toBe(0);
 await prose.locator('p').first().evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
 const selected=await page.evaluate(()=>getSelection()!.toString());snapshot.messages[0].content+=' A final useful detail.';await fixture.publish();await expect(prose).toContainText('A final useful detail.');expect(await page.evaluate(()=>getSelection()!.toString())).toBe(selected);
 await prose.getByRole('cell',{name:'Payment',exact:true}).evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));});snapshot.messages[0].content+=' Another detail.';await fixture.publish();await expect(prose).toContainText('Another detail.');expect(await page.evaluate(()=>getSelection()!.toString())).toBe('Payment');
 await expect(prose.getByRole('cell',{name:'620',exact:true})).toBeVisible();snapshot.messages[0].content=snapshot.messages[0].content.replace('620','640');await fixture.publish();await expect(prose.getByRole('cell',{name:'640',exact:true})).toBeVisible();await expect(prose.getByRole('table')).toHaveCount(1);
});

for(const variant of [{name:'light',theme:'light',width:1440},{name:'dark',theme:'dark',width:1440},{name:'narrow',theme:'light',width:390}] as const)test(`table layout contains overflow and stays readable in ${variant.name}`,async({page})=>{
 await page.setViewportSize({width:variant.width,height:1000});const snapshot=taskFixture(spec(actualTraceTable+'\n\n| Detail | Value |\n| --- | ---: |\n| '+ 'long-source-token-'.repeat(18)+' | 1234 |'));snapshot.settings.theme=variant.theme;await serveTaskFixture(page,snapshot);await page.goto('/');const markdown=page.locator('[data-artifact-id="task-surface"] .markdown');await expect(markdown.getByRole('table')).toHaveCount(2);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);const scroller=markdown.locator('.markdown-table-scroll').first();await expect(scroller).toHaveAttribute('tabindex','0');await scroller.focus();await expect(scroller).toBeFocused();
 const longCell=markdown.getByRole('cell').filter({hasText:'long-source-token-'});expect(await longCell.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
 if(variant.width===390){expect(await scroller.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);const cell=markdown.getByRole('cell',{name:'Response formatting',exact:true});await expect(cell).toBeVisible();expect(await cell.evaluate(node=>node.scrollWidth<=node.clientWidth+1&&node.scrollHeight<=node.clientHeight+1)).toBe(true);}
 mkdirSync(evidence,{recursive:true});await page.screenshot({path:join(evidence,variant.name+'.png'),fullPage:true});
});
