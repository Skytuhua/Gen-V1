import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {skillCatalogQuerySchema} from '../../packages/contracts/skill-catalog.ts';
import type {SkillCatalogRepository} from '../../packages/skill-catalog/repository.ts';

const query=skillCatalogQuerySchema.extend({limit:z.string().regex(/^[1-9][0-9]{0,2}$/).transform(Number).pipe(z.number().int().max(100)).optional()}).strict();
export function registerSkillCatalogRoutes(app:FastifyInstance,catalog:SkillCatalogRepository){
 app.get('/api/skill-catalog',async(request,reply)=>{
  reply.header('Cache-Control','no-store');return catalog.list(query.parse(request.query));
 });
}
