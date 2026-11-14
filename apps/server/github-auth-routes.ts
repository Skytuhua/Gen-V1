import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {GitHubAuth} from '../../packages/workspace/github-auth.ts';

/** Profile authorization, registered under the server's existing local-session hooks. */
export function registerGitHubAuthRoutes(app:FastifyInstance,auth:GitHubAuth){
 const flow=z.strictObject({flowId:z.string().uuid()}),starts:number[]=[];
 app.post('/api/github/auth/start',{bodyLimit:1024},async(request,reply)=>{
  reply.header('Cache-Control','no-store');z.strictObject({}).parse(request.body);
  // Each start spends a GitHub device-code grant; the flow is rate-limited remotely.
  const now=Date.now();while(starts.length&&now-starts[0]!>=60_000)starts.shift();
  if(starts.length>=5)return reply.code(429).send({error:{code:'RATE_LIMITED',message:'Too many GitHub sign-in attempts. Wait a minute and try again.'}});
  starts.push(now);return auth.start();
 });
 app.post('/api/github/auth/poll',{bodyLimit:1024},async(request,reply)=>{reply.header('Cache-Control','no-store');return auth.poll(flow.parse(request.body).flowId);});
 app.post('/api/github/auth/cancel',{bodyLimit:1024},async(request,reply)=>{reply.header('Cache-Control','no-store');return auth.cancel(flow.parse(request.body).flowId);});
}
