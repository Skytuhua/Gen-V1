import {describe,it,expect} from 'vitest';
import {runProcess} from '../packages/capabilities/process.ts';

const signal=()=>new AbortController().signal;
const node=(script:string,input?:string,timeoutMs=120_000)=>runProcess(process.execPath,['-e',script],process.cwd(),signal(),()=>{},timeoutMs,{},256*1024,input===undefined?{}:{input});

describe('runProcess options.input',()=>{
 it('pipes the input to a child reading stdin',async()=>{
  const script=`let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(JSON.parse(data))));`;
  const result=await node(script,'{"hello":"world","n":42}\n');
  expect(result).toMatchObject({status:'succeeded',exitCode:0,stdout:'{"hello":"world","n":42}'});
 });
 it('does not throw when a 2 MiB input is piped to a child that exits without reading',async()=>{
  const result=await node('process.exit(0)','x'.repeat(2*1024*1024));
  expect(result).toMatchObject({status:'succeeded',exitCode:0});
 });
 it('keeps stdin ignored for existing callers without input',async()=>{
  const script=`process.stdin.on('error',e=>process.stdout.write('err:'+e.code));process.stdin.on('end',()=>process.stdout.write('ended'));setTimeout(()=>process.stdout.write('still-running'),3000);setTimeout(()=>process.exit(0),150);`;
  const result=await runProcess(process.execPath,['-e',script],process.cwd(),signal(),()=>{});
  expect(result).toMatchObject({status:'succeeded',exitCode:0});
  expect(result.stdout).toBe('');
 });
 it('uses the provided label in progress messages',async()=>{
  const messages:string[]=[];
  await runProcess(process.execPath,['-e',''],process.cwd(),signal(),m=>messages.push(m),120_000,{},256*1024,{label:'hook "fmt" (PreToolUse)'});
  expect(messages.some(m=>m.includes('Started hook "fmt" (PreToolUse)'))).toBe(true);
 });
 it('keeps the default label when none is provided',async()=>{
  const messages:string[]=[];
  await runProcess(process.execPath,['-e',''],process.cwd(),signal(),m=>messages.push(m));
  expect(messages.some(m=>m.includes('Started node --test'))).toBe(true);
 });
 it('still kills the process tree on timeout when input is set',async()=>{
  const result=await node('setInterval(()=>{},1000)','ignored input',300);
  expect(result).toMatchObject({status:'failed',timedOut:true});
 });
});
