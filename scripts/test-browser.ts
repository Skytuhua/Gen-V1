import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {browserSuites,validateBrowserSuites,type BrowserSuite} from './browser-suites.ts';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const require=createRequire(import.meta.url);
const escapePattern=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

export function runBrowserSuites(suites:BrowserSuite[], list=false):number {
  const cli=require.resolve('@playwright/test/cli');
  const directory=resolve(tmpdir(),'gen-browser-results',`run-${Date.now()}-${randomUUID()}`);
  console.log(`Browser results: ${directory}`);
  for(const suite of suites){
    const output=resolve(directory,suite.name);
    mkdirSync(output,{recursive:true});
    const args=[cli,'test','--config',suite.config,...suite.specs.map(spec=>`(?:^|[/\\\\])${escapePattern(spec)}$`),
      ...(suite.project?['--project',suite.project]:[]),'--output',resolve(output,'artifacts'),'--reporter=list,json',...(list?['--list']:[])];
    console.log(`\nBrowser suite: ${suite.name} (${suite.specs.length} spec files)`);
    const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',windowsHide:true,
      env:{...process.env,GEN_E2E:'1',GEN_MEMORY_MODE:'',...suite.env,PLAYWRIGHT_JSON_OUTPUT_FILE:resolve(output,list?'discovery.json':'results.json')}});
    if(result.error)throw result.error;
    if(result.status!==0)return result.status??1;
  }
  return 0;
}

export function browserTestMain(args:string[]):number {
  let selected:string|undefined,list=false;
  for(let index=0;index<args.length;index++){
    if(args[index]==='--')continue;
    if(args[index]==='--list')list=true;
    else if(args[index]==='--suite'&&args[index+1])selected=args[++index];
    else throw Error('Usage: tsx scripts/test-browser.ts [--suite name] [--list]');
  }
  const specs=readdirSync(resolve(root,'tests/e2e'),{recursive:true}).map(String).map(path=>path.replaceAll('\\','/')).filter(path=>/\.spec\.[cm]?[jt]sx?$/.test(path));
  validateBrowserSuites(specs);
  for(const suite of browserSuites)if(!existsSync(resolve(root,suite.config)))throw Error(`Browser configuration is missing: ${suite.config}`);
  const suites=selected?browserSuites.filter(suite=>suite.name===selected):browserSuites;
  if(!suites.length)throw Error(`Unknown browser suite: ${selected}`);
  return runBrowserSuites(suites,list);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.exitCode=browserTestMain(process.argv.slice(2));}
  catch(cause){console.error(cause);process.exitCode=1;}
}
