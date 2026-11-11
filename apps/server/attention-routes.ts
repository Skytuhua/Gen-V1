import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Service } from '../../packages/core/service.ts';
import { AttentionRepository } from '../../packages/core/attention.ts';
import { attentionCommandSchema } from '../../packages/contracts/attention.ts';

/** Registered beneath the existing local session, origin and CSRF guards. */
export function registerAttentionRoutes(app:FastifyInstance,service:Service){
 const attention=new AttentionRepository(service.store);attention.read();const stop=attention.watch();app.addHook('onClose',async()=>{stop();});
 app.get('/api/attention',async(_request,reply)=>reply.header('Cache-Control','no-store').send(attention.read()));
 app.post('/api/attention/:eventId/commands',{bodyLimit:4096},async request=>{const{eventId}=z.strictObject({eventId:z.string().min(1).max(1000)}).parse(request.params);const input=attentionCommandSchema.omit({eventId:true}).parse(request.body);return attention.command({...input,eventId});});
}
