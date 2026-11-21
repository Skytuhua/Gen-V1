import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {args,hash,json,main,output,run,windows} from './common.ts';

export async function registry(root:string){
 const entry=JSON.stringify(join(root,'capability-flags.ts')),host=JSON.stringify(join(root,'host-flags.ts'));
 const result=await build({stdin:{contents:`import {registeredCapabilityFlags} from ${entry};import {HOST_FLAG_NAMES,hostFlagEnabled} from ${host};console.log(JSON.stringify({...registeredCapabilityFlags(),...Object.fromEntries(HOST_FLAG_NAMES.map(key=>[key,hostFlagEnabled(key)]))}));`,resolveDir:resolve('.')},bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'registry-error-type',setup(builder){builder.onResolve({filter:/contracts\/index\.ts$/},()=>({path:resolve('packages/contracts/index.ts')}));}}]});
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('HARNESS_FLAG_')&&!['NODE_OPTIONS','ELECTRON_RUN_AS_NODE'].includes(key)));
 return JSON.parse(await run(process.execPath,['--input-type=module'],{env,capture:true,input:result.outputFiles[0].text})) as Record<string,boolean>;
}
export async function flagsOff(installDir:string,out:string){
 await run('git',['diff','--exit-code','HEAD','--','packages/core/capability-flags.ts','packages/core/host-flags.ts'],{capture:true});
 const root=join(resolve(installDir),'resources/host/packages/core'),ambient=Object.keys(process.env).filter(key=>key.toUpperCase().startsWith('HARNESS_FLAG_'));
 const installed=await registry(root),source=await registry(resolve('packages/core')),keys=Object.keys(installed).sort(),keySetMatches=JSON.stringify(keys)===JSON.stringify(Object.keys(source).sort());
 const groups:Record<string,string[]>={M01:[],M02:['audit.','security.authority'],M03:['security.project','security.secret','security.execution'],M04:['context.','tools.deferred'],M05:['memory.'],M06:['verification.'],M07:['coding.'],M08:['workspace.'],M09:['agents.'],M10:['jobs.','integrations.'],M11:['models.'],M12:['tools.jsReadProgramV1','tools.durableReplayExperimentV1','tools.pythonKernelV1'],M13:['plugins.'],M14:['sessions.'],M15:['ui.'],M16:['control.'],M17:['remote.']};
 const rows=Object.entries(groups).map(([milestone,prefixes])=>({milestone,flags:keys.filter(key=>prefixes.some(prefix=>key.startsWith(prefix))).map(key=>({key,enabled:installed[key]}))}));
 const assigned=rows.flatMap(row=>row.flags.map(flag=>flag.key)),passed=keySetMatches&&!ambient.length&&keys.every(key=>installed[key]===false&&assigned.includes(key));
 const receipt={passed,scope:'Installed registry defaults in sanitized probe; not a running host effective-flags endpoint. Error-type dependency resolved from source contracts; installed registry bytes are unchanged.',sourceCommit:await run('git',['rev-parse','HEAD'],{capture:true}),sourceHashes:await Promise.all(['capability-flags.ts','host-flags.ts'].map(async file=>({file,sha256:await hash(resolve('packages/core',file))}))),ambientFlagNames:ambient,keySetMatches,hashes:await Promise.all(['capability-flags.ts','host-flags.ts'].map(async file=>({file,sha256:await hash(join(root,file))}))),rows};
 await mkdir(out,{recursive:true});await json(join(out,'flags-off.json'),receipt);const table='| Milestone | Keys and effective values |\n|---|---|\n'+rows.map(row=>'| '+row.milestone+' | '+(row.flags.length?row.flags.map(flag=>'`'+flag.key+'='+flag.enabled+'`').join(', '):'no flag registered (N/A, never PASS)')+' |').join('\n')+'\n';await writeFile(join(out,'flags-off.md'),table);console.log(table);if(!passed)throw Error('Flags-off verification failed (ambient flags, enabled/unknown keys or registry drift).');return receipt;
}
main(import.meta.url,async()=>{windows();const {positionals,options}=args();if(positionals.length!==1)throw Error('Usage: flags-off <installDir> --out <dir>');await flagsOff(positionals[0],output(options));});
