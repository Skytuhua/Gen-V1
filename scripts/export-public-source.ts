import {copyFile,lstat,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {assertPublicPackageFiles,publicSourceFiles} from './public-source.ts';
const [targetArg,receiptArg]=process.argv.slice(2);if(!targetArg||!receiptArg)throw Error('Usage: export-public-source <new-checkout-directory> <private-receipt-path>');
const source=resolve('.'),target=resolve(targetArg),receipt=resolve(receiptArg);
if(source===target||target.startsWith(source+'/')||target.startsWith(source+'\\'))throw Error('Choose a separate empty source destination.');
await mkdir(target,{recursive:true});const existing=await readdir(target);if(existing.some(name=>name!=='.git'))throw Error('The source destination is not empty. Existing checkouts are retained.');
assertPublicPackageFiles(publicSourceFiles,'source');
const files:{path:string;bytes:number;sha256:string}[]=[];
for(const path of publicSourceFiles){const input=join(source,path),info=await lstat(input);if(!info.isFile()||info.isSymbolicLink())throw Error('Public source input must be an ordinary file: '+path);const bytes=await readFile(input),output=join(target,path);await mkdir(dirname(output),{recursive:true});await copyFile(input,output);const hash=createHash('sha256').update(bytes).digest('hex');if(createHash('sha256').update(await readFile(output)).digest('hex')!==hash)throw Error('Source changed during export: '+path);files.push({path,bytes:bytes.length,sha256:hash});}
for(const file of files)if(createHash('sha256').update(await readFile(join(source,file.path))).digest('hex')!==file.sha256)throw Error('Source changed during export: '+file.path);
await mkdir(dirname(receipt),{recursive:true});await writeFile(receipt,JSON.stringify({createdAt:new Date().toISOString(),source,target,files,totalBytes:files.reduce((sum,file)=>sum+file.bytes,0),verified:true},null,2),{flag:'wx'});
process.stdout.write(JSON.stringify({target,files:files.length,receipt})+'\n');
