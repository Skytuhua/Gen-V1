import {defineConfig} from 'vite';
import {resolve} from 'node:path';
import {realpathSync} from 'node:fs';
import base from './vite.config';
export default defineConfig({...base,root:resolve('.'),cacheDir:'/tmp/wo5-run-d/node_modules/.vite/redundant-ui',
 optimizeDeps:{entries:['tests/e2e/redundant-ui-fixture.tsx','apps/web/src/main.tsx']},
 plugins:[...base.plugins??[],{name:'redundant-ui-fixture',configureServer(server){
  server.middlewares.use((req,res,next)=>{
   const path=new URL(req.url??'/','http://localhost').pathname;if(!['/redundant-ui','/actual-app'].includes(path))return next();
   void server.transformIndexHtml(req.url!,`<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="${path==='/actual-app'?'/apps/web/src/main.tsx':'/tests/e2e/redundant-ui-fixture.tsx'}"></script></body></html>`).then(html=>{res.setHeader('Content-Type','text/html');res.end(html);}).catch(next);
  });
 }}],server:{host:'127.0.0.1',port:5526,strictPort:true,watch:{ignored:['**/.harness*/**']},fs:{allow:[resolve('.'),realpathSync('node_modules')]}},
});
