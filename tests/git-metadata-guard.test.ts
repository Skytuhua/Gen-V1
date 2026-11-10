import {expect,it} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withPathGuard} from '../packages/core/file-access.ts';
it('pins a read-only Git config while allowing index creation in the same pinned metadata directory',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gen-git-guard-')),config=join(root,'config');await writeFile(config,'trusted');
 try{await withPathGuard([{path:root,leaf:false,allowChildWrites:true},{path:config,leaf:true,readOnly:true,allowChildWrites:true,childWriteRoot:root}],new AbortController().signal,async()=>{await writeFile(join(root,'index.lock'),'staged');await expect(writeFile(config,'changed')).rejects.toThrow();});expect(await readFile(config,'utf8')).toBe('trusted');}
 finally{await rm(root,{recursive:true,force:true,maxRetries:5});}
});
