import {build} from 'esbuild';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const directory=resolve('dist/desktop-app');await mkdir(directory,{recursive:true});
await build({entryPoints:['apps/desktop/main.ts'],outfile:resolve(directory,'main.mjs'),bundle:true,format:'esm',platform:'node',target:'node24',external:['electron'],sourcemap:false});
await build({entryPoints:['apps/desktop/preload.ts'],outfile:resolve(directory,'preload.cjs'),bundle:true,format:'cjs',platform:'node',target:'node24',external:['electron'],sourcemap:false});
const source=JSON.parse(await readFile('package.json','utf8'));
await writeFile(resolve(directory,'package.json'),JSON.stringify({name:'generative-harness-desktop',version:source.version,private:true,type:'module',main:'main.mjs',dependencies:{},description:'Gen V1 local agent workspace',author:'Gen V1',license:'UNLICENSED'},null,2));
console.log('Desktop shell built: '+directory);
