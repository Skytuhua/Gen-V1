import {expect,it} from 'vitest';
import {validateSurface} from '../packages/ui-catalog';

const spec=(props:Record<string,unknown>)=>({root:'doc',elements:{doc:{type:'Document',props}}});
it('admits a window document with a durable draft key without changing legacy documents',()=>{
 expect(()=>validateSurface(spec({title:'Handoff',dataBinding:'handoff',presentation:'window',editableStateKey:'handoffDraft',linkLabel:'Open handoff'}))).not.toThrow();
 expect(()=>validateSurface(spec({title:'Agreement',resourceId:'agreement',download:true}))).not.toThrow();
});
it('rejects editable inline documents and malformed window state keys',()=>{
 expect(()=>validateSurface(spec({text:'Draft',editableStateKey:'draft'}))).toThrow();
 expect(()=>validateSurface(spec({text:'Draft',presentation:'window',editableStateKey:'__proto__'}))).toThrow();
 expect(()=>validateSurface(spec({text:'Draft',presentation:'window',script:'execute'}))).toThrow();
});
