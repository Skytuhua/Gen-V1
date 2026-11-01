import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url),electron=require('electron') as string;
const env:NodeJS.ProcessEnv={...process.env,HARNESS_DESKTOP_NODE_PATH:process.execPath,HARNESS_DESKTOP_HOST_ROOT:resolve('.')};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(electron,[resolve('dist/desktop-app/main.mjs')],{env,stdio:'inherit',windowsHide:false});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
