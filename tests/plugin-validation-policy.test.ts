import {afterEach,expect,it,vi} from 'vitest';
import {z} from 'zod';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium,expect as browserExpect} from '@playwright/test';

afterEach(()=>{vi.unstubAllGlobals();z.config({jitless:false});vi.resetModules();});

it('validates shared plug-in schemas when the frame forbids dynamic code',async()=>{
  vi.stubGlobal('Function',function(){throw Error('CSP forbids dynamic code');});
  await import('../apps/web/src/plugin-validation-policy');
  const schema=z.object({scope:z.string().min(1),revision:z.number().int().nonnegative()});
  expect(schema.safeParse({scope:'project',revision:1}).success).toBe(true);
  expect(schema.safeParse({scope:'',revision:-1}).success).toBe(false);
});

it('boots the actual presentation bundle in an opaque browser frame without Node globals or dynamic code',async()=>{
  await promisify(execFile)(process.execPath,['scripts/build-plugin-runtime.mjs'],{timeout:60000,maxBuffer:256*1024,windowsHide:true});
  const runtime=await readFile('dist/plugin-runtime/runtime.js');
  const errors:string[]=[];
  const server=createServer((request,response)=>{
    if(request.url==='/runtime.js'){response.writeHead(200,{'content-type':'text/javascript'});response.end(runtime);return;}
    if(request.url==='/check.js'){response.writeHead(200,{'content-type':'text/javascript'});response.end(`
      const ui=window.GenPluginUI;
      ui.registerPlugin({id:'browser-test',name:'Browser test',version:'1.0.0',apiVersion:1,compatibleGenVersions:'>=0.6.4 <0.7.0',frontendEntry:'frontend/index.html',hostEntry:'host/main.mjs'},
        {navigation:[{id:'main',title:'Main'}],conversation:{load:async()=>null,send:async()=>null,submitArtifactAction:async()=>null,cancel:async()=>null}});
      ui.ReactDOMClient.createRoot(document.getElementById('root')).render(ui.React.createElement(ui.ComposerView,{onSubmit:event=>event.preventDefault()},
        ui.React.createElement('label',null,'Draft',ui.React.createElement('textarea',{'aria-label':'Draft',defaultValue:'Recovered'})),ui.React.createElement('button',{type:'button',onClick:()=>{document.body.dataset.saved='yes';}},'Save locally')));
    `);return;}
    if(request.url?.startsWith('/frame?')){response.writeHead(200,{'content-type':'text/html','content-security-policy':"default-src 'none'; script-src 'self'; frame-ancestors 'self'"});response.end('<meta name="gen-plugin-id" content="browser-test"><div id="root"></div><script src="/runtime.js"></script><script src="/check.js"></script>');return;}
    response.writeHead(200,{'content-type':'text/html'});response.end('<iframe title="Isolated presentation" sandbox="allow-scripts" src="/frame?session=browser-test&theme=dark"></iframe>');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('Fixture listener unavailable');
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}`);
    expect(errors).toEqual([]);
    const frame=page.frameLocator('iframe');
    await browserExpect(frame.getByRole('textbox',{name:'Draft'})).toHaveValue('Recovered',{timeout:5000});
    await frame.getByRole('textbox',{name:'Draft'}).fill('Local edit');await frame.getByRole('button',{name:'Save locally'}).click();
    await browserExpect(frame.locator('body')).toHaveAttribute('data-saved','yes');
    expect(errors).toEqual([]);
  }finally{await browser?.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
},90000);
