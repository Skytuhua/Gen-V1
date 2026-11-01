import {z} from 'zod';

const id=z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9_:.-]*$/);
const resourceId=z.string().min(1).max(200).refine(value=>!/[\u0000-\u0020/\\?#]/.test(value)&&!['.','..'].includes(value),'Use a granted resource ID');
const example=z.strictObject({text:z.string().max(4000).optional(),resourceId:resourceId.optional(),alt:z.string().max(300).optional()}).refine(value=>Boolean(value.text?.trim()||value.resourceId),'Provide example text or a granted image');
export const PlanningQuestionSchema=z.strictObject({
  options:z.array(z.strictObject({id,label:z.string().trim().min(1).max(160),description:z.string().max(500).optional(),explanation:z.string().max(4000).optional(),examples:z.array(example).max(4).optional()})).min(1).max(12).refine(options=>new Set(options.map(option=>option.id)).size===options.length,'Option IDs must be unique'),
  allowCustom:z.boolean().optional(),
});
export type PlanningQuestionDefinition=z.infer<typeof PlanningQuestionSchema>;
