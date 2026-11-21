// Parses the Explorer "Open in Gen V1" launch argument from raw argv. Pure and
// platform-independent: never touches the filesystem, never expands or
// interpolates the path — enrollment validation stays with project connect.
export type OpenProjectArgsResult = {kind:'none'} | {kind:'open';path:string} | {kind:'invalid';reason:string};

const SWITCH='--open-project';
// Matches the existing project-connect path bound (packages/workspace/tools.ts).
const MAX_PATH=4096;
// Characters Windows forbids in file names. ':' is checked separately because
// the drive suffix uses it.
const FORBIDDEN=/["<>|?*]/;

function hasControlByte(value:string):boolean {
 for(let index=0;index<value.length;index++){const code=value.charCodeAt(index);if(code<32||code===127)return true;}
 return false;
}

function validateFolder(value:string):OpenProjectArgsResult {
 if(value.length>MAX_PATH)return {kind:'invalid',reason:'The folder path is too long.'};
 if(FORBIDDEN.test(value)||hasControlByte(value))return {kind:'invalid',reason:'The folder path contains characters Windows does not allow.'};
 if(value.slice(2).includes(':'))return {kind:'invalid',reason:'The folder path is not a valid Windows path.'};
 if(/^[a-zA-Z]:[\\/]/.test(value))return {kind:'open',path:value};
 if(/^\\\\/.test(value)){
  if(/^\\\\[?.]/.test(value))return {kind:'invalid',reason:'Device paths are not supported.'};
  if(!/^\\\\[^\\/]+\\[^\\/]+/.test(value))return {kind:'invalid',reason:'A UNC path needs both a server and a share.'};
  return {kind:'open',path:value};
 }
 return {kind:'invalid',reason:'The folder path must be an absolute Windows path.'};
}

export function parseOpenProjectArgs(argv:readonly string[]):OpenProjectArgsResult {
 const positions:number[]=[];
 argv.forEach((arg,index)=>{if(arg===SWITCH)positions.push(index);});
 if(positions.length>1)return {kind:'invalid',reason:'The launch contained more than one --open-project request.'};
 if(positions.length===0)return argv.some(arg=>arg.startsWith(SWITCH+'='))?{kind:'invalid',reason:'The --open-project value must be a separate argument.'}:{kind:'none'};
 const value=argv[positions[0]+1];
 if(value===undefined||value==='')return {kind:'invalid',reason:'The --open-project switch needs a folder path.'};
 if(value.startsWith('-'))return {kind:'invalid',reason:'The --open-project value must be a folder path, not a switch.'};
 return validateFolder(value);
}
