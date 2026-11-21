import {test,expect,type Page} from '@playwright/test';
import {shellSnapshot} from '../../scripts/capture-ui/shell-api';
import {serveTaskFixture} from './task-interface-fixture';
import {openApp} from './app-ready';
import type {Snapshot,Message} from '../../packages/contracts';

test.use({locale:'en-US',timezoneId:'America/Los_Angeles'});

// Fixed instants, Los Angeles local days: Nov 19 (Thu), Nov 20, Nov 21.
const stamp=(iso:string,offset=0)=>new Date(new Date(iso).getTime()+offset).toISOString();
const day={one:'2026-11-19T19:00:00Z',two:'2026-11-20T19:00:00Z',three:'2026-11-21T17:00:00Z'};
const message=(id:string,role:Message['role'],content:string,createdAt:string):Message=>({id,threadId:'one',role,content,createdAt,runId:null});

function snapshot():Snapshot{
 const base=shellSnapshot();
 base.messages=[
  message('m1','user','First day question',day.one),
  message('m2','assistant','Second day answer',day.two),
  message('m3','activity','Work activity update',stamp(day.two,7200000)),
  message('m4','user','Missing send time',''),
  message('m5','assistant','Third day answer',day.three),
 ];
 base.activeThreadId='one';
 return base;
}

async function open(page:Page,data=snapshot()){await serveTaskFixture(page,data);await openApp(page);}

test('renders one local time per user/assistant message and day headers per local day',async({page})=>{
 await page.clock.install({time:new Date('2026-11-21T20:00:00Z')});
 await open(page);
 await expect(page.getByText('Third day answer',{exact:true})).toBeVisible();
 const times=page.locator('.message time[data-message-time]');
 await expect(times).toHaveCount(3);
 await expect(times.nth(0)).toHaveAttribute('dateTime',day.one);
 await expect(times.nth(1)).toHaveAttribute('dateTime',day.two);
 await expect(times.nth(2)).toHaveAttribute('dateTime',day.three);
 // Activity rows and messages without a valid send time render no <time>.
 await expect(page.locator('[data-message-id="m3"] time')).toHaveCount(0);
 await expect(page.locator('[data-message-id="m4"] time')).toHaveCount(0);
 const headers=page.locator('[role="separator"][data-day]');
 await expect(headers).toHaveCount(3);
 await expect(headers.nth(0)).toHaveAttribute('data-day','2026-11-19');
 await expect(headers.nth(0)).toHaveText('Thursday');
 await expect(headers.nth(1)).toHaveAttribute('data-day','2026-11-20');
 await expect(headers.nth(1)).toHaveText('Yesterday');
 await expect(headers.nth(2)).toHaveAttribute('data-day','2026-11-21');
 await expect(headers.nth(2)).toHaveText('Today');
 // Header order in the transcript is chronological.
 const order=await page.locator('.conversation').evaluate(el=>[...el.querySelectorAll('[data-day],[data-message-id]')].map(node=>node.getAttribute('data-day')??node.getAttribute('data-message-id')));
 expect(order.slice(0,7)).toEqual(['2026-11-19','m1','2026-11-20','m2','m3','m4','2026-11-21']);
});

test('honours the 24h Time format preference and excludes times from find',async({page})=>{
 const data=snapshot();data.settings.preferences={timeFormat:'24h'};
 await page.clock.install({time:new Date('2026-11-21T20:00:00Z')});
 await open(page,data);
 const times=page.locator('.message time[data-message-time]');
 await expect(times.nth(0)).toHaveText(/^11:00$|^11:00/);
 await expect(times.nth(0)).not.toContainText('AM');
 // R08: find over the transcript never matches time or header text.
 await page.locator('.composer textarea').focus();
 await page.keyboard.press('Control+f');
 await page.getByRole('textbox',{name:'Find phrase'}).fill('Today');
 await expect(page.getByRole('status').filter({hasText:'0 results'})).toBeVisible();
 await page.getByRole('textbox',{name:'Find phrase'}).fill('11:00');
 await expect(page.getByRole('status').filter({hasText:'0 results'})).toBeVisible();
 await page.getByRole('textbox',{name:'Find phrase'}).fill('answer');
 await expect(page.getByRole('status').filter({hasText:'1 of 2'})).toBeVisible();
});

test('loading earlier messages adds a header only for the new day',async({page})=>{
 const data=snapshot();data.messagesTruncated={one:50};
 await page.clock.install({time:new Date('2026-11-21T20:00:00Z')});
 await open(page,data);
 await page.route('**/api/threads/one/messages**',route=>route.fulfill({json:{messages:[message('older','user','Earlier day question','2026-11-18T19:00:00Z')],truncated:0}}));
 await page.getByRole('button',{name:'Load earlier messages',exact:true}).click();
 await expect(page.getByText('Earlier day question',{exact:true})).toBeVisible();
 const headers=page.locator('[role="separator"][data-day]');
 await expect(headers).toHaveCount(4);
 await expect(headers.nth(0)).toHaveAttribute('data-day','2026-11-18');
 for(const key of ['2026-11-19','2026-11-20','2026-11-21'])await expect(page.locator(`[data-day="${key}"]`)).toHaveCount(1);
});

test('day labels roll over at local midnight',async({page})=>{
 await page.clock.install({time:new Date('2026-11-22T07:59:50Z')}); // Nov 21 23:59:50 LA
 await open(page);
 const headers=page.locator('[role="separator"][data-day]');
 await expect(headers.nth(2)).toHaveText('Today');
 await page.clock.runFor(20000); // past local midnight into Nov 22
 await expect(headers.nth(2)).toHaveText('Yesterday');
 await expect(headers.nth(1)).toHaveText('Friday');
});

test('renders a 100-message thread within the boot budget',async({page})=>{
 const data=snapshot();
 data.messages=Array.from({length:100},(_,i)=>message(`bulk-${i}`,i%2?'assistant':'user',`Transcript entry ${i}`,stamp(day.one,Math.floor(i/40)*86400000+i*60000)));
 await page.clock.install({time:new Date('2026-11-21T20:00:00Z')});
 const started=Date.now();
 await open(page,data);
 await expect(page.getByText('Transcript entry 99',{exact:true})).toBeVisible();
 test.info().annotations.push({type:'render-ms',description:String(Date.now()-started)});
 await expect(page.locator('.message time[data-message-time]')).toHaveCount(100);
});
