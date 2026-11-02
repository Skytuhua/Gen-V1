import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {SUBSCRIPTION_CONNECTIONS,isConnectionProviderId,isOfficialRuntimeProviderId,type ConnectionProviderId,type OfficialRuntimeProviderId} from '../contracts/connections.ts';
import {loginMain} from '../runtime-pi/login.ts';
import {safeError} from '../runtime-pi/sdk.ts';
import {terminateProcessTree} from '../runtime-pi/process-tree.ts';
import {officialRuntimeCommand,officialRuntimeEnvironment,officialRuntimeHome} from '../runtime-official/environment.ts';
import {isAccountId} from '../contracts/accounts.ts';
import {withAccountLogin} from './account-login.ts';
import {readOfficialIdentity} from '../runtime-official/account-identity.ts';
import {claudeAccountStatus} from '../runtime-official/claude-account.ts';

interface LoginRequest {provider:ConnectionProviderId;dataDir:string;noOpen:boolean;accountId?:string}
export function parseConnectionLogin(args:string[]):LoginRequest{
 let provider:unknown='openai',dataDir:string|undefined,noOpen=false,accountId:string|undefined;const seen=new Set<string>();
 for(let index=0;index<args.length;index++){
  const flag=args[index];
  if(seen.has(flag))throw Error('Each login option may be supplied only once.');seen.add(flag);
  if(flag==='--no-open'){noOpen=true;continue;}
  if(flag!=='--provider'&&flag!=='--data-dir'&&flag!=='--account-id')throw Error('Unsupported login argument. Secrets are entered only in the connection console.');
  const value=args[++index];if(!value||value.startsWith('--'))throw Error('A login option is missing its value.');
  if(flag==='--provider')provider=value;else if(flag==='--account-id'){if(!isAccountId(value))throw Error('Choose a saved subscription account.');accountId=value;}else dataDir=value;
 }
 if(!isConnectionProviderId(provider))throw Error('Choose an available connection from Settings.');
 if(isOfficialRuntimeProviderId(provider)&&noOpen)throw Error('This provider uses its native sign-in flow; --no-open applies to Pi OAuth connections.');
 return {provider,dataDir:resolve(dataDir??process.env.HARNESS_DATA_DIR??join(process.env.LOCALAPPDATA??homedir(),'GenerativeHarness')),noOpen,...(accountId?{accountId}:{})};
}

async function officialLogin({provider,dataDir}:{provider:OfficialRuntimeProviderId;dataDir:string}):Promise<void>{
 if(provider==='cursor-sdk'){await (await import('../runtime-official/cursor.ts')).cursorLogin(dataDir);return;}
 if(provider!=='claude-code'&&provider!=='gemini-cli')throw Error('Unsupported official sign-in provider.');
 if(provider==='claude-code'&&await readOfficialIdentity(dataDir,'claude-code'))throw Error('The official Claude CLI does not expose staged reconnect in this integration. This profile already has authenticated account metadata. Keep it and add a new local account to sign in again without risking replacement credentials.');
 const home=officialRuntimeHome(dataDir,provider),env=officialRuntimeEnvironment(dataDir,provider);
 await Promise.all([home,env.APPDATA!,env.LOCALAPPDATA!,env.TEMP!,env.XDG_CONFIG_HOME!,env.XDG_DATA_HOME!,env.XDG_STATE_HOME!,env.XDG_CACHE_HOME!,...(provider==='gemini-cli'?[join(home,'.gemini')]:[])].map(path=>mkdir(path,{recursive:true,mode:0o700})));
 const command=officialRuntimeCommand(provider);
 let args:string[];
 if(provider==='gemini-cli'){
  // Native auth choices remain untouched. This sign-in console receives no task tools.
  const settings=join(home,'login-settings.json');
  await writeFile(settings,JSON.stringify({tools:{core:['harness_login_no_tools']},mcp:{allowed:['harness_login_no_servers']},mcpServers:{},hooksConfig:{enabled:false},security:{allowedExtensions:['(?!)']},context:{fileName:'.harness-login-'+randomUUID()+'.md',includeDirectories:[],loadMemoryFromIncludeDirectories:false},experimental:{autoMemory:false,enableAgents:false},telemetry:{enabled:false}}),{mode:0o600});
  env.GEMINI_CLI_SYSTEM_SETTINGS_PATH=settings;
  process.stderr.write('Complete Google sign-in in the official Gemini CLI, then exit that console and refresh models in the harness. No task was submitted.\n');
  args=['--extensions','__harness_no_extensions__','--allowed-mcp-server-names','harness_login_no_servers'];
 }else if(provider==='claude-code'){
  process.stderr.write('Complete sign-in directly with the official Claude Code binary. The harness does not receive your credentials. Refresh models afterward.\n');
  args=['auth','login'];
 }else throw Error('Unsupported official sign-in provider.');
 const child=spawn(command.file,[...command.args,...args],{env,cwd:home,stdio:'inherit',windowsHide:false,detached:process.platform!=='win32'});
 let cancellation:Promise<void>|undefined;
 const stop=()=>{cancellation??=terminateProcessTree(child);void cancellation.catch(()=>{});};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  await new Promise<void>((done,reject)=>{child.once('error',()=>reject(Error('The bundled official sign-in runtime could not start.')));child.once('exit',(code,signal)=>code===0&&!signal?done():reject(Error('The official sign-in console closed without completing setup.')));});
 }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await cancellation;}
 if(provider==='claude-code')await claudeAccountStatus(dataDir);
}

export async function connectionLoginMain(args=process.argv.slice(2),dependencies={pi:loginMain,official:officialLogin}):Promise<void>{
 if(args.includes('--help')){process.stderr.write(`pnpm agent:login [--data-dir PATH] [--provider ${SUBSCRIPTION_CONNECTIONS.filter(row=>isConnectionProviderId(row.id)).map(row=>row.id).join('|')}] [--account-id SAVED_ID] [--no-open]\nSecrets stay in the connection console. Official runtimes authenticate directly in isolated app profiles. No app-side billing fallback; provider usage settings apply.\n`);return;}
 const request=parseConnectionLogin(args);
 await withAccountLogin(request,async dataDir=>{
  if(isOfficialRuntimeProviderId(request.provider))await dependencies.official({provider:request.provider,dataDir});
  else await dependencies.pi(request.accountId?['--provider',request.provider,'--data-dir',dataDir,...(request.noOpen?['--no-open']:[])]:args);
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 void connectionLoginMain().catch(error=>{process.stderr.write(safeError(error)+'\n');process.exitCode=1;});
}
