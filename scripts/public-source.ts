import manifest from './public-source-files.json';

/** Exact reviewed source inputs. New files require an explicit manifest edit;
 * discovering a file in the working tree never grants permission to publish it. */
export const publicSourceFiles:readonly string[]=Object.freeze([...manifest.source]);
export const publicRuntimeSourceFiles:readonly string[]=Object.freeze([...manifest.runtime]);
const source=new Set(publicSourceFiles),runtime=new Set(publicRuntimeSourceFiles);

function sourcePath(path:string):string|null {
  if(typeof path!=='string'||!path||path.length>1024||/[\u0000-\u001f\u007f:%?#*<>|"]/.test(path))return null;
  const value=path.replaceAll('\\','/');
  if(value.startsWith('/')||value.split('/').some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part)))return null;
  return value;
}

export function publicSourceAllowed(path:string):boolean {const value=sourcePath(path);return value!==null&&source.has(value);}
export function publicRuntimeSourceAllowed(path:string):boolean {const value=sourcePath(path);return value!==null&&runtime.has(value);}

/** Validates source inputs before copying. Built assets, dependencies and native
 * distributions have their own locked payload inventories; they are not source. */
export function assertPublicPackageFiles(files:Iterable<string>,kind:'source'|'runtime'='runtime'):void {
  if(kind!=='source'&&kind!=='runtime')throw Error('Unknown public source payload kind.');
  const allowed=kind==='runtime'?publicRuntimeSourceAllowed:publicSourceAllowed;
  for(const file of files)if(!allowed(file))throw Error(`Source is not in the reviewed public ${kind} allowlist: ${file}`);
}

if(manifest.version!==1||source.size!==publicSourceFiles.length||runtime.size!==publicRuntimeSourceFiles.length||publicSourceFiles.some(path=>sourcePath(path)!==path)||publicRuntimeSourceFiles.some(path=>!source.has(path)))throw Error('The reviewed public source manifest is invalid.');
