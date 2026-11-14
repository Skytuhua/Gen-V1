import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
// This shipped IIFE always uses production React, including when a test runner
// launches the builder with NODE_ENV=test. Keep JSX and library branches aligned.
process.env.NODE_ENV='production';
await build({configFile:false,plugins:[react()],base:'/plugin-runtime/',define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:'dist/plugin-runtime',emptyOutDir:true,sourcemap:false,lib:{entry:resolve('apps/web/src/plugin-runtime.tsx'),name:'GenPluginUI',formats:['iife'],fileName:()=> 'runtime.js',cssFileName:'runtime'},rollupOptions:{output:{inlineDynamicImports:true}},assetsInlineLimit:0}});
// Library mode ignores assetsInlineLimit and inlines every asset as a data URI.
// Move embedded fonts back into real files so unicode-range faces download only
// when a rendered subset or decorative font is actually used.
const cssPath=resolve('dist/plugin-runtime/runtime.css');
let css=await readFile(cssPath,'utf8');
const fonts=new Map();let index=0;
css=css.replace(/url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\)/g,(match,encoded)=>{
  const bytes=Buffer.from(encoded,'base64'),hash=createHash('sha256').update(bytes).digest('hex').slice(0,12);
  let name=fonts.get(hash)?.name;if(!name){name=`font-${index++}-${hash}.woff2`;fonts.set(hash,{name,bytes});}
  return `url(assets/${name})`;
});
if(fonts.size){
  const directory=resolve('dist/plugin-runtime/assets');await mkdir(directory,{recursive:true});
  for(const {name,bytes} of fonts.values())await writeFile(resolve(directory,name),bytes);
  await writeFile(cssPath,css);
}
