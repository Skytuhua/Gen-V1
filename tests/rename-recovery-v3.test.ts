import {it,expect,afterEach} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {CodeIntelligence,type LanguageServerAdapter,type LspWorkspaceEdit} from '../packages/core/code-intelligence.ts';
import {renamePlanV1Schema} from '../packages/contracts/code-intelligence.ts';

const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const dirs:string[]=[];
function tempDir(prefix:string){const dir=mkdtempSync(join(tmpdir(),prefix));dirs.push(dir);return dir;}
const disposables:{dispose():Promise<void>}[]=[];
afterEach(async()=>{for(const d of disposables.splice(0))await d.dispose();for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});

const descriptor={language:'typescript',executable:'/approved/tsserver',argv:['--stdio'],configDigest:'a'.repeat(64)};

class RenameAdapter implements LanguageServerAdapter{
 readonly serverIdentity='rename-server-1';
 readonly encoding:'UTF16'='UTF16';
 edit:LspWorkspaceEdit={};
 async openDocument(){}
 async changeDocument(){}
 async closeDocument(){}
 async pullDiagnostics(){return[];}
 async navigate(){return null;}
 async rename(){return this.edit;}
 async dispose(){}
}

const file=(root:string,name:string)=>join(root,name);
const uri=(path:string)=>pathToFileURL(path).href;
const signal=()=>new AbortController().signal;

function planInput(root:string,path:string,text:string,overrides:Record<string,unknown>={}){
 return{root,descriptor,profileDigest:'p'.repeat(64),path,language:'typescript',
  position:{line:0,character:7},newName:'beta2',grantedRoots:[root],
  workspaceIdentity:'ws-1',approvalId:'approval-1',signal:signal(),text,afterDigest:sha(text),...overrides};
}

it('rename plans reject resource operations and ungranted roots',async()=>{
 const root=tempDir('rename-root-');
 writeFileSync(file(root,'a.ts'),'const alpha = 1;\n');
 writeFileSync(file(root,'b.ts'),'const alpha = 2;\n');
 const adapter=new RenameAdapter();
 const ci=new CodeIntelligence(()=>adapter);
 disposables.push(ci);
 const text=readFileSync(file(root,'a.ts'),'utf8');
 // Resource operations (create/delete/move) are not a text edit — rejected.
 adapter.edit={documentChanges:[{kind:'create',uri:uri(file(root,'new.ts'))}]};
 await expect(ci.planRename(planInput(root,file(root,'a.ts'),text))).rejects.toThrowError(/resource operations/i);
 adapter.edit={documentChanges:[{kind:'rename',oldUri:uri(file(root,'a.ts')),newUri:uri(file(root,'c.ts'))}]};
 await expect(ci.planRename(planInput(root,file(root,'a.ts'),text))).rejects.toThrowError(/resource operations/i);
 // A URI outside every granted root is refused, not sanitized.
 const outside=tempDir('rename-outside-');
 writeFileSync(file(outside,'o.ts'),'const alpha = 3;\n');
 adapter.edit={changes:{[uri(file(outside,'o.ts'))]:[{range:{start:{line:0,character:6},end:{line:0,character:11}},newText:'beta2'}]}};
 await expect(ci.planRename(planInput(root,file(root,'a.ts'),text))).rejects.toThrowError(/granted roots/i);
});

it('a valid plan binds source versions and exact preimages for every target',async()=>{
 const root=tempDir('rename-root-');
 const a=file(root,'a.ts'),b=file(root,'b.ts');
 const aText='const alpha = 1;\n',bText='const alpha = 2;\n';
 writeFileSync(a,aText);writeFileSync(b,bText);
 const adapter=new RenameAdapter();
 adapter.edit={changes:{
  [uri(a)]:[{range:{start:{line:0,character:6},end:{line:0,character:11}},newText:'beta2'}],
  [uri(b)]:[{range:{start:{line:0,character:6},end:{line:0,character:11}},newText:'beta2'}],
 }};
 const ci=new CodeIntelligence(()=>adapter);
 disposables.push(ci);
 const plan=await ci.planRename(planInput(root,a,aText));
 expect(renamePlanV1Schema.parse(plan)).toEqual(plan);
 expect(plan.textEdits).toHaveLength(2);
 expect(plan.expectedBeforeDigests).toEqual([
  {path:a,digest:sha(aText)},{path:b,digest:sha(bText)},
 ]);
 expect(plan.exactApprovalId).toBe('approval-1');
});

it('guarded apply writes a durable journal and backups before the first change',async()=>{
 const root=tempDir('rename-root-');
 const journal=tempDir('rename-journal-');
 const a=file(root,'a.ts'),b=file(root,'b.ts');
 const aText='const alpha = 1;\n',bText='const alpha = 2;\n';
 writeFileSync(a,aText);writeFileSync(b,bText);
 const adapter=new RenameAdapter();
 adapter.edit={changes:{
  [uri(a)]:[{range:{start:{line:0,character:6},end:{line:0,character:11}},newText:'beta2'}],
  [uri(b)]:[{range:{start:{line:0,character:6},end:{line:0,character:11}},newText:'beta2'}],
 }};
 const ci=new CodeIntelligence(()=>adapter);
 disposables.push(ci);
 const plan=await ci.planRename(planInput(root,a,aText));
 // Approval must match exactly.
 await expect(ci.applyRename({plan,approvalId:'wrong',journalRoot:journal,grantedRoots:[root],signal:signal()})).rejects.toThrowError(/approval/i);
 const result=await ci.applyRename({plan,approvalId:'approval-1',journalRoot:journal,grantedRoots:[root],signal:signal()});
 expect(result.state).toBe('APPLIED');
 expect(result.entries.map(e=>e.disposition)).toEqual(['Applied','Applied']);
 expect(readFileSync(a,'utf8')).toBe('const beta2 = 1;\n');
 expect(readFileSync(b,'utf8')).toBe('const beta2 = 2;\n');
 // Journal and backups persist on disk.
 const planDir=join(journal,'code-intelligence','rename',plan.planId);
 expect(existsSync(join(planDir,'journal.json'))).toBe(true);
 const backups=readdirSync(planDir).filter(n=>n.startsWith('backup-'));
 expect(backups).toHaveLength(2);
 const recorded=JSON.parse(readFileSync(join(planDir,'journal.json'),'utf8'));
 expect(recorded.resolved).toBe(true);
});

