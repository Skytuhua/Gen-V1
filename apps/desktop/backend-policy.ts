import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
export function nodeSidecarArguments(hostRoot:string):string[]{return ['--import',pathToFileURL(join(hostRoot,'node_modules/tsx/dist/loader.mjs')).href,join(hostRoot,'apps/server/main.ts')];}
