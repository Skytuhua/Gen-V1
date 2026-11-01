import {afterEach,expect,it} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readDesktopOutputRoot,reserveDesktopRelease} from '../scripts/desktop-assets.ts';
const directories:string[]=[];
afterEach(async()=>{for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
async function directory(){const value=await mkdtemp(join(tmpdir(),'harness-desktop-output-'));directories.push(value);return value;}

it('accepts one explicit output root and rejects malformed packaging arguments',()=>{
 expect(readDesktopOutputRoot([])).toBe(resolve('dist'));expect(readDesktopOutputRoot(['--output-root','chosen release'])).toBe(resolve('chosen release'));
 for(const args of [['--output-root'],['--output-root',''],['--unknown','folder'],['--output-root','folder','extra']])expect(()=>readDesktopOutputRoot(args)).toThrow(/output-root|usage/i);
});
it('reserves each release once and preserves an existing release and receipt',async()=>{
 const root=await directory(),release=await reserveDesktopRelease(join(root,'releases'),'0.5.2');await writeFile(join(release,'build-manifest.json'),'original receipt',{flag:'wx'});
 await expect(reserveDesktopRelease(join(root,'releases'),'0.5.2')).rejects.toThrow(/already exists|overwrite/i);expect(await readFile(join(release,'build-manifest.json'),'utf8')).toBe('original receipt');
 const next=await reserveDesktopRelease(join(root,'other-releases'),'0.5.2');expect(next).not.toBe(release);
});
it.skipIf(process.platform!=='win32'||process.arch!=='x64')('rejects an occupied explicit release before creating staging files or invoking package installation',async()=>{
 const root=await directory(),output=join(root,'chosen-output'),release=join(output,'desktop-release-1.2.3');await mkdir(release,{recursive:true});await writeFile(join(root,'package.json'),JSON.stringify({version:'1.2.3'}));await writeFile(join(release,'receipt.txt'),'preserve this release');
 const env={...process.env};delete env.npm_execpath;
 const result=await promisify(execFile)(process.execPath,['--import',pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href,resolve('scripts/package-desktop.ts'),'--output-root',output],{cwd:root,env,windowsHide:true,maxBuffer:65536}).then(value=>({code:0,...value}),error=>({code:error.code as number,stdout:String(error.stdout),stderr:String(error.stderr)}));
 expect(result.code).not.toBe(0);expect(result.stderr).toMatch(/already exists|overwrite/i);expect(await readdir(root)).toEqual(['chosen-output','package.json']);expect(await readdir(output)).toEqual(['desktop-release-1.2.3']);expect(await readFile(join(release,'receipt.txt'),'utf8')).toBe('preserve this release');
});
