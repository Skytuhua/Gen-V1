import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

export function windows(){if(process.platform!=='win32'||process.arch!=='x64')throw Error('RC review requires Windows x64.');}
export function args(){const values=process.argv.slice(2),options:Record<string,string>={},positionals:string[]=[];for(let i=0;i<values.length;i++){const key=values[i];if(key.startsWith('--')){if(!values[i+1]||values[i+1].startsWith('--')||key.slice(2) in options)throw Error('Expected unique option and value: '+key);options[key.slice(2)]=values[++i];}else positionals.push(key);}return {options,positionals};}
export function required(options:Record<string,string>,key:string){if(!options[key])throw Error('Required --'+key);return options[key];}
export const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export async function hash(path:string){return sha(await readFile(path));}
export async function json(path:string,value:unknown){await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,JSON.stringify(value,null,2)+'\n');}
export const output=(options:Record<string,string>)=>resolve(options.out??join('.harness-rc-review','run-'+Date.now()));
export function main(url:string,run:()=>Promise<void>){if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===url)void run().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});}
export function run(file:string,argv:string[],options:{cwd?:string;env?:NodeJS.ProcessEnv;capture?:boolean;input?:string}={}):Promise<string>{return new Promise((accept,reject)=>{let stdout='';const command=process.platform==='win32'&&file.endsWith('.cmd');if(command&&[file,...argv].some(value=>/["\r\n%&|<>^]/.test(value))){reject(Error('Unsafe command argument.'));return;}const child=spawn(command?process.env.COMSPEC??'cmd.exe':file,command?['/d','/s','/c','"'+[file,...argv].map(value=>'"'+value+'"').join(' ')+'"']:argv,{cwd:options.cwd,env:options.env??process.env,windowsHide:true,windowsVerbatimArguments:command,stdio:options.capture?[options.input===undefined?'ignore':'pipe','pipe','inherit']:'inherit'});let inputFailed=false;if(options.input!==undefined&&child.stdin){child.stdin.on('error',()=>{inputFailed=true;});child.stdin.end(options.input);}child.stdout?.on('data',chunk=>{stdout+=chunk;});child.once('error',reject);child.once('close',code=>{const captured=stdout.trim();if(code===0&&!inputFailed)accept(captured);else reject(Object.assign(Error(code===0?'RC subprocess did not accept its input':file+' exited '+code),{stdout:captured,exitCode:code}));});});}
export async function pnpm(argv:string[],capture=false){const command=process.platform==='win32'?(await run('where.exe',['corepack.cmd'],{capture:true})).split(/\r?\n/)[0]:'corepack';return run(command,['pnpm',...argv],{capture});}
