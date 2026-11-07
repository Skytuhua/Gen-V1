import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createServer,type Server} from 'node:http';
import {basename} from 'node:path';
import {build} from 'esbuild';
import {chromium,expect as browserExpect,type Browser,type Page} from '@playwright/test';
import type {SecureArtifactScope} from '../apps/web/src/secure-artifact-context';

const scope:SecureArtifactScope={artifactId:'synthetic-artifact',threadId:'synthetic-thread',revision:1,active:true};
const fixture='SYNTHETIC_OFFLINE_FIXTURE';
type Operation={operation:'get'|'save'|'remove';scope:SecureArtifactScope;slot:string;version?:number;tokenBytes?:number};
type Harness={operations:Operation[];setActive:(active:boolean)=>void;releaseStatus:()=>void};
let browser:Browser,server:Server,origin:string;

beforeAll(async()=>{
  // Exercise the real component/provider. Only the dedicated API boundary is
  // substituted; the recorder retains token byte counts, never token values.
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import {createRoot} from 'react-dom/client';
    import {CredentialEntry} from './apps/web/src/CredentialEntry';
    import {SecureArtifactProvider} from './apps/web/src/secure-artifact-context';
    const root=createRoot(document.getElementById('root'));
    const render=active=>root.render(<SecureArtifactProvider value={{artifactId:'synthetic-artifact',threadId:'synthetic-thread',revision:1,active}}><CredentialEntry slotKey="syntheticSlot" label="Synthetic test value" service="Offline fixture"/></SecureArtifactProvider>);
    window.setActive=render;render(true);
  `},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{
    name:'offline-credential-api',setup(plugin){
      plugin.onResolve({filter:/^\.\/api$/},args=>basename(args.importer)==='CredentialEntry.tsx'?{path:'credential-api',namespace:'offline'}:undefined);
      plugin.onLoad({filter:/.*/,namespace:'offline'},()=>({loader:'js',contents:`
        const query=new URLSearchParams(location.search),present=query.has('existing'),version=present?7:0;
        window.operations=[];
        export class ApiError extends Error {constructor(code,message){super(message);this.code=code;}}
        export async function getCredentialSlot(scope,slot){
          window.operations.push({operation:'get',scope:{...scope},slot});
          if(query.has('pending'))await new Promise(resolve=>window.releaseStatus=resolve);
          return {present,version,expiresAt:null};
        }
        export async function saveCredentialSlot(scope,slot,token,version){
          window.operations.push({operation:'save',scope:{...scope},slot,version,tokenBytes:new TextEncoder().encode(token).length});
          return {present:true,version:version+1,expiresAt:null};
        }
        export async function removeCredentialSlot(scope,slot,version){
          window.operations.push({operation:'remove',scope:{...scope},slot,version});
          return {present:false,version:version+1,expiresAt:null};
        }
      `}));
    },
  }]});
  server=createServer((request,response)=>{
    if(request.url==='/component.js'){response.writeHead(200,{'Content-Type':'text/javascript'}).end(bundle.outputFiles[0].text);return;}
    if(new URL(request.url??'/', 'http://localhost').pathname==='/'){response.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><link rel="icon" href="data:,"><div id="root"></div><script src="/component.js"></script>');return;}
    response.writeHead(404).end();
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  browser=await chromium.launch({headless:true});
});
afterAll(async()=>{try{await browser?.close();}finally{if(server?.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));}});

async function flush(page:Page){await page.evaluate(async()=>{await Promise.resolve();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});}
async function mutations(page:Page){return page.evaluate(()=>(window as unknown as Harness).operations.filter(value=>value.operation!=='get'));}
async function withFixture(existing:boolean,run:(page:Page)=>Promise<void>,pending=false){
  const page=await browser.newPage(),requests:string[]=[],errors:string[]=[];
  page.on('request',request=>requests.push(`${request.method()} ${new URL(request.url()).pathname}`));
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(`${origin}/?${new URLSearchParams({...existing?{existing:'1'}:{},...pending?{pending:'1'}:{}})}`);
    if(!pending)await browserExpect(page.getByLabel('Synthetic test value')).toBeEnabled();
    else await browserExpect(page.getByRole('status')).toHaveText('Checking private token…');
    await run(page);
    expect(errors).toEqual([]);
    // The component must not introduce commands or any other network operation.
    expect(requests).toEqual(['GET /','GET /component.js']);
  }finally{await page.close();}
}
const confirmations=[{name:'native composition',key:'Enter',isComposing:true,keyCode:13},{name:'legacy composition',key:'Enter',isComposing:false,keyCode:229}];
const slots=[{name:'empty slot',existing:false,version:0,button:'Save token',status:'No token saved'},{name:'saved slot',existing:true,version:7,button:'Replace token',status:'Saved for this host session'}];

describe.each(slots)('$name',slot=>{
  it.each(confirmations)('IME confirmation retains private-token input ($name)',async confirmation=>{
    await withFixture(slot.existing,async page=>{
      const input=page.getByLabel('Synthetic test value');
      await input.fill(fixture);
      await browserExpect(page.getByRole('button',{name:slot.button,exact:true})).toBeEnabled();
      await input.dispatchEvent('keydown',confirmation);await flush(page);
      expect.soft(await mutations(page)).toEqual([]);
      expect.soft(await input.inputValue()).toBe(fixture);
      expect.soft(await page.getByRole('status').textContent()).toBe(slot.status);
      expect.soft(await input.evaluate(element=>element===document.activeElement)).toBe(true);
      // A later intentional Enter still uses the current metadata version once.
      await input.press('Enter');await flush(page);
      expect(await mutations(page)).toEqual([{operation:'save',scope,slot:'syntheticSlot',version:slot.version,tokenBytes:25}]);
      await browserExpect(input).toHaveValue('');
      await browserExpect(page.getByRole('status')).toHaveText('Saved for this host session');
    });
  });
  it.each(confirmations)('explicit Save and Replace still submit once ($name)',async confirmation=>{
    await withFixture(slot.existing,async page=>{
      const input=page.getByLabel('Synthetic test value');await input.fill(fixture);
      const submit=page.getByRole('button',{name:slot.button,exact:true});await browserExpect(submit).toBeEnabled();
      await input.dispatchEvent('keydown',confirmation);await flush(page);
      expect(await mutations(page)).toEqual([]);
      await submit.click();await flush(page);
      expect(await mutations(page)).toEqual([{operation:'save',scope,slot:'syntheticSlot',version:slot.version,tokenBytes:25}]);
      await browserExpect(input).toHaveValue('');
      await browserExpect(page.getByRole('status')).toHaveText('Saved for this host session');
    });
  });
});

it('explicit Remove still submits the existing metadata version once',async()=>{
  await withFixture(true,async page=>{
    await page.getByRole('button',{name:'Remove token',exact:true}).click();await flush(page);
    expect(await mutations(page)).toEqual([{operation:'remove',scope,slot:'syntheticSlot',version:7}]);
    await browserExpect(page.getByRole('status')).toHaveText('No token saved');
  });
});

it('inactive scope disables input and preserves the mutation guard',async()=>{
  await withFixture(true,async page=>{
    const input=page.getByLabel('Synthetic test value');await input.fill(fixture);
    await page.evaluate(()=>(window as unknown as Harness).setActive(false));await flush(page);
    await browserExpect(input).toBeDisabled();await browserExpect(input).toHaveValue('');
    await input.dispatchEvent('keydown',{key:'Enter'});
    await browserExpect(page.getByRole('button',{name:'Save token',exact:true})).toBeDisabled();
    await browserExpect(page.getByRole('button',{name:'Remove token',exact:true})).toHaveCount(0);
    await flush(page);
    expect(await mutations(page)).toEqual([]);
  });
});

it('pending status disables input and cannot save or remove before metadata arrives',async()=>{
  await withFixture(true,async page=>{
    const input=page.getByLabel('Synthetic test value');await browserExpect(input).toBeDisabled();
    await browserExpect(page.getByRole('button',{name:'Save token',exact:true})).toBeDisabled();
    await browserExpect(page.getByRole('button',{name:'Remove token',exact:true})).toHaveCount(0);
    await input.dispatchEvent('keydown',{key:'Enter'});await flush(page);
    expect(await mutations(page)).toEqual([]);
    await page.evaluate(()=>(window as unknown as Harness).releaseStatus());
    await browserExpect(input).toBeEnabled();
    await browserExpect(page.getByRole('status')).toHaveText('Saved for this host session');
    expect(await mutations(page)).toEqual([]);
  },true);
});
