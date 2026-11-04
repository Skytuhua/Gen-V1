import {describe,expect,it,vi} from 'vitest';
import {prepareEditorHandoff,registerEditorHandoff} from '../apps/web/src/editor-handoff';

describe('shared renderer editor handoff',()=>{
 it('retains every editor with the same artifact key and unregisters each independently',async()=>{
  const first=vi.fn(async()=>{}),second=vi.fn(async()=>{});
  const removeFirst=registerEditorHandoff('artifact:one',first),removeSecond=registerEditorHandoff('artifact:one',second);
  try{await prepareEditorHandoff();expect(first).toHaveBeenCalledOnce();expect(second).toHaveBeenCalledOnce();removeFirst();await prepareEditorHandoff();expect(first).toHaveBeenCalledOnce();expect(second).toHaveBeenCalledTimes(2);}finally{removeFirst();removeSecond();}
 });
 it('waits for every mounted editor before reporting a failed save',async()=>{
  let release!:()=>void;const saved=new Promise<void>(resolve=>{release=resolve;}),failure=Error('Save blocked');
  const removeFailure=registerEditorHandoff('widget',async()=>{throw failure;}),removePending=registerEditorHandoff('document',()=>saved);
  let settled=false;const preparing=prepareEditorHandoff().finally(()=>{settled=true;});
  try{await Promise.resolve();await Promise.resolve();expect(settled).toBe(false);release();await expect(preparing).rejects.toBe(failure);}finally{release();removeFailure();removePending();}
 });
 it('invokes the current guards on every handoff without retaining unmounted editors',async()=>{
  const save=vi.fn(async()=>{}),remove=registerEditorHandoff('web-editor',save);
  await prepareEditorHandoff();remove();await prepareEditorHandoff();expect(save).toHaveBeenCalledOnce();
 });
});
