import {resolve} from 'node:path';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({root:'.',plugins:[react(),{name:'workbench-fixture',configureServer(server){server.middlewares.use((req,res,next)=>{if(!req.url?.startsWith('/fixture'))return next();void server.transformIndexHtml(req.url,'<!doctype html><html lang="en" data-theme="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M15 workbench fixture</title><body><div id="root"></div><script type="module" src="/tests/e2e/workbench-fixture.tsx"></script></body></html>').then(html=>{res.setHeader('Content-Type','text/html');res.end(html);}).catch(next);});}}],server:{host:'127.0.0.1',port:5591,strictPort:true,fs:{allow:[resolve('.')]}}});
