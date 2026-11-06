import Fastify from 'fastify';
import {appendFile,readFile} from 'node:fs/promises';
import {registerPluginRoutes} from '../../apps/server/plugin-routes.ts';
import type {PluginRegistry} from '../../packages/plugins/host.ts';
import {trustedPluginDocument,trustedPluginManifest,trustedPluginScript} from './trusted-plugin-frame.ts';

// Only the installed-package HTTP boundary runs; no native or provider starts.
const app=Fastify();
const registry={list:()=>[trustedPluginManifest],readAsset:async()=>({bytes:Buffer.from(trustedPluginDocument),contentType:'text/html'}),dispatch:async()=>({private:'owner-only'})} as unknown as PluginRegistry;
registerPluginRoutes(app,registry,'http://127.0.0.1:*');
app.get('/api/bootstrap',async()=>({csrfToken:'owned-fixture'}));
app.get('/',(_request,reply)=>reply.type('text/html').send('<!doctype html><div id="root"></div><script src="/parent.js"></script>'));
app.get('/parent.js',async(_request,reply)=>reply.type('text/javascript').send(await readFile('parent.js')));
app.get('/__custody-child.js',(_request,reply)=>reply.type('text/javascript').send(trustedPluginScript));
const origin=await app.listen({port:0,host:'127.0.0.1'});
console.log(`GEN_DEV_FIXTURE_ORIGIN=${origin}`);
process.on('SIGTERM',()=>{void app.close().then(async()=>{await appendFile('stopped.log','server\n');process.exit(0);});});
