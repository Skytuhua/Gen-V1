import {randomUUID} from 'node:crypto';
import {spawn,type IPty} from 'node-pty';
import {z} from 'zod';
import {HarnessError} from '../contracts/index.ts';
import type {ProjectTools} from './tools.ts';
import {processEnvironment} from '../capabilities/process.ts';

interface Session{id:string;projectId:string;threadId?:string;path:string;pty:IPty;output:string;offset:number;exited:boolean;exitCode:number|null;done:Promise<void>}
const identifier=z.string().regex(/^[a-zA-Z0-9:_.-]{1,200}$/),dimension=z.number().int().min(2).max(500);
/** Host owns processes; renderer visibility and native reparenting do not own their lifetime. */
export class TerminalHost{
 private readonly sessions=new Map<string,Session>();
 constructor(private readonly projects:ProjectTools){
  const store=projects.store,unfinished=store.all<{id:string;exited:boolean}>('terminalSession').filter(item=>!item.exited);
  if(unfinished.length)store.internal('terminal.recovered',null,()=>{for(const item of unfinished)store.put('terminalSession',item.id,null,{...item,exited:true,exitCode:null,reason:'Host restarted; the previous terminal is no longer attached.'});});
 }
 async open(input:{projectId:string;threadId?:string;terminalId?:string;cols?:number;rows?:number;command?:string;program?:string;args?:string[];environment?:Record<string,string|undefined>}){
  const projectId=identifier.parse(input.projectId),threadId=input.threadId===undefined?undefined:identifier.parse(input.threadId),terminalId=input.terminalId?identifier.parse(input.terminalId):randomUUID();
  const binding=await this.projects.binding(projectId,threadId),existing=this.sessions.get(terminalId);
  if(existing){if(existing.projectId!==projectId||existing.threadId!==threadId||existing.path!==binding.path)throw new HarnessError('CAPABILITY_DENIED','Terminal belongs to another working copy.');return this.result(existing,0);}
  if(this.projects.store.get('terminalSession',terminalId))throw new HarnessError('TERMINAL_ENDED','This terminal ended. Open a new terminal.');
  if([...this.sessions.values()].filter(item=>!item.exited).length>=12)throw new HarnessError('TERMINAL_CAPACITY','Twelve terminals are already running. Stop one before opening another.');
  const shell=process.platform==='win32'?(process.env.COMSPEC??'C:/Windows/System32/cmd.exe'):(process.env.SHELL??'/bin/sh'),args=process.platform==='win32'?['/D','/Q']:[];
  const pty=spawn(input.program??shell,input.args??args,{name:'xterm-256color',cwd:binding.path,cols:dimension.parse(input.cols??100),rows:dimension.parse(input.rows??30),env:(input.environment??processEnvironment()) as Record<string,string>,useConpty:true});
  let finish!:()=>void;const session:Session={id:terminalId,projectId,...(threadId?{threadId}:{}),path:binding.path,pty,output:'',offset:0,exited:false,exitCode:null,done:new Promise<void>(resolve=>{finish=resolve;})};
  this.sessions.set(terminalId,session);this.persist(session);
  pty.onData(data=>{session.output+=data;if(session.output.length>512*1024){const remove=session.output.length-512*1024;session.output=session.output.slice(remove);session.offset+=remove;}});
  pty.onExit(event=>{session.exited=true;session.exitCode=event.exitCode;this.persist(session);finish();});
  if(input.command)pty.write(z.string().min(1).max(8000).parse(input.command)+'\r');
  return this.result(session,0);
 }
 private persist(session:Session){this.projects.store.internal('terminal.changed',session.threadId??null,()=>this.projects.store.put('terminalSession',session.id,session.threadId??null,{id:session.id,projectId:session.projectId,threadId:session.threadId,exited:session.exited,exitCode:session.exitCode}));}
 private result(session:Session,cursor:number){const start=Math.max(session.offset,cursor);return{id:session.id,projectId:session.projectId,threadId:session.threadId,output:session.output.slice(Math.max(0,start-session.offset)),start,cursor:session.offset+session.output.length,exited:session.exited,exitCode:session.exitCode};}
 private async owned(id:string,projectId:string,threadId?:string,stopping=false){const session=this.sessions.get(identifier.parse(id));if(!session){const old=this.projects.store.get<{projectId:string;threadId?:string}>('terminalSession',id);if(old&&old.projectId===projectId&&old.threadId===threadId)throw new HarnessError('TERMINAL_ENDED','The host restarted or this terminal ended. Open a new terminal.');throw new HarnessError('NOT_FOUND','Terminal is unavailable.');}if(session.projectId!==projectId||session.threadId!==threadId)throw new HarnessError('CAPABILITY_DENIED','Terminal belongs to another working copy.');if(!stopping){const binding=await this.projects.binding(projectId,threadId);if(session.path!==binding.path)throw new HarnessError('CAPABILITY_DENIED','Terminal belongs to another working copy.');}return session;}
 async read(id:string,projectId:string,threadId?:string,cursor=0){return this.result(await this.owned(id,projectId,threadId),z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(cursor));}
 async command(id:string,projectId:string,threadId:string|undefined,input:Record<string,unknown>){const session=await this.owned(id,projectId,threadId,input.type==='stop');if(input.type==='stop'){if(!session.exited){session.pty.kill();let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([session.done,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new HarnessError('TERMINAL_CANCEL_UNCONFIRMED','Terminal termination was not confirmed.')),5000);})]);}finally{clearTimeout(timer);}}}else{if(session.exited)throw new HarnessError('TERMINAL_ENDED','The terminal has exited.');if(input.type==='input')session.pty.write(z.string().max(64*1024).parse(input.data));else if(input.type==='resize')session.pty.resize(dimension.parse(input.cols),dimension.parse(input.rows));else throw new HarnessError('INVALID_INPUT','Unknown terminal action.');}return this.result(session,0);}
 async dispose(){const outcomes=await Promise.allSettled([...this.sessions.values()].filter(item=>!item.exited).map(item=>this.command(item.id,item.projectId,item.threadId,{type:'stop'})));const errors=outcomes.flatMap(item=>item.status==='rejected'?[item.reason]:[]);if(errors.length)throw new AggregateError(errors,'Terminal shutdown could not be confirmed.');}
}