it('a changed preimage stops apply before any write; approval is not enough',async()=>{
 const root=tempDir('rename-root-');
 const journal=tempDir('rename-journal-');
 const a=file(root,'a.ts');
 const aText='const alpha = 1;\n';
 writeFileSync(a,aText);
 const adapter=new RenameAdapter();
 adapter.edit={changes:{[uri(a)]:[{range:{start:{line:0,character:6},end:{line:0,character:11}},newText:'beta2'}]}};
 const ci=new CodeIntelligence(()=>adapter);
 disposables.push(ci);
 const plan=await ci.planRename(planInput(root,a,aText));
 writeFileSync(a,'const alpha = 99;\n'); // external change after planning
 await expect(ci.applyRename({plan,approvalId:'approval-1',journalRoot:journal,grantedRoots:[root],signal:signal()})).rejects.toThrowError(/changed before apply|PRECONDITION/i);
 expect(readFileSync(a,'utf8')).toBe('const alpha = 99;\n');
});

it('post-crash reconcile restores only paths still matching the written postimage',async()=>{
 const root=tempDir('rename-root-');
 const journal=tempDir('rename-journal-');
 const a=file(root,'a.ts'),b=file(root,'b.ts');
 const aText='const alpha = 1;\n',bText='const alpha = 2;\n';
 writeFileSync(a,aText);writeFileSync(b,bText);
 const adapter=new RenameAdapter();
 adapter.edit={changes:{
  [uri(a)]:[{range:{start:{line:0,character:6},end:{line:0,character:11}},newText:'beta2'}],
  [uri(b)]:[{range:{start:{line:0,character:6},end:{line:0,character:11}},newText:'beta2'}],
 }};
 const ci=new CodeIntelligence(()=>adapter);
 disposables.push(ci);
 const plan=await ci.planRename(planInput(root,a,aText));
 await ci.applyRename({plan,approvalId:'approval-1',journalRoot:journal,grantedRoots:[root],signal:signal()});
 // Simulate a crash after writes but before journal resolution.
 const journalPath=join(journal,'code-intelligence','rename',plan.planId,'journal.json');
 const recorded=JSON.parse(readFileSync(journalPath,'utf8'));
 recorded.resolved=false;
 writeFileSync(journalPath,JSON.stringify(recorded));
 // Recovery restores both files to their preimages (bytes still match postimage).
 const recovered=await ci.recoverRename({journalRoot:journal,planId:plan.planId,signal:signal()});
 expect(recovered.state).toBe('RECOVERED');
 expect(recovered.entries.map(e=>e.disposition)).toEqual(['Restored','Restored']);
 expect(readFileSync(a,'utf8')).toBe(aText);
 expect(readFileSync(b,'utf8')).toBe(bText);
});

it('an external edit of a renamed file stops recovery with PARTIAL_RECOVERY_REQUIRED',async()=>{
 const root=tempDir('rename-root-');
 const journal=tempDir('rename-journal-');
 const a=file(root,'a.ts'),b=file(root,'b.ts');
 const aText='const alpha = 1;\n',bText='const alpha = 2;\n';
 writeFileSync(a,aText);writeFileSync(b,bText);
 const adapter=new RenameAdapter();
 adapter.edit={changes:{
  [uri(a)]:[{range:{start:{line:0,character:6},end:{line:0,character:11}},newText:'beta2'}],
  [uri(b)]:[{range:{start:{line:0,character:6},end:{line:0,character:11}},newText:'beta2'}],
 }};
 const ci=new CodeIntelligence(()=>adapter);
 disposables.push(ci);
 const plan=await ci.planRename(planInput(root,a,aText));
 await ci.applyRename({plan,approvalId:'approval-1',journalRoot:journal,grantedRoots:[root],signal:signal()});
 const journalPath=join(journal,'code-intelligence','rename',plan.planId,'journal.json');
 const recorded=JSON.parse(readFileSync(journalPath,'utf8'));
 recorded.resolved=false;
 writeFileSync(journalPath,JSON.stringify(recorded));
 writeFileSync(a,'const beta2 = 1;\n// external edit\n'); // user changed it post-rename
 const result=await ci.recoverRename({journalRoot:journal,planId:plan.planId,signal:signal()});
 expect(result.state).toBe('PARTIAL_RECOVERY_REQUIRED');
 const aEntry=result.entries.find(e=>e.path===a)!;
 const bEntry=result.entries.find(e=>e.path===b)!;
 expect(aEntry.disposition).toBe('Conflict');
 expect(bEntry.disposition).toBe('Restored');
 // The external edit is never overwritten.
 expect(readFileSync(a,'utf8')).toBe('const beta2 = 1;\n// external edit\n');
 expect(readFileSync(b,'utf8')).toBe(bText);
 // Backups stay on disk for manual reconciliation.
 expect(readdirSync(join(journal,'code-intelligence','rename',plan.planId)).filter(n=>n.startsWith('backup-')).length).toBe(2);
});
