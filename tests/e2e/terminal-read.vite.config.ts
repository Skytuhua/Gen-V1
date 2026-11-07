import {defineConfig} from 'vite';
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import isolated from './vite.config';

const root=resolve(import.meta.dirname,'../..');
export default defineConfig({...isolated,root,cacheDir:resolve(root,'.harness-terminal-read/node_modules/.vite'),server:{...isolated.server,port:5814,strictPort:true,fs:{strict:true,allow:[root,realpathSync(resolve(root,'node_modules'))]}}});
