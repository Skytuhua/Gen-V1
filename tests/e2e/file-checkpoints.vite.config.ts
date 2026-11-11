import {realpathSync} from 'node:fs';
import {defineConfig} from 'vite';
import {resolve} from 'node:path';
import base from './vite.config';

export default defineConfig({...base, root:resolve('.'), cacheDir:resolve('test-results/file-checkpoints/node_modules/.vite'),
  optimizeDeps:{entries:['tests/e2e/file-checkpoints-fixture.tsx']},
  plugins:[...base.plugins??[], {name:'file-checkpoints-fixture', configureServer(server) {
    server.middlewares.use((req,res,next)=>{
      if(new URL(req.url??'/', 'http://localhost').pathname!=='/file-checkpoints')return next();
      void server.transformIndexHtml(req.url!, '<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/e2e/file-checkpoints-fixture.tsx"></script></body></html>').then(html=>{res.setHeader('Content-Type','text/html');res.end(html);}).catch(next);
    });
  }}], server:{host:'127.0.0.1',port:5525,strictPort:true,watch:{ignored:['**/.harness*/**']},fs:{allow:[resolve('.'),realpathSync('node_modules')]}},
});
