import {z} from 'zod';

const text=z.string().trim().min(1).max(1024);
const path=text.refine(value=>!value.startsWith('/')&&!/[\\:\u0000]/.test(value)&&value.split('/').every(part=>part!=='.'&&part!=='..'&&part!==''),'Expected a relative file path.');
const ownerSchema=z.object({projectId:text,threadId:text.optional(),workingCopyId:text});
const checkpointSchema=z.object({id:text,label:text,createdAt:z.iso.datetime(),provenance:text,revision:text,paths:z.array(path).max(500),fileCount:z.number().int().nonnegative()});
const listSchema=z.object({owner:ownerSchema,items:z.array(checkpointSchema).max(100),nextCursor:text.nullable(),retention:z.object({expiresAt:z.iso.datetime().optional(),maxEntries:z.number().int().positive().optional()})});
const fileSchema=z.object({path,oldPath:path.optional(),currentHash:text.nullable(),targetHash:text.nullable(),diff:z.object({before:z.string().max(1_000_000),after:z.string().max(1_000_000)}).nullable(),status:z.enum(['available','binary','missing','expired','denied']),restoreSupported:z.boolean()});
const reviewSchema=z.object({owner:ownerSchema,checkpointId:text,reviewId:text,checkpointRevision:text,workingCopyRevision:text,expiresAt:z.iso.datetime(),files:z.array(fileSchema).max(500)});

export type CheckpointOwner=z.infer<typeof ownerSchema>;
export type FileCheckpoint=z.infer<typeof checkpointSchema>;
export type CheckpointList=z.infer<typeof listSchema>;
export type CheckpointReview=z.infer<typeof reviewSchema>;
export const checkpointOwnerKey=(owner:CheckpointOwner)=>JSON.stringify([owner.projectId,owner.threadId??null,owner.workingCopyId]);
const sameOwner=(left:CheckpointOwner,right:CheckpointOwner)=>checkpointOwnerKey(left)===checkpointOwnerKey(right);

export function readCheckpointList(value:unknown,owner:CheckpointOwner):CheckpointList {
  const result=listSchema.parse(value);
  if(!sameOwner(result.owner,owner))throw Error('The checkpoint owner changed. Refresh History.');
  if(new Set(result.items.map(item=>item.id)).size!==result.items.length)throw Error('Duplicate checkpoint entries. Refresh History.');
  for(const item of result.items)if(new Set(item.paths).size!==item.paths.length||item.paths.length>item.fileCount)throw Error('Invalid checkpoint file list. Refresh History.');
  return result;
}
export function readCheckpointReview(value:unknown,owner:CheckpointOwner,checkpoint:FileCheckpoint):CheckpointReview {
  const result=reviewSchema.parse(value);
  if(!sameOwner(result.owner,owner)||result.checkpointId!==checkpoint.id||result.checkpointRevision!==checkpoint.revision)throw Error('The checkpoint revision changed. Return to History and refresh.');
  if(Date.parse(result.expiresAt)<=Date.now())throw Error('This review expired. Review the checkpoint again.');
  if(new Set(result.files.map(file=>file.path)).size!==result.files.length)throw Error('Duplicate review files. Review the checkpoint again.');
  if(result.files.some(file=>!checkpoint.paths.includes(file.path)))throw Error('The review returned an unexpected file. Refresh History.');
  return result;
}

/** Frontend seam only. No checkpoint service or restore API is connected. */
export interface FileCheckpointAdapter {
  available:boolean;
  list:(owner:CheckpointOwner,options:{cursor?:string;signal:AbortSignal})=>Promise<unknown>;
  review:(owner:CheckpointOwner,checkpoint:FileCheckpoint,options:{paths:string[];signal:AbortSignal})=>Promise<unknown>;
  restore:{readonly enabled:false;readonly reason:string};
}
const unavailable=async():Promise<never>=>{throw Error('File checkpoints are unavailable. No checkpoint service is connected.');};
export const disabledCheckpointAdapter:FileCheckpointAdapter={available:false,list:unavailable,review:unavailable,
  restore:{enabled:false,reason:'Restore is unavailable until checkpoint recovery is connected and its conflict, confirmation and receipt designs are approved.'},
};
