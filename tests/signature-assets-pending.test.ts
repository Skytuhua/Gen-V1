import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {hasPendingDocumentAssets} from '../apps/web/src/signature-assets';

const records=new Map<string,string>();
beforeEach(()=>{
 records.clear();
 vi.stubGlobal('localStorage',{get length(){return records.size;},key:(index:number)=>[...records.keys()][index]??null,getItem:(key:string)=>records.get(key)??null});
});
afterEach(()=>vi.unstubAllGlobals());
const key=(thread:string,state:string)=>`harness:signature-assets:v1:${encodeURIComponent(thread)}:${encodeURIComponent(state)}`;

it('detects retained signature journals outside the currently mounted conversation',()=>{
 records.set(key('unmounted:owner','state'),JSON.stringify([{id:'pending',stateKey:'signature',base64:'YQ=='}]));
 expect(hasPendingDocumentAssets('different-owner')).toBe(false);
 expect(hasPendingDocumentAssets('unmounted:owner','state')).toBe(true);
 expect(hasPendingDocumentAssets()).toBe(true);
 records.clear();expect(hasPendingDocumentAssets()).toBe(false);
});

it('refuses an invalid retained signature journal when checking renderer-wide reload safety',()=>{
 records.set(key('unmounted-owner','state'),'{}');
 expect(()=>hasPendingDocumentAssets()).toThrow('pending signature journal is invalid');
});

it('preserves exact thread and state scope for existing callers',()=>{
 records.set(key('owner','one'),JSON.stringify([{id:'pending',stateKey:'signature',base64:'YQ=='}]));
 expect(hasPendingDocumentAssets('owner','one')).toBe(true);
 expect(hasPendingDocumentAssets('owner','two')).toBe(false);
 expect(hasPendingDocumentAssets('owner-extra')).toBe(false);
});
