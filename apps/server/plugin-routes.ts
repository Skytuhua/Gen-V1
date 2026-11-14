import type {FastifyInstance} from 'fastify';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import type {PluginRegistry} from '../../packages/plugins/host.ts';
import {pluginSurfaceSchema} from '../../packages/plugins/contracts.ts';

const requestSchema=z.strictObject({operation:z.string().regex(/^[a-z][a-zA-Z0-9_.-]{0,79}$/),input:z.unknown()});
const unavailable='This plug-in is unavailable. Your saved work is retained.';
// The verified runtime resolves beside this module, never beside process.cwd().
const assets=fileURLToPath(new URL('../..',import.meta.url));
export function registerPluginRoutes(app:FastifyInstance,registry:PluginRegistry|undefined,origin:string,theme?:()=>string,error?:string,admit:()=>boolean=()=>true) {
  app.get('/api/plugins',async(_request,reply)=>reply.header('Cache-Control','no-store').send({plugins:registry?.list()??[],...(theme?{theme:theme()}:{}),...(error?{error}:{})}));
  app.post<{Params:{id:string}}>('/api/plugins/:id/rpc',{bodyLimit:256*1024},async(request,reply)=>{
    const body=requestSchema.safeParse(request.body);if(!body.success)return reply.code(400).send({error:{code:'INVALID_INPUT',message:'Invalid plug-in request.'}});
    if(!registry)return reply.code(404).send({error:{code:'NOT_FOUND',message:unavailable}});
    if(!admit())return reply.code(503).send({error:{code:'HOST_CLOSING',message:'Gen is closing. Saved work is retained.'}});
    const controller=new AbortController(),abort=()=>controller.abort(),disconnected=()=>{if(!reply.raw.writableEnded)controller.abort();};request.raw.once('aborted',abort);reply.raw.once('close',disconnected);
    // Fastify treats returned strings as plain text. Preserve JSON primitives
    // so recovered text has the same wire type as objects, arrays and null.
    try{const result=await registry.dispatch(request.params.id,body.data.operation,body.data.input,controller.signal);return reply.type('application/json').send(JSON.stringify(result));}
    catch(cause){
     const detail=cause instanceof Error?cause.message:'';
     if(detail==='The plug-in request is too large.')return reply.code(413).send({error:{code:'RESOURCE_LIMIT',message:unavailable}});
     if(detail.startsWith('The plug-in request must contain')||detail==='This plug-in operation is unavailable.')return reply.code(400).send({error:{code:'INVALID_INPUT',message:unavailable}});
     return reply.code(503).send({error:{code:'PLUGIN_UNAVAILABLE',message:unavailable}});
    }
    finally{request.raw.removeListener('aborted',abort);reply.raw.removeListener('close',disconnected);}
  });
  app.get<{Params:{id:string}}>('/plugins/:id/frame',async(request,reply)=>{
    const manifest=registry?.list().find(item=>item.id===request.params.id);if(!manifest||!registry)return reply.code(404).send(unavailable);
    try{
      const query=request.query as Record<string,unknown>;
      const workspaceQuery=Object.hasOwn(query,'workspace')||Object.hasOwn(query,'view');
      if(workspaceQuery&&(!manifest.workspaces?.some(value=>value.id===query.workspace&&value.entryView===query.view)||['scopeId','surfaceId','resourceId'].some(key=>Object.hasOwn(query,key))))return reply.code(403).send(unavailable);
      const protectedView=['scopeId','surfaceId','resourceId'].some(key=>Object.hasOwn(query,key));
      const parsed=protectedView?pluginSurfaceSchema.safeParse({kind:'plugin',pluginId:manifest.id,scopeId:query.scopeId,surfaceId:query.surfaceId,...(Object.hasOwn(query,'resourceId')?{resourceId:query.resourceId}:{})}):undefined;
      if(parsed&&!parsed.success)return reply.code(400).send(unavailable);
      const surface=parsed?.success?parsed.data:undefined;
      if(surface&&!await registry.validateSurface(surface))return reply.code(403).send(unavailable);
      const asset=await registry.readAsset(manifest.id,manifest.frontendEntry);
      const runtime=`<meta name="gen-plugin-id" content="${manifest.id}"><link rel="stylesheet" href="/plugin-runtime/runtime.css"><script src="/plugin-runtime/runtime.js"></script>`;
      const html=Buffer.from(asset.bytes).toString('utf8'),head=/<head(?:\s[^>]*)?>/i.exec(html);
      return reply.header('Content-Security-Policy',`sandbox allow-scripts; default-src 'none'; script-src ${origin}; style-src ${origin} 'unsafe-inline'; font-src ${origin} data:; img-src ${origin} data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`).header('Cache-Control','no-store').type('text/html; charset=utf-8').send(head?html.slice(0,head.index)+head[0]+runtime+html.slice(head.index+head[0].length):runtime+html);
    }catch{return reply.code(503).send(unavailable);}
  });
  app.get<{Params:{id:string;'*':string}}>('/plugins/:id/*',async(request,reply)=>{
    const path=request.params['*'];if(!registry||path.startsWith('host/')||path==='plugin.json'||path==='plugin-files.json'||/\.(?:html?|svg)$/i.test(path))return reply.code(404).send(unavailable);
    try{const asset=await registry.readAsset(request.params.id,'frontend/'+path);return reply.header('Cache-Control','no-store').type(asset.contentType).send(Buffer.from(asset.bytes));}
    catch{return reply.code(404).send(unavailable);}
  });
  app.get<{Params:{'*':string}}>('/plugin-runtime/*',async(request,reply)=>{
    const relative=request.params['*'];if(!/^(?:runtime\.(?:js|css)|assets\/[A-Za-z0-9_.-]+\.(?:woff2?|png))$/.test(relative))return reply.code(404).send(unavailable);
    const root=resolve(assets,'dist/plugin-runtime'),path=resolve(root,relative);if(!path.startsWith(root+sep))return reply.code(404).send(unavailable);
    try{return reply.header('Cache-Control','no-cache').type(({'.js':'text/javascript','.css':'text/css','.woff':'font/woff','.woff2':'font/woff2','.png':'image/png'} as Record<string,string>)[extname(path)]).send(await readFile(path));}
    catch{return reply.code(503).send('The plug-in presentation runtime is unavailable.');}
  });
}
