import {randomUUID} from 'node:crypto';
import {spawn,type IPty} from 'node-pty';
import {z} from 'zod';
import {HarnessError} from '../contracts/index.ts';
import type {ProjectTools} from './tools.ts';
import {processEnvironment} from '../capabilities/process.ts';
import {environmentSettingsFor} from '../core/environment-settings.ts';
import {getPreferences} from '../contracts/preferences.ts';
import {TerminalShellResolver,type TerminalShellInfo} from './terminal-shell.ts';

interface Session{id:string;projectId:string;threadId?:string;path:string;pty:IPty;output:string;offset:number;exited:boolean;exitCode:number|null;shell?:TerminalShellInfo;done:Promise<void>}
const isEnoent=(error:unknown)=>/ENOENT/.test(String((error as {code?:string;message?:string})?.code??(error as Error)?.message??error));
const identifier=z.string().regex(/^[a-zA-Z0-9:_.-]{1,200}$/),dimension=z.number().int().min(2).max(500);
/** Host owns processes; renderer visibility and native reparenting do not own their lifetime. */
export class TerminalHost{
 private readonly sessions=new Map<string,Session>();
 private readonly shells=new TerminalShellResolver();
 async shellCatalog(options:{refresh?:boolean;signal?:AbortSignal}={}){return this.shells.catalog(options);}
 constructor(private readonly projects:ProjectTools){
  const store=projects.store,unfinished=store.all<{id:string;exited:boolean}>('terminalSession').filter(item=>!item.exited);
  if(unfinished.length)store.internal('terminal.recovered',null,()=>{for(const item of unfinished)store.put('terminalSession',item.id,null,{...item,exited:true,exitCode:null,reason:'Host restarted; the previous terminal is no longer attached.'});});
 }
 async open(input:{projectId:string;threadId?:string;terminalId?:string;cols?:number;rows?:number;command?:string;program?:string;args?:string[];environment?:Record<string,string|undefined>}){
  const projectId=identifier.parse(input.projectId),threadId=input.threadId===undefined?undefined:identifier.parse(input.threadId),terminalId=input.terminalId?identifier.parse(input.terminalId):randomUUID();
  const command=input.command?z.string().min(1).max(8000).parse(input.command):undefined;
  const binding=await this.projects.binding(projectId,threadId),existing=this.sessions.get(terminalId);
  if(existing){if(existing.projectId!==projectId||existing.threadId!==threadId||existing.path!==binding.path)throw new HarnessError('CAPABILITY_DENIED','Terminal belongs to another working copy.');if(existing.exited)throw new HarnessError('TERMINAL_ENDED','This terminal ended. Open a new terminal.');return this.result(existing,0);}
  if(this.projects.store.get('terminalSession',terminalId))throw new HarnessError('TERMINAL_ENDED','This terminal ended. Open a new terminal.');
  if([...this.sessions.values()].filter(item=>!item.exited).length>=12)throw new HarnessError('TERMINAL_CAPACITY','Twelve terminals are already running. Stop one before opening another.');
  const shell=process.platform==='win32'?(process.env.COMSPEC??'C:/Windows/System32/cmd.exe'):(process.env.SHELL??'/bin/sh'),args=process.platform==='win32'?['/D','/Q']:[];
  const configured=!input.program&&!input.environment?await environmentSettingsFor(this.projects.store.dataDir).resolve(projectId):{};
  // Interactive opens resolve the saved shell selection once; trusted program
  // and command paths keep the legacy shell branch unchanged.
  const resolved=!input.program&&command===undefined?await this.shells.resolve(getPreferences(this.projects.store.get('settings','global')??{}).terminalShell,binding.path,configured):undefined;
  const currentBinding=await this.projects.binding(projectId,threadId);
  if(currentBinding.path!==binding.path)throw new HarnessError('CAPABILITY_DENIED','The project binding changed before the terminal could start.');
  // Secret resolution yields. Recheck ownership/capacity synchronously after
  // the final await so concurrent opens cannot orphan an extra process.
  const opened=this.sessions.get(terminalId);
  if(opened){if(opened.projectId!==projectId||opened.threadId!==threadId||opened.path!==binding.path)throw new HarnessError('CAPABILITY_DENIED','Terminal belongs to another working copy.');if(opened.exited)throw new HarnessError('TERMINAL_ENDED','This terminal ended. Open a new terminal.');return this.result(opened,0);}
  if(this.projects.store.get('terminalSession',terminalId))throw new HarnessError('TERMINAL_ENDED','This terminal ended. Open a new terminal.');
  if([...this.sessions.values()].filter(item=>!item.exited).length>=12)throw new HarnessError('TERMINAL_CAPACITY','Twelve terminals are already running. Stop one before opening another.');
  // Trusted integration programs retain their explicitly pinned environments.
  const spawnTerminal=(file:string,argv:string[],environment:Record<string,string>)=>spawn(file,argv,{name:'xterm-256color',cwd:resolved?.cwd??binding.path,cols:dimension.parse(input.cols??100),rows:dimension.parse(input.rows??30),env:environment,useConpty:true});
  const startError=(error:unknown,label:string)=>isEnoent(error)?(this.shells.invalidate(),new HarnessError('TERMINAL_SHELL_UNAVAILABLE',`${label} could not be started because its executable is missing. Choose another terminal shell in Settings.`)):new HarnessError('TERMINAL_START_FAILED',`${label} could not be started. Retry or choose another terminal shell in Settings.`);
  let pty:IPty;
  if(resolved){
   try{pty=spawnTerminal(resolved.file,resolved.args,{...processEnvironment(),...resolved.env} as Record<string,string>);}
   catch(first){
    // A default COMSPEC spawn that went missing retries system cmd once.
    if(resolved.retry&&isEnoent(first)){try{pty=spawnTerminal(resolved.retry.file,resolved.retry.args,{...processEnvironment(),...resolved.env} as Record<string,string>);}catch(second){throw startError(second,resolved.shell.label);}}
    else throw startError(first,resolved.shell.label);
   }
  }else pty=spawnTerminal(input.program??shell,input.args??args,(input.environment??{...processEnvironment(),...configured}) as Record<string,string>);
  let finish!:()=>void;const session:Session={id:terminalId,projectId,...(threadId?{threadId}:{}),path:binding.path,pty,output:'',offset:0,exited:false,exitCode:null,...(resolved?{shell:resolved.shell}:{}),done:new Promise<void>(resolve=>{finish=resolve;})};
  this.sessions.set(terminalId,session);this.persist(session);
  pty.onData(data=>{
   session.output+=data;
   if(session.output.length>512*1024){
    let remove=session.output.length-512*1024;
    const before=session.output.charCodeAt(remove-1),after=session.output.charCodeAt(remove);
    // Preserve the stream's UTF-16 cursor units without returning half a character.
    if(before>=0xd800&&before<=0xdbff&&after>=0xdc00&&after<=0xdfff)remove++;
    session.output=session.output.slice(remove);session.offset+=remove;
   }
  });
  pty.onExit(event=>{
   session.exited=true;session.exitCode=event.exitCode;
   // Native exit is definitive even if the separate durable update fails.
   finish();
   try{this.persist(session);}catch{process.stderr.write('Gen V1 could not persist terminal exit state.\n');}
   this.evictExited(session);
  });

  if(command!==undefined)pty.write(command+'\r');
  return this.result(session,0);
 }
 private persist(session:Session){this.projects.store.internal('terminal.changed',session.threadId??null,()=>this.projects.store.put('terminalSession',session.id,session.threadId??null,{id:session.id,projectId:session.projectId,threadId:session.threadId,exited:session.exited,exitCode:session.exitCode,...(session.shell?{shell:session.shell}:{})}));}
 /** Exited sessions keep up to 512 KiB of scrollback each; retain only the newest few so the map stays bounded. Reads of evicted ids still resolve TERMINAL_ENDED through the durable record. */
 private evictExited(session:Session){
  // Active terminals may outlive many later starts. Record recency when they exit.
  this.sessions.delete(session.id);this.sessions.set(session.id,session);
  const dead=[...this.sessions.entries()].filter(([,session])=>session.exited);
  for(const [id]of dead.slice(0,Math.max(0,dead.length-48)))this.sessions.delete(id);
 }
 private result(session:Session,cursor:number){const end=session.offset+session.output.length,start=Math.min(end,Math.max(session.offset,cursor));return{id:session.id,projectId:session.projectId,threadId:session.threadId,output:session.output.slice(start-session.offset),start,cursor:end,exited:session.exited,exitCode:session.exitCode,...(session.shell?{shell:session.shell}:{})};}
 private async owned(id:string,projectId:string,threadId?:string,stopping=false){const session=this.sessions.get(identifier.parse(id));if(!session){const old=this.projects.store.get<{projectId:string;threadId?:string}>('terminalSession',id);if(old&&old.projectId===projectId&&old.threadId===threadId)throw new HarnessError('TERMINAL_ENDED','The host restarted or this terminal ended. Open a new terminal.');throw new HarnessError('NOT_FOUND','Terminal is unavailable.');}if(session.projectId!==projectId||session.threadId!==threadId)throw new HarnessError('CAPABILITY_DENIED','Terminal belongs to another working copy.');if(!stopping){const binding=await this.projects.binding(projectId,threadId);if(session.path!==binding.path)throw new HarnessError('CAPABILITY_DENIED','Terminal belongs to another working copy.');}return session;}
 async read(id:string,projectId:string,threadId?:string,cursor=0){return this.result(await this.owned(id,projectId,threadId),z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(cursor));}
 async command(id:string,projectId:string,threadId:string|undefined,input:Record<string,unknown>){const session=await this.owned(id,projectId,threadId,input.type==='stop');if(input.type==='stop'){if(!session.exited){session.pty.kill();let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([session.done,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new HarnessError('TERMINAL_CANCEL_UNCONFIRMED','Terminal termination was not confirmed.')),5000);})]);}finally{clearTimeout(timer);}}}else{if(session.exited)throw new HarnessError('TERMINAL_ENDED','The terminal has exited.');if(input.type==='input')session.pty.write(z.string().max(64*1024).parse(input.data));else if(input.type==='resize')session.pty.resize(dimension.parse(input.cols),dimension.parse(input.rows));else throw new HarnessError('INVALID_INPUT','Unknown terminal action.');}return this.result(session,0);}
 async dispose(){const outcomes=await Promise.allSettled([...this.sessions.values()].filter(item=>!item.exited).map(item=>this.command(item.id,item.projectId,item.threadId,{type:'stop'})));const errors=outcomes.flatMap(item=>item.status==='rejected'?[item.reason]:[]);if(errors.length)throw new AggregateError(errors,'Terminal shutdown could not be confirmed.');}
}
