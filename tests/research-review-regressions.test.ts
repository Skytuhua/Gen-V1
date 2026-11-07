import {afterEach,expect,it,vi} from 'vitest';
import {researchFixture,context,command,textSource} from './research-fixture';

const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
async function fixture(){const f=await researchFixture();cleanups.push(f.close);return f;}
it('verifies one immutable material once for 500 exact passages without dropping citations',async()=>{
 const f=await fixture();await f.repository.command(textSource('large-source','x'.repeat(4*1024*1024)));const source=f.repository.source(context,'source-a'),ref={sourceId:source.id,revision:source.revision,sha256:source.sha256!,start:0,end:3};
 const reads=vi.spyOn(f.store,'get');await f.repository.command(command('many-citations','document.save',{documentId:'findings',kind:'findings',title:'Many exact passages',expectedRevision:0,body:'Complete finding.',citations:Array.from({length:500},()=>ref)}));
 expect(reads.mock.calls.filter(([kind])=>kind==='researchMaterial')).toHaveLength(1);expect(f.repository.document(context,'findings').citations).toHaveLength(500);
});
it('keeps verification separate for different exact revisions and hashes',async()=>{
 const f=await fixture();await f.repository.command(textSource('first','abc'));const one=f.repository.source(context,'source-a');await f.repository.command(textSource('second','xyz',1));const two=f.repository.source(context,'source-a');
 const refs=[one,two].map(source=>({sourceId:source.id,revision:source.revision,sha256:source.sha256!,start:0,end:3})),reads=vi.spyOn(f.store,'get');await f.repository.command(command('both','document.save',{documentId:'findings',kind:'findings',title:'Both revisions',expectedRevision:0,body:'Complete finding.',citations:refs}));
 expect(reads.mock.calls.filter(([kind])=>kind==='researchMaterial')).toHaveLength(2);expect(f.repository.document(context,'findings').citations.map(ref=>ref.status)).toEqual(['stale','current-capture']);
});
it('checks every range and UTF-8 boundary even after reusing verified material',async()=>{
 const f=await fixture();await f.repository.command(textSource('utf8','a\u20acb'));const source=f.repository.source(context,'source-a'),ref={sourceId:source.id,revision:source.revision,sha256:source.sha256!,start:0,end:1},before=f.store.sequence;
 for(const [id,last]of [['outside',{...ref,end:6}],['boundary',{...ref,start:2,end:3}]]as const)await expect(f.repository.command(command(id,'document.save',{documentId:id,kind:'findings',title:'Invalid final passage',expectedRevision:0,body:'Retain checks.',citations:[...Array.from({length:499},()=>ref),last]}))).rejects.toThrow();
 expect(f.store.sequence).toBe(before);
});
it('rejects multibyte cursor signatures as invalid input instead of throwing RangeError',async()=>{
 const f=await fixture(),cursor=Buffer.from('{}').toString('base64url')+'.'+'\u00e9'.repeat(43);
 expect(()=>f.repository.list(context,{kind:'sources',cursor})).toThrow(expect.objectContaining({code:'INVALID_CURSOR'}));
});
