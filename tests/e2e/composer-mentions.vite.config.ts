import {resolve} from 'node:path';
import {realpathSync} from 'node:fs';
import {defineConfig, normalizePath} from 'vite';
import {application} from '../../vite.config';
// Serves the real app at / plus a bare ScopedConversationComposer at /fixture.
export default defineConfig({...application,
  plugins:[...(application.plugins??[]),{name:'composer-mentions-fixture',configureServer(server){
    server.middlewares.use((request,response,next)=>{
      if(!request.url?.startsWith('/fixture'))return next();
      const entry='/@fs/'+normalizePath(resolve('tests/e2e/composer-mentions-fixture.tsx'));
      void server.transformIndexHtml(request.url,'<!doctype html><html lang="en" data-theme="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><title>composer-mentions fixture</title><body><div id="root" style="height:100dvh"></div><script type="module" src="'+entry+'"></script></body></html>').then(html=>{response.setHeader('Content-Type','text/html');response.end(html);}).catch(next);
    });
  }}],
  optimizeDeps:{...application.optimizeDeps,entries:['apps/web/index.html','tests/e2e/composer-mentions-fixture.tsx']},
  cacheDir:resolve(process.env.GEN_BROWSER_OUTPUT_DIR??'.harness-ui-shell/composer-mentions','node_modules/.vite'),
  server:{host:'127.0.0.1',port:5344,strictPort:true,watch:{ignored:['**/.harness*/**']},fs:{allow:[resolve('.'),realpathSync('node_modules')]}}});
