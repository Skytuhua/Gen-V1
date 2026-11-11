import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {Service} from '../../packages/core/service.ts';
import {HarnessError} from '../../packages/contracts/index.ts';
import type {ProjectSummary} from '../../packages/contracts/workspace.ts';
import {environmentSettingsFor} from '../../packages/core/environment-settings.ts';

/** Dedicated authenticated write path: values never enter Store.command. */
export function registerEnvironmentRoutes(app:FastifyInstance,service:Service){
 const settings=environmentSettingsFor(service.store.dataDir);
 const validateScope=(body:unknown)=>{const {scope}=z.object({scope:z.string()}).parse(body);if(scope==='device')return;if(!scope.startsWith('project:'))throw new HarnessError('INVALID_INPUT','Choose a device or project scope.');const project=service.store.get<ProjectSummary>('workspaceProject',scope.slice(8));if(!project||project.authority.kind!=='local')throw new HarnessError('CAPABILITY_DENIED','The local project is unavailable.');};
 app.get('/api/environment',async(_request,reply)=>reply.header('Cache-Control','no-store').send(await settings.read()));
 app.put('/api/environment',{bodyLimit:64*1024},async(request,reply)=>{validateScope(request.body);reply.header('Cache-Control','no-store');return settings.save(request.body);});
 app.delete('/api/environment',{bodyLimit:2048},async(request,reply)=>{validateScope(request.body);reply.header('Cache-Control','no-store');return settings.remove(request.body);});
}
