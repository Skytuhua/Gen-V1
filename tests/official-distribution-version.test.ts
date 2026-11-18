import {describe,expect,it} from 'vitest';
import {readOfficialVersion} from '../scripts/verify-official-distributions.ts';

describe('official distribution version verification',()=>{
 const probe=(source:string)=>readOfficialVersion({file:process.execPath,args:['-e',source,'--']},process.cwd(),{});
 it('rejects a successful process that did not report a version',async()=>{
  await expect(probe("process.stdout.write('  ')")).rejects.toThrow('Unexpected CLI version output.');
 });
 it('keeps a nonempty version from a successfully exited process',async()=>{
  await expect(probe("process.stdout.write('1.2.3\\n')")).resolves.toBe('1.2.3');
 });
});
