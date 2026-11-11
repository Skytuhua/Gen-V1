import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {GitHubAuth} from '../../packages/workspace/github-auth.ts';

/** Profile authorization, registered under the server's existing local-session hooks. */
export function registerGitHubAuthRoutes(app:FastifyInstance,auth:GitHubAuth){
 const flow=z.strictObject({flowId:z.string().uuid()});
 app.post('/api/github/auth/start',{bodyLimit:1024},async(request,reply)=>{reply.header('Cache-Control','no-store');z.strictObject({}).parse(request.body);return auth.start();});
 app.post('/api/github/auth/poll',{bodyLimit:1024},async(request,reply)=>{reply.header('Cache-Control','no-store');return auth.poll(flow.parse(request.body).flowId);});
 app.post('/api/github/auth/cancel',{bodyLimit:1024},async(request,reply)=>{reply.header('Cache-Control','no-store');return auth.cancel(flow.parse(request.body).flowId);});
}
