import {z} from 'zod';
const forbidden=new Set(['__proto__','prototype','constructor']);
const key=z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_-]{0,127}$/).refine(value=>!forbidden.has(value));
const id=z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_.:-]{0,127}$/).refine(value=>!forbidden.has(value));
const label=z.string().trim().min(1).max(200),source=z.string().max(4000).optional();
const scalar=z.union([z.string().max(2000),z.number().finite(),z.boolean(),z.null()]);
const actionProps={dataBinding:key,stateKey:key,actionId:key.optional(),actionLabel:label.optional()};
export const INTERACTION_SCHEMAS={ReviewQueue:z.strictObject(actionProps),EditableTable:z.strictObject(actionProps),ParameterControls:z.strictObject(actionProps)};
export const INTERACTION_EXAMPLES={ReviewQueue:{dataBinding:'reviewItems',stateKey:'review',actionId:'submitReview',actionLabel:'Send review'},EditableTable:{dataBinding:'records',stateKey:'recordEdits',actionId:'submitChanges',actionLabel:'Review changes'},ParameterControls:{dataBinding:'parameters',stateKey:'parameterDraft',actionId:'applyParameters',actionLabel:'Apply settings'}};
const option=z.strictObject({value:z.string().min(1).max(160),label});
const unique=(items:{id:string}[])=>new Set(items.map(item=>item.id)).size===items.length;
const choices=z.array(option).min(1).max(20).refine(items=>new Set(items.map(item=>item.value)).size===items.length,'Choice values must be unique');
const base={id,label,required:z.boolean().optional(),readOnly:z.boolean().optional(),description:z.string().max(800).optional()};
const bounds={min:z.number().finite().optional(),max:z.number().finite().optional(),step:z.number().finite().positive().optional()};
const numberField=z.strictObject({...base,type:z.literal('number'),...bounds});
const rangeField=z.strictObject({...base,type:z.literal('range'),min:z.number().finite(),max:z.number().finite(),step:bounds.step});
const textField=z.strictObject({...base,type:z.literal('text')});
const booleanField=z.strictObject({...base,type:z.literal('boolean')});
const choiceField=z.strictObject({...base,type:z.literal('choice'),options:choices});
const field=z.discriminatedUnion('type',[numberField,rangeField,textField,booleanField,choiceField]);
const control=z.discriminatedUnion('type',[numberField.extend({value:z.number().finite().nullable()}),rangeField.extend({value:z.number().finite().nullable()}),booleanField.extend({value:z.boolean().nullable()}),choiceField.extend({value:z.string().max(2000).nullable()})]);
export type InteractionField=z.infer<typeof field>;
export type InteractionScalar=z.infer<typeof scalar>;
export function typedInteractionValue(field:InteractionField,raw:unknown):{value:InteractionScalar;error?:string}{
 const empty=raw===null||raw===undefined||raw==='';
 if(empty)return field.required?{value:null,error:'Required'}:{value:null};
 if(field.type==='text')return typeof raw==='string'&&raw.length<=2000?{value:raw}:{value:null,error:'Use up to 2,000 characters'};
 if(field.type==='boolean')return typeof raw==='boolean'?{value:raw}:{value:null,error:'Choose Yes or No'};
 if(field.type==='choice')return typeof raw==='string'&&field.options.some(option=>option.value===raw)?{value:raw}:{value:null,error:'Choose a supplied option'};
 const value=typeof raw==='number'?raw:typeof raw==='string'&&raw.trim()?Number(raw):NaN;
 if(!Number.isFinite(value))return {value:null,error:'Enter a number'};
 if(field.min!==undefined&&value<field.min)return {value:null,error:`Minimum ${field.min}`};
 if(field.max!==undefined&&value>field.max)return {value:null,error:`Maximum ${field.max}`};
 if(field.step!==undefined&&Math.abs((value-(field.min??0))/field.step-Math.round((value-(field.min??0))/field.step))>1e-7)return {value:null,error:`Use increments of ${field.step}`};
 return {value};
}
function validField(field:InteractionField){return !('min'in field&&'max'in field&&field.min!==undefined&&field.max!==undefined&&field.min>=field.max);}
export const INTERACTION_DATA_SCHEMAS={
 ReviewQueue:z.strictObject({title:label.optional(),items:z.array(z.strictObject({id,label,detail:z.string().max(2000).optional(),evidence:z.array(z.strictObject({label,value:z.string().max(2000)})).max(8).optional()})).min(1).max(24).refine(unique,'Item identities must be unique'),source}),
 EditableTable:z.strictObject({title:label.optional(),columns:z.array(field).min(1).max(8).refine(unique,'Column identities must be unique'),rows:z.array(z.strictObject({id,label:label.optional(),values:z.record(id,scalar)})).max(50).refine(unique,'Row identities must be unique'),source}).superRefine((data,context)=>{
  const columns=new Map(data.columns.map(column=>[column.id,column]));if(data.columns.some(column=>!validField(column)))context.addIssue({code:'custom',message:'Minimum must be below maximum'});
  for(const row of data.rows)for(const [key,value]of Object.entries(row.values)){const column=columns.get(key);if(!column){context.addIssue({code:'custom',message:'Values must reference declared columns'});continue;}if(value!==null&&(column.type==='text'||column.type==='choice'?typeof value!=='string':column.type==='boolean'?typeof value!=='boolean':typeof value!=='number'))context.addIssue({code:'custom',message:'Source value does not match its column type'});if(column.type==='choice'&&typeof value==='string'&&!column.options.some(option=>option.value===value))context.addIssue({code:'custom',message:'Source choice is unavailable'});}
 }),
 ParameterControls:z.strictObject({title:label.optional(),controls:z.array(control).min(1).max(16).refine(unique,'Control identities must be unique'),source}).superRefine((data,context)=>{for(const control of data.controls){if(!validField(control))context.addIssue({code:'custom',message:'Minimum must be below maximum'});if(control.value!==null&&typedInteractionValue(control,control.value).error)context.addIssue({code:'custom',message:'Source parameter does not match its constraints'});}}),
};
export type ReviewQueueData=z.infer<typeof INTERACTION_DATA_SCHEMAS.ReviewQueue>;
export type EditableTableData=z.infer<typeof INTERACTION_DATA_SCHEMAS.EditableTable>;
export type ParameterControlsData=z.infer<typeof INTERACTION_DATA_SCHEMAS.ParameterControls>;
export const INTERACTION_DESCRIPTIONS={
 ReviewQueue:'An item-by-item review with local Accept, Request changes and Defer decisions plus comments. Bind {title?,items:[{id,label,detail?,evidence?:[{label,value}]}],source?}, up to24 unique items. stateKey saves {selectedId,items:{itemId:{decision:approve|revise|defer|null,comment}}}. The user must decide each item; Request changes needs a comment. Optional actionId submits {reviews:[{itemId,decision,comment}]} via the existing broker. This is content review, never native approval or execution authorization. Keep the same IDs while source evidence evolves.',
 EditableTable:'Typed local drafts over supplied records. Bind {title?,columns:[{id,label,type:text|number|range|boolean|choice,required?,readOnly?,min?,max?,step?,options?:[{value,label}]}],rows:[{id,label?,values:{columnId:scalar|null}}],source?}. Up to8 columns and50 unique rows. stateKey saves {edits:{rowId:{columnId:localDraft}}}; invalid incomplete drafts survive until repaired. Unknown values remain unset. Optional actionId submits typed {changes:[{rowId,columnId,value}]} through the existing broker. Editing and submission do not write the source or establish execution success; actual mutations still need native approval.',
 ParameterControls:'Immediate persistent parameters for a task, comparison or simulation. Bind {title?,controls:[{id,label,type:number|range|boolean|choice,value:number|boolean|string|null,description?,required?,readOnly?,min?,max?,step?,options?:[{value,label}]}],source?}; range requires min/max. Up to16 unique controls. stateKey saves {values:{controlId:localDraft}}. Optional actionId submits typed {values:{id:value}}; null remains unknown, booleans retain false, and no effects run before the broker accepts an explicit action. Controls alone never authorize execution.',
};
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const dense=(value:unknown,maximum:number,minimum=0):value is unknown[]=>Array.isArray(value)&&value.length>=minimum&&value.length<=maximum&&Array.from({length:value.length},(_,index)=>Object.hasOwn(value,index)).every(Boolean);
export function boundedInteractionData(kind:keyof typeof INTERACTION_DATA_SCHEMAS,raw:unknown):boolean{
 if(!record(raw))return false;
 if(kind==='ReviewQueue')return dense(raw.items,24,1)&&raw.items.every(item=>record(item)&&(!Object.hasOwn(item,'evidence')||dense(item.evidence,8)));
 const fields=kind==='EditableTable'?raw.columns:raw.controls;
 if(!dense(fields,kind==='EditableTable'?8:16,1)||!fields.every(item=>record(item)&&(!Object.hasOwn(item,'options')||dense(item.options,20,1))))return false;
 return kind==='ParameterControls'||dense(raw.rows,50)&&raw.rows.every(row=>record(row)&&record(row.values)&&Object.keys(row.values).length<=8);
}
