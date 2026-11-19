import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {
 EditPreviewRegistry,parseFinalArguments,locateAnchor,verifyEditPreimage,
} from '../packages/core/edit-preview.ts';
import {editPreviewV1Schema,CODE_INTELLIGENCE_LIMITS} from '../packages/contracts/code-intelligence.ts';
import {HarnessError} from '../packages/contracts/index.ts';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const schemaDigest=sha('{"type":"object","properties":{"files":{}}}');
const args=(path:string,content:string)=>JSON.stringify({files:[{path,content}]});
const owner='run-1';

it('a streamed preview never authorizes a write until complete validated arguments arrive',()=>{
 const registry=new EditPreviewRegistry();
 const preview=registry.begin(owner,schemaDigest);
 expect(editPreviewV1Schema.parse(preview)).toEqual(preview);
 expect(preview.state).toBe('STREAMING_UNAPPLIED');
 expect(preview.finalArgumentsDigest).toBeNull();
 const raw=args('a.ts','const a=2;\n');
 // Partial frames are inert: mid-JSON produces no target.
 registry.append(preview.previewId,owner,raw.slice(0,20));
 expect(registry.get(preview.previewId,owner)!.state).toBe('STREAMING_UNAPPLIED');
 registry.append(preview.previewId,owner,raw.slice(20));
 const sealed=registry.seal(preview.previewId,owner,()=>sha('old'));
 expect(sealed.state).toBe('READY_UNAPPLIED');
 expect(sealed.targetFiles[0]!.beforeDigest).toBe(sha('old'));
 expect(sealed.targetFiles[0]!.proposedDigest).toBe(sha('const a=2;\n'));
 // A changed final arguments digest invalidates the approval path.
 expect(()=>registry.validateFinal(preview.previewId,owner,sha('different'))).toThrowError(HarnessError);
 expect(registry.get(preview.previewId,owner)!.state).toBe('INVALID');
});

it('matching final arguments validate, then settle records APPLIED or CONFLICT',()=>{
 const registry=new EditPreviewRegistry();
 const raw=args('a.ts','const a=2;\n');
 const preview=registry.begin(owner,schemaDigest);
 registry.append(preview.previewId,owner,raw);
 registry.seal(preview.previewId,owner,()=>null);
 const valid=registry.validateFinal(preview.previewId,owner,sha(raw));
 expect(valid.state).toBe('READY_UNAPPLIED');
 const applied=registry.settle(preview.previewId,owner,'APPLIED');
 expect(applied.state).toBe('APPLIED');
 // A conflict preimage surfaces CONFLICT, never a silent write.
 const second=registry.begin(owner,schemaDigest);
 registry.append(second.previewId,owner,raw);
 registry.seal(second.previewId,owner,()=>null);
 registry.validateFinal(second.previewId,owner,sha(raw));
 expect(registry.settle(second.previewId,owner,'CONFLICT').state).toBe('CONFLICT');
});

it('open previews are bounded to 8 per run and 256 KiB aggregate',()=>{
 const registry=new EditPreviewRegistry();
 const ids:string[]=[];
 for(let i=0;i<CODE_INTELLIGENCE_LIMITS.openPreviewsPerRun;i++)ids.push(registry.begin(owner,schemaDigest).previewId);
 expect(()=>registry.begin(owner,schemaDigest)).toThrowError(/open edit previews/i);
 for(const id of ids)registry.discard(id,owner);
 // Aggregate bound: chunks totaling over 256 KiB are rejected.
 const preview=registry.begin(owner,schemaDigest);
 let rejected=false;
 try{
  for(let i=0;i<CODE_INTELLIGENCE_LIMITS.previewAggregateBytes/64/1024+1;i++)
   registry.append(preview.previewId,owner,'x'.repeat(64*1024));
 }catch(error){rejected=error instanceof HarnessError;}
 expect(rejected).toBe(true);
 expect(registry.get(preview.previewId,owner)!.state).toBe('INVALID');
});

it('cancellation discards the preview entirely',()=>{
 const registry=new EditPreviewRegistry();
 const preview=registry.begin(owner,schemaDigest);
 registry.append(preview.previewId,owner,args('a.ts','x'));
 registry.discard(preview.previewId,owner);
 expect(registry.get(preview.previewId,owner)).toBeNull();
 const again=registry.begin(owner,schemaDigest);
 registry.discardOwner(owner);
 expect(registry.get(again.previewId,owner)).toBeNull();
});

