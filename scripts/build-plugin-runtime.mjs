import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
// This shipped IIFE always uses production React, including when a test runner
// launches the builder with NODE_ENV=test. Keep JSX and library branches aligned.
process.env.NODE_ENV='production';
await build({configFile:false,plugins:[react()],base:'/plugin-runtime/',define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:'dist/plugin-runtime',emptyOutDir:true,sourcemap:false,lib:{entry:resolve('apps/web/src/plugin-runtime.tsx'),name:'GenPluginUI',formats:['iife'],fileName:()=> 'runtime.js',cssFileName:'runtime'},rollupOptions:{output:{inlineDynamicImports:true}},assetsInlineLimit:0}});
