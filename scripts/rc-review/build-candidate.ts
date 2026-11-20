import {readdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {args,hash,json,main,output,pnpm,required,run,windows} from './common.ts';

main(import.meta.url,async()=>{
 windows();const {options}=args(),commit=required(options,'commit'),label=required(options,'label');if(!['freeze','dry-run'].includes(label))throw Error('Label must be freeze or dry-run.');if(options.worktree)process.chdir(resolve(options.worktree));const started=Date.now();
 const head=await run('git',['rev-parse','HEAD'],{capture:true}),expected=await run('git',['rev-parse',commit+'^{commit}'],{capture:true});
 if(head!==expected||await run('git',['status','--porcelain','--untracked-files=all'],{capture:true}))throw Error('Build requires clean worktree and HEAD equal to --commit.');
 const out=output(options),release=join(out,'package');
 const versions={node:process.version,pnpm:await pnpm(['--version'],true),python:await run('py',['-3.14','--version'],{capture:true})};
 await pnpm(['desktop:package','--output-root',release]);
 const files:string[]=[];async function walk(dir:string){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory()){if(entry.name!=='win-unpacked')await walk(path);}else files.push(path);}}await walk(release);
 const one=(name:string)=>{const matches=files.filter(path=>name==='setup'?/Gen-V1-Setup-.*-win-x64\.exe$/.test(path):path.endsWith(name));if(matches.length!==1)throw Error('Expected exactly one '+name);return resolve(matches[0]);};
 const setup=one('setup'),manifest=one('build-manifest.json'),unpacked=join(manifest,'..','win-unpacked');await stat(unpacked);
 if(await run('git',['rev-parse','HEAD'],{capture:true})!==head||await run('git',['status','--porcelain','--untracked-files=all'],{capture:true}))throw Error('Source changed during packaging.');
 await json(join(out,'rc-build.json'),{commit:head,label,dirty:false,worktree:process.cwd(),durationMs:Date.now()-started,versions,setup:{path:setup,bytes:(await stat(setup)).size,sha256:await hash(setup)},unpacked:resolve(unpacked),buildManifest:{path:manifest,sha256:await hash(manifest)},timestamp:new Date().toISOString()});console.log('RC build receipt: '+join(out,'rc-build.json'));
});
