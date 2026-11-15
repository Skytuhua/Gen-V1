// Test-only vite server for the M08 restore-UI and PR-checks fixture specs.
import {realpathSync} from 'node:fs';
import {defineConfig} from 'vite';
import {resolve} from 'node:path';
import base from './vite.config';

const pages:Record<string,string>={'/m08-restore':'/tests/e2e/m08-restore-fixture.tsx','/shared-panels-check':'/tests/e2e/shared-panels-fixture.tsx'};
export default defineConfig({...base, root:resolve('.'), cacheDir:resolve(process.env.GEN_BROWSER_OUTPUT_DIR??'test-results/m08-restore','node_modules/.vite'),
  optimizeDeps:{entries:['tests/e2e/m08-restore-fixture.tsx','tests/e2e/shared-panels-fixture.tsx']},
  plugins:[...base.plugins??[], {name:'m08-restore-fixture', configureServer(server) {
    server.middlewares.use((req,res,next)=>{
      const entry=pages[new URL(req.url??'/', 'http://localhost').pathname];
      if(!entry)return next();
      void server.transformIndexHtml(req.url!, `<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`).then(html=>{res.setHeader('Content-Type','text/html');res.end(html);}).catch(next);
    });
  }}], server:{host:'127.0.0.1',port:5530,strictPort:true,watch:{ignored:['**/.harness*/**']},fs:{allow:[resolve('.'),realpathSync('node_modules')]}},
});
