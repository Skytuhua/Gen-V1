import { z } from 'zod';
const identity=z.string().min(1).max(1000).regex(/^[A-Za-z0-9][A-Za-z0-9:_.-]*$/);
export const attentionItemSchema=z.strictObject({
 id:identity,threadId:identity,projectId:identity.optional(),kind:z.enum(['request','operation','thread-completed','thread-failed']),
 title:z.string().max(200),summary:z.string().max(2000),state:z.enum(['needs-input','needs-review','completed','failed','resolved']),
 createdAt:z.string().datetime(),updatedAt:z.string().datetime(),read:z.boolean(),popupDismissed:z.boolean(),actionable:z.boolean(),notificationKey:z.string().min(1).max(1200),
 destination:z.strictObject({threadId:identity,projectId:identity.optional(),requestId:identity.optional(),operationId:identity.optional()}),
});
export type AttentionItem=z.infer<typeof attentionItemSchema>;
export interface AttentionEnvelope {items:AttentionItem[];unread:number;sequence:number}
export const attentionCommandSchema=z.strictObject({id:identity,eventId:identity,type:z.enum(['read','unread','dismiss-popup'])});
export type AttentionCommand=z.infer<typeof attentionCommandSchema>;
export interface AttentionDelivery {items:AttentionItem[];preferences:{threadNotifications:'off'|'notifications'|'sound'|'both';inAppNotifications:boolean;volume:number;preview:'full'|'title'|'private';quietHours:{enabled:boolean;start:string;end:string}}}
export const attentionDeliverySchema=z.strictObject({items:z.array(attentionItemSchema).max(30),preferences:z.strictObject({threadNotifications:z.enum(['off','notifications','sound','both']),inAppNotifications:z.boolean(),volume:z.number().finite().min(0).max(1),preview:z.enum(['full','title','private']),quietHours:z.strictObject({enabled:z.boolean(),start:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),end:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)})})});