it('the parser extracts only complete targets; partial arguments produce none',()=>{
 expect(()=>parseFinalArguments('{"files":[{"path":"a.ts","content":"x"')).toThrowError(HarnessError);
 expect(()=>parseFinalArguments('[1,2]')).toThrowError(HarnessError);
 expect(()=>parseFinalArguments('{"files":[]}')).toThrowError(HarnessError);
 const parsed=parseFinalArguments(args('a.ts','hello'));
 expect(parsed.targets[0]!.path).toBe('a.ts');
 expect(parsed.targets[0]!.proposedContent).toBe('hello');
 expect(parsed.digest).toBe(sha(args('a.ts','hello')));
});

it('anchors and hashlines are locators, not authorization: ambiguous or missing matches are rejected',()=>{
 const content='alpha\nbeta\nalpha\ngamma\n';
 expect(locateAnchor(content,'beta\n')).toBeGreaterThan(0);
 expect(()=>locateAnchor(content,'missing')).toThrowError(/not found/);
 expect(()=>locateAnchor(content,'alpha')).toThrowError(/ambiguous/);
 expect(()=>locateAnchor(content,'')).toThrowError(HarnessError);
 verifyEditPreimage(Buffer.from(content),sha(content));
 expect(()=>verifyEditPreimage(Buffer.from('changed'),sha(content))).toThrowError(/changed before/i);
});

it('an unvalidated preview cannot settle APPLIED',()=>{
 const registry=new EditPreviewRegistry();
 const raw=args('a.ts','const a=2;\n');
 const preview=registry.begin(owner,schemaDigest);
 registry.append(preview.previewId,owner,raw);
 registry.seal(preview.previewId,owner,()=>null);
 // The approval gate stands between seal and apply; skipping it is refused.
 expect(()=>registry.settle(preview.previewId,owner,'APPLIED')).toThrowError(/validated|PRECONDITION/i);
 // A conflict outcome stays reachable without validation.
 expect(registry.settle(preview.previewId,owner,'CONFLICT').state).toBe('CONFLICT');
});

it('previews are owner-scoped',()=>{
 const registry=new EditPreviewRegistry();
 const preview=registry.begin(owner,schemaDigest);
 expect(registry.get(preview.previewId,'run-2')).toBeNull();
 expect(()=>registry.append(preview.previewId,'run-2','x')).toThrowError(HarnessError);
});

it('closed previews release their aggregate and memory budget',()=>{
 const raw=args('a.ts','x'.repeat(40)),bytes=Buffer.byteLength(raw);
 const limits={...CODE_INTELLIGENCE_LIMITS,previewAggregateBytes:Math.floor(bytes*1.5),previewBufferBytes:bytes*4};
 const registry=new EditPreviewRegistry(limits);
 const first=registry.begin(owner,schemaDigest);
 registry.append(first.previewId,owner,raw);
 registry.seal(first.previewId,owner,()=>null);
 registry.validateFinal(first.previewId,owner,sha(raw));
 expect(registry.settle(first.previewId,owner,'APPLIED').state).toBe('APPLIED');
 // The settled preview keeps its history row but no longer consumes the
 // aggregate budget reserved for open previews.
 const second=registry.begin(owner,schemaDigest);
 expect(registry.append(second.previewId,owner,raw).state).toBe('STREAMING_UNAPPLIED');
 expect(registry.list(owner).map(preview=>preview.state)).toEqual(['APPLIED','STREAMING_UNAPPLIED']);
});

it('a failed final seal invalidates an incomplete preview and frees its slot for a new edit',()=>{
 const registry=new EditPreviewRegistry();
 for(let index=1;index<CODE_INTELLIGENCE_LIMITS.openPreviewsPerRun;index++)registry.begin(owner,schemaDigest);
 const preview=registry.begin(owner,schemaDigest);
 registry.append(preview.previewId,owner,'{"files":');
 expect(()=>registry.seal(preview.previewId,owner,()=>null)).toThrowError(/not valid JSON/);
 expect(registry.get(preview.previewId,owner)).toMatchObject({
  state:'INVALID',finalArgumentsDigest:null,targetFiles:[],
 });
 const retry=registry.begin(owner,schemaDigest);
 registry.append(retry.previewId,owner,args('a.ts','complete'));
 expect(registry.seal(retry.previewId,owner,()=>null).state).toBe('READY_UNAPPLIED');
});
