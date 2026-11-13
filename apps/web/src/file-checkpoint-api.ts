import {z} from 'zod';

const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{ignoreBOM:true});
const utf8=(value:string)=>decoder.decode(encoder.encode(value))===value;
const bytes=(value:unknown)=>encoder.encode(JSON.stringify(value)).byteLength;
const id=z.string().regex(/^[a-zA-Z0-9:_.-]{1,200}$/),hash=z.string().regex(/^[a-f0-9]{64}$/),time=z.iso.datetime();
// The host still checks real storage roots and filesystem identities at admission.
const protectedNames=new Set(['.git','.gen','.gen-main','checkpoints','harness.sqlite','harness.sqlite-wal','harness.sqlite-shm','.host-lease.sqlite','.host-lease.sqlite-wal','.host-lease.sqlite-shm','pi','artifacts','official','accounts','hermes','github','git','integrations']);
const path=z.string().min(1).max(1024).refine(value=>utf8(value)&&encoder.encode(value).byteLength<=1024&&!/[\x00:\\]/.test(value)&&value.split('/').every(part=>part!==''&&part!=='.'&&part!=='..'&&!/[. ]$/.test(part)&&!protectedNames.has(part.toLowerCase())&&!/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)$/i.test(part.split('.')[0].replace(/ +$/,''))),'Expected an exact, safe project-relative path.');
const ownerSchema=z.strictObject({projectId:id,threadId:id.nullable(),workingCopyId:id.nullable(),binding:hash});
const checkpointSchema=z.strictObject({id,createdAt:time,label:z.string().refine(utf8),provenance:z.strictObject({kind:z.enum(['guarded_write','restore_backup']),operationId:id}),fileCount:z.number().int().min(0).max(100),revision:hash,expiresAt:time.nullable()});
const listSchema=z.strictObject({owner:ownerSchema,items:z.array(checkpointSchema).max(50),nextCursor:z.string().refine(utf8).nullable()});
const detailSchema=z.strictObject({owner:ownerSchema,checkpoint:checkpointSchema,files:z.array(z.strictObject({path,targetHash:hash.nullable(),bytes:z.number().int().nonnegative(),restorable:z.boolean(),reason:z.enum(['binary','too_large','unsupported']).nullable()})).max(100)});
const diff=z.string().max(128*1024).refine(value=>utf8(value)&&encoder.encode(value).byteLength<=128*1024,'Diff exceeds 128 KiB or contains malformed text.');
const reviewSchema=z.strictObject({owner:ownerSchema,reviewId:id,checkpointRevision:hash,files:z.array(z.strictObject({path,currentHash:hash.nullable(),targetHash:hash.nullable(),diff:diff.nullable(),diffTruncated:z.boolean(),status:z.enum(['ready','missing','binary','too_large','unreadable','unsupported'])})).max(100),expiresAt:time});

export type CheckpointOwner=z.infer<typeof ownerSchema>;
export type FileCheckpoint=z.infer<typeof checkpointSchema>;
export type CheckpointList=z.infer<typeof listSchema>;
export type CheckpointDetail=z.infer<typeof detailSchema>;
export type CheckpointReview=z.infer<typeof reviewSchema>;
export const checkpointOwnerKey=(owner:CheckpointOwner)=>JSON.stringify([owner.projectId,owner.threadId,owner.workingCopyId,owner.binding]);
const sameOwner=(left:CheckpointOwner,right:CheckpointOwner)=>checkpointOwnerKey(left)===checkpointOwnerKey(right);
const uniquePaths=(paths:readonly string[])=>new Set(paths.map(value=>value.toLowerCase())).size===paths.length;

export function readCheckpointList(value:unknown,owner:CheckpointOwner):CheckpointList {
  const result=listSchema.parse(value);
  if(!sameOwner(result.owner,owner))throw Error('The checkpoint owner changed. Refresh History.');
  if(new Set(result.items.map(item=>item.id)).size!==result.items.length)throw Error('Duplicate checkpoint entries. Refresh History.');
  return result;
}
export function readCheckpointDetail(value:unknown,owner:CheckpointOwner,checkpoint:FileCheckpoint):CheckpointDetail {
  const result=detailSchema.parse(value);
  if(!sameOwner(result.owner,owner)||result.checkpoint.id!==checkpoint.id||result.checkpoint.revision!==checkpoint.revision||result.checkpoint.fileCount!==checkpoint.fileCount)throw Error('The checkpoint revision changed. Return to History and refresh.');
  if(result.files.length!==checkpoint.fileCount)throw Error('Checkpoint detail is incomplete. Return to History and retry.');
  if(!uniquePaths(result.files.map(file=>file.path)))throw Error('Duplicate checkpoint file paths. Refresh History.');
  return result;
}
export function checkpointReviewPaths(detail:CheckpointDetail):string[][] {
  const paths=detail.files.map(file=>file.path);
  if(!paths.length)throw Error('No files available for review.');
  if(!detail.owner.threadId)throw Error('Choose the owning conversation before reviewing files.');
  const batches:string[][]=[[]];
  for(const path of paths){
    const current=batches[batches.length-1];
    if(current.length&&bytes({threadId:detail.owner.threadId,paths:[...current,path]})>32*1024)batches.push([path]);
    else current.push(path);
  }
  return batches;
}
export function readCheckpointReview(value:unknown,owner:CheckpointOwner,checkpoint:FileCheckpoint,paths:readonly string[]):CheckpointReview {
  const result=reviewSchema.parse(value);
  if(!sameOwner(result.owner,owner)||result.checkpointRevision!==checkpoint.revision)throw Error('The checkpoint revision changed. Return to History and refresh.');
  if(Date.parse(result.expiresAt)<=Date.now())throw Error('This review expired. Review the checkpoint again.');
  if(bytes(result)>512*1024)throw Error('Checkpoint review exceeds the 512 KiB response limit.');
  const requested=z.array(path).min(1).max(100).parse(paths);
  if(!uniquePaths(requested)||!uniquePaths(result.files.map(file=>file.path)))throw Error('Duplicate review files. Review the checkpoint again.');
  if(result.files.some(file=>!requested.includes(file.path)))throw Error('The review returned an unexpected file. Refresh History.');
  if(result.files.length!==requested.length)throw Error(`Checkpoint review is incomplete: ${result.files.length} of ${requested.length} requested files returned. Retry review.`);
  if(result.files.some(file=>file.status==='ready'&&(!file.currentHash||!file.targetHash)))throw Error('The review is missing hashes for a ready file. Retry review.');
  return result;
}

/** Frozen v1 read seam only; no checkpoint service or restore API is connected. */
export interface FileCheckpointAdapter {
  available:boolean;
  list:(owner:CheckpointOwner,options:{cursor?:string;signal:AbortSignal})=>Promise<unknown>;
  detail:(owner:CheckpointOwner,checkpoint:FileCheckpoint,options:{signal:AbortSignal})=>Promise<unknown>;
  review:(owner:CheckpointOwner,checkpoint:FileCheckpoint,options:{paths:string[];signal:AbortSignal})=>Promise<unknown>;
  restore:{readonly enabled:false;readonly reason:string};
}
const unavailable=async():Promise<never>=>{throw Error('File checkpoints are unavailable. No checkpoint service is connected.');};
export const disabledCheckpointAdapter:FileCheckpointAdapter={available:false,list:unavailable,detail:unavailable,review:unavailable,
  restore:{enabled:false,reason:'Restore is unavailable until checkpoint recovery is connected and its conflict, confirmation and receipt designs are approved.'},
};
