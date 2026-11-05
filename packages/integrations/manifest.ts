import {createHash} from 'node:crypto';
import {lstat,readFile} from 'node:fs/promises';
import {relative,resolve} from 'node:path';
import type {IntegrationId,IntegrationStatus} from '../contracts/integrations.ts';

export interface IntegrationFile {path:string;bytes:number;sha256:string;source:string;gitBlob?:string}
export interface IntegrationDefinition {
 id:IntegrationId;name:string;version:string;license:string[];
 upstream:{repository:string;pin:string};additionalSources?:{repository:string;pin:string}[];
 files:IntegrationFile[];skills:{name:string;path:string;description:string}[];
 capabilities:IntegrationStatus['capabilities'];
 runtime?:{kind:'node'|'python';entry:string;args:string[];package?:string;version:string};
}
export interface IntegrationManifest {version:1;createdAt:string;integrations:IntegrationDefinition[];bytes:number}
export const integrationIds=['humanizer','emil','impeccable','graphify','promptfoo','biome','superpowers','spec-kit','context7','ponytail'] as const;
export const sha256=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
export function payloadPath(root:string,path:string){
 if(!path||path.includes('\\')||path.includes(':')||path.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Invalid integration payload path');
 const target=resolve(root,...path.split('/'));if(relative(resolve(root),target).startsWith('..'))throw Error('Integration payload leaves its root');return target;
}
export async function ordinaryFile(path:string,maxBytes=64*1024*1024,allowPackageHardlinks=false){
 const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||!allowPackageHardlinks&&info.nlink!==1||info.size>maxBytes)throw Error('Integration payload requires bounded ordinary files: '+path);
 const data=await readFile(path);if(data.length!==info.size)throw Error('Integration payload changed while reading');return data;
}
/** pnpm dependencies can be hardlinked; native Biome exceeds source-file limits. */
export const dependencyFile=(path:string)=>ordinaryFile(path,256*1024*1024,true);
export async function readManifest(root:string):Promise<IntegrationManifest>{
 const value=JSON.parse((await ordinaryFile(resolve(root,'third-party/integrations/manifest.json'),4*1024*1024)).toString()) as IntegrationManifest;
 if(value.version!==1||value.integrations.length!==integrationIds.length||new Set(value.integrations.map(item=>item.id)).size!==integrationIds.length||integrationIds.some(id=>!value.integrations.some(item=>item.id===id)))throw Error('Bundled integration registry does not match the explicit allowlist');
 const paths=new Set<string>();for(const item of value.integrations)for(const file of item.files){payloadPath(root,file.path);if(paths.has(file.path)||!file.path.startsWith('third-party/integrations/')||!Number.isSafeInteger(file.bytes)||file.bytes<0||!/^([a-f0-9]{64})$/.test(file.sha256))throw Error('Invalid integration custody record');paths.add(file.path);}
 return value;
}
export async function verifyDefinition(root:string,item:IntegrationDefinition){
 for(const file of item.files){const data=await ordinaryFile(payloadPath(root,file.path));if(data.length!==file.bytes||sha256(data)!==file.sha256)throw Error('Integration payload checksum mismatch: '+file.path);}
}
