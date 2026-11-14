import Fastify from "fastify";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, stat, readdir, lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readBoundFile, withResourceGrant } from "../../packages/core/file-access.ts";
import { resolve, extname, basename, join } from "node:path";
import { z } from "zod";
import { Service } from "../../packages/core/service.ts";
import { HarnessError, type ArtifactRecord, type ResourceGrant, type Snapshot } from "../../packages/contracts/index.ts";
import {getPreferences,preferencesSchema,type UiPreferences} from '../../packages/contracts/preferences.ts';
import { inside } from "../../packages/core/security.ts";
import { GENERATED_APPS_ENABLED } from "../../packages/core/widgets.ts";
import { WIDGET_SHELL_CSP, widgetShellDocument } from "../../packages/widgets/document.ts";
import { WIDGET_WORKER_PATH, WIDGET_WORKER_CSP } from "../../packages/widgets/protocol.ts";
import {SessionCredentials} from '../../packages/core/credential-slots.ts';
import { streamEvents } from './event-stream.ts';
import {registerAccountAuthRoutes} from './account-auth.ts';
import {registerWorkspaceRoutes} from './workspace-routes.ts';
import {registerAttentionRoutes} from './attention-routes.ts';
import {registerPluginRoutes} from './plugin-routes.ts';
import type {PluginRegistry} from '../../packages/plugins/host.ts';
import {registerSkillCatalogRoutes} from './skill-catalog-routes.ts';
import {registerResearchRoutes} from './research-routes.ts';
import {createPersonalSkillCatalog} from '../../packages/skill-catalog/adapters.ts';
import type {SkillCatalogRepository} from '../../packages/skill-catalog/repository.ts';
import {registerAgentInventoryRoutes} from './agent-inventory-routes.ts';
import {registerAgentInputRoutes} from './agent-input-routes.ts';
import {registerShellReadRoutes} from './shell-read-routes.ts';
import {registerConversationReadRoutes} from './conversation-read-routes.ts';
import {ConversationReadModels} from '../../packages/core/conversation-read-models.ts';
import {AgentProjection} from '../../packages/agent-projection/index.ts';
import type {PersonalAgentInventory} from '../../packages/contracts/agent-inventory.ts';

type Mount = { artifactId: string; revision: number; expiresAt: number };
const shellPreferencesSchema=z.object({...preferencesSchema.shape,keybindings:z.object(preferencesSchema.shape.keybindings.shape)});
export type MountRegistry = Map<string, Mount>;
export interface ServerOptions { port: number; dev: boolean; widgetPort?: number; mounts?: MountRegistry; plugins?:PluginRegistry; pluginError?:string; admitPluginRequest?:()=>boolean; skillCatalog?:SkillCatalogRepository; agentInventory?:PersonalAgentInventory; launchToken?:string }
const commandSchema = z.object({ id: z.string().min(1).max(200).regex(/^[a-zA-Z0-9:_-]+$/), type: z.string().min(1).max(100), threadId: z.string().max(200).optional(), payload: z.record(z.string(), z.unknown()) }).strict();
const mime = (path: string) => ({ ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".woff": "font/woff", ".pdf": "application/pdf", ".json": "application/json", ".txt": "text/plain", ".md": "text/plain", ".csv": "text/csv" })[extname(path).toLowerCase()] ?? "application/octet-stream";
// Build output resolves beside this module; the launch directory is not trusted input.
const assets = fileURLToPath(new URL("../..", import.meta.url));

export async function buildServer(service: Service, options: ServerOptions) {
  const app = Fastify({ logger: false, bodyLimit: 29 * 1024 * 1024 });
  const sessions = new Map<string, { csrf: string; expiresAt: number }>();
  let snapshotCache: { seq: number; json: string } | undefined;
  const credentials=new SessionCredentials(service.store);
  app.addHook('onClose',async()=>{snapshotCache=undefined;return credentials.dispose();});
  const mounts = options.mounts ?? new Map<string, Mount>();
  const widgetPort = options.widgetPort ?? 4318;
  const origins = new Set(["http://127.0.0.1:" + options.port, "http://localhost:" + options.port, ...(options.dev ? ["http://127.0.0.1:5173", "http://localhost:5173"] : [])]);
  const hosts = new Set(["127.0.0.1:" + options.port, "localhost:" + options.port]);
  const streams = new Set<import("node:http").ServerResponse>();
  app.setErrorHandler((error, _request, reply) => {
    const known = error instanceof HarnessError, malformed = error instanceof z.ZodError || error instanceof URIError;
    const native = typeof (error as { statusCode?: unknown }).statusCode === "number" ? (error as { statusCode: number }).statusCode : undefined;
    const code = known ? error.code : malformed ? "INVALID_INPUT" : native === 413 ? "RESOURCE_LIMIT" : "HOST_ERROR";
    const status = code === "NOT_FOUND" ? 404 : ["CAPABILITY_DENIED", "AUTH_REQUIRED"].includes(code) ? 403 : known || malformed ? 400 : native !== undefined && native >= 400 && native < 500 ? native : 500;
    const message = known ? error.message : error instanceof z.ZodError ? "Command envelope is invalid" : error instanceof URIError ? "The request path is invalid" : code === "RESOURCE_LIMIT" ? "The request exceeds its byte limit" : "The host could not complete this request";
    reply.code(status).send({ error: { code, message, ...(known && error.details ? { details: error.details } : {}) } });
  });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff").header("Referrer-Policy", "no-referrer");
    if(/^\/api\/artifacts\/[^/?]+\/credentials\//.test(request.url))reply.header('Cache-Control','no-store');
    if (!hosts.has(String(request.headers.host))) return reply.code(403).send({ error: { code: "INVALID_HOST", message: "Host is not allowed" } });
    const origin = request.headers.origin;
    if (origin && !origins.has(String(origin))) return reply.code(403).send({ error: { code: "INVALID_ORIGIN", message: "Origin is not allowed" } });
    if (!request.url.startsWith("/api/") || request.url.split("?")[0] === "/api/bootstrap") return;
    const cookie = /(?:^|;\s*)harness_session=([a-f0-9]+)/.exec(request.headers.cookie ?? "")?.[1];
    const session = cookie ? sessions.get(cookie) : undefined;
    if (!session || session.expiresAt < Date.now()) return reply.code(401).send({ error: { code: "AUTH_REQUIRED", message: "Reconnect to the local host" } });
    if (request.method !== "GET" && request.method !== "HEAD") {
      const csrf = Buffer.from(String(request.headers["x-harness-csrf"] ?? "")), expected = Buffer.from(session.csrf);
      if (csrf.length !== expected.length || !timingSafeEqual(csrf, expected)) return reply.code(403).send({ error: { code: "CSRF_REQUIRED", message: "Refresh the local session before sending commands" } });
    }
  });
  app.get("/api/bootstrap", async (request, reply) => {
    // Desktop launches share a per-boot secret; without it any local process
    // could mint a session and drive commands and terminals.
    if (options.launchToken) {
      const presented = request.headers["x-harness-launch"];
      const expected = Buffer.from(options.launchToken);
      const supplied = typeof presented === "string" ? Buffer.from(presented) : Buffer.alloc(0);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply.code(403).send({ error: { code: "LAUNCH_TOKEN_REQUIRED", message: "Open Gen V1 from its desktop app to connect to this host." } });
    }
    const existing = /(?:^|;\s*)harness_session=([a-f0-9]+)/.exec(request.headers.cookie ?? "")?.[1];
    let token = existing, session = token ? sessions.get(token) : undefined;
    if (!session || session.expiresAt < Date.now()) { token = randomBytes(32).toString("hex"); session = { csrf: randomBytes(32).toString("hex"), expiresAt: Date.now() + 24 * 60 * 60 * 1000 }; sessions.set(token, session); }
    if (sessions.size > 1000) {
      for (const [key, entry] of sessions) if (entry.expiresAt < Date.now()) sessions.delete(key);
      while (sessions.size > 1000) sessions.delete(sessions.keys().next().value!);
    }
    reply.header("Set-Cookie", "harness_session=" + token + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400").header("Cache-Control", "no-store");
    return { csrfToken: session.csrf, widgetOrigin: "http://localhost:" + widgetPort };
  });
  registerPluginRoutes(app,options.plugins,'http://127.0.0.1:'+options.port,()=>service.store.snapshot().settings.theme,options.pluginError,options.admitPluginRequest);
  app.get('/api/shell-settings',async(_request,reply)=>{
    reply.header('Cache-Control','no-store');
    const settings=service.store.get<Snapshot['settings']>('settings','global')??{theme:'dark',modelId:null};
    let preferences:UiPreferences;try{preferences=shellPreferencesSchema.parse(getPreferences(settings));}catch{preferences=shellPreferencesSchema.parse(getPreferences({}));}
    return{theme:settings.theme==='light'||settings.theme==='system'?settings.theme:'dark',preferences};
  });
  app.get("/api/snapshot", async (_request, reply) => {
    const seq = service.store.sequence;
    let json = snapshotCache?.seq === seq ? snapshotCache.json : undefined;
    if (json === undefined) {
      json = JSON.stringify(service.store.snapshot());
      // One immutable response per committed sequence, shared by local windows.
      // Keep large workspaces responsive without retaining unbounded payloads.
      snapshotCache = Buffer.byteLength(json) <= 16 * 1024 * 1024 ? { seq, json } : undefined;
    }
    return reply.header("Cache-Control", "no-store").type('application/json').send(json);
  });
  app.get<{ Params: { id: string }; Querystring: { beforeId?: string; limit?: string } }>('/api/threads/:id/messages', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params, { beforeId, limit } = request.query;
    if ((beforeId !== undefined && typeof beforeId !== 'string') || (limit !== undefined && typeof limit !== 'string')) throw new HarnessError('INVALID_INPUT', 'Message paging parameters must be single values');
    if (!service.store.get('thread', id) || service.store.get('archivedThread', id)) throw new HarnessError('NOT_FOUND', 'Thread unavailable');
    const parsed = limit === undefined ? 200 : Number.parseInt(limit, 10);
    if (!Number.isSafeInteger(parsed)) throw new HarnessError('INVALID_INPUT', 'Choose a valid message page size');
    return service.store.messagesFor(id, beforeId, parsed);
  });
  // Thread-scoped read for evals and other single-thread pollers: no full
  // workspace snapshot serialization per poll.
  app.get<{ Params: { id: string } }>('/api/threads/:id/snapshot', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params, thread = service.store.get<Snapshot['threads'][number]>('thread', id);
    if (!thread || service.store.get('archivedThread', id)) throw new HarnessError('NOT_FOUND', 'Thread unavailable');
    const usage = service.store.get<{ value: unknown }>('usage', id)?.value;
    return {
      seq: service.store.sequence,
      threads: [thread],
      messages: service.store.all('message', id),
      artifacts: service.store.all('artifact', id),
      userStates: service.store.all('userState', id),
      data: service.store.all('data', id),
      requests: service.store.all('request', id),
      operations: service.store.all('operation', id),
      resources: service.store.all('resource', id),
      memory: service.store.all('taskMemory', id),
      usage: usage === undefined ? {} : { [id]: usage },
      settings: { theme: 'dark', modelId: null },
      activeThreadId: null,
    };
  });
  // Deep message search for threads whose history the snapshot windowed: the
  // client passes the truncated thread ids it knows about.
  app.get<{ Querystring: { q?: string; threads?: string } }>('/api/threads/search', async (request) => {
    if ((request.query.q !== undefined && typeof request.query.q !== 'string') || (request.query.threads !== undefined && typeof request.query.threads !== 'string')) throw new HarnessError('INVALID_INPUT', 'Search parameters must be single values');
    const query = (request.query.q ?? '').slice(0, 500).toLocaleLowerCase();
    if (!query) return { threadIds: [] };
    const ids = (request.query.threads ?? '').slice(0, 4000).split(',').filter(id => /^[\w:.-]{1,200}$/.test(id)).slice(0, 200);
    const threadIds = ids.filter(id => service.store.get('thread', id)
      && service.store.all<{ content: string }>('message', id).some(message => message.content.toLocaleLowerCase().includes(query)));
    return { threadIds };
  });
  app.get("/api/models", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { refresh,threadId } = request.query as { refresh?: unknown;threadId?:unknown };
    if (refresh !== undefined && refresh !== "1" && refresh !== "true") throw new HarnessError("INVALID_INPUT", "Model refresh must be 1 or true");
    if(threadId!==undefined&&(typeof threadId!=='string'||!threadId||threadId.length>200))throw new HarnessError('INVALID_INPUT','Choose a valid thread for model discovery');
    try { return { models: await service.models({ refresh: refresh !== undefined,threadId:threadId as string|undefined }) }; }
    catch (error) { return { models: [], error: error instanceof Error ? error.message : "Pi is unavailable" }; }
  });
  app.post("/api/commands", async request => service.command(commandSchema.parse(request.body)));
  const predictionInput=z.strictObject({threadId:z.string().min(1).max(200),replyId:z.string().min(1).max(200),modelId:z.string().min(1).max(300)});
  app.post('/api/composer-prediction',{bodyLimit:2048},async(request,reply)=>{
    reply.header('Cache-Control','no-store');const input=predictionInput.parse(request.body),controller=new AbortController();
    // IncomingMessage.close also fires after a normally consumed POST body.
    // Only an unfinished response losing its client revokes this caller.
    const close=()=>{if(!reply.raw.writableEnded)controller.abort();};reply.raw.once('close',close);
    try{return await service.composerPrediction(input,controller.signal);}finally{reply.raw.removeListener('close',close);}
  });
  app.post('/api/composer-prediction/cancel',{bodyLimit:1024},async(request,reply)=>{
    z.strictObject({}).optional().parse(request.body);reply.header('Cache-Control','no-store');await service.cancelComposerPredictions();return{cancelled:true};
  });
  registerAccountAuthRoutes(app,service);
  registerWorkspaceRoutes(app,service);
  registerAttentionRoutes(app,service);
  const agentInventory=options.agentInventory??new AgentProjection(service.store);
  registerAgentInventoryRoutes(app,agentInventory);
  registerAgentInputRoutes(app,service.planning);
  registerShellReadRoutes(app,service.store);
  const conversationReads=new ConversationReadModels(service.store);
  registerConversationReadRoutes(app,conversationReads);
  app.addHook('onClose',async()=>{conversationReads.dispose();});
  if(!options.agentInventory)app.addHook('onClose',async()=>{agentInventory.dispose();});
  registerSkillCatalogRoutes(app,options.skillCatalog??createPersonalSkillCatalog(service.store));
  registerResearchRoutes(app,{research:service.research,command:command=>service.command(command)});
  const skillRead=z.strictObject({path:z.string().min(1).max(1024).optional(),revision:z.coerce.number().int().positive().optional(),versionOffset:z.coerce.number().int().nonnegative().optional(),includeInactive:z.enum(['true','false']).optional()});
  app.get<{Params:{name:string}}>('/api/skills/:name',async(request,reply)=>{reply.header('Cache-Control','no-store');const args=skillRead.parse(request.query);return service.skillDetail(request.params.name,{...args,includeInactive:args.includeInactive==='true'});});
  app.get<{Params:{id:string}}>('/api/skill-proposals/:id',async(request,reply)=>{reply.header('Cache-Control','no-store');return service.skillProposal(request.params.id);});
  const credentialScope=z.strictObject({threadId:z.string().min(1).max(200),artifactRevision:z.coerce.number().int().positive()});
  const credentialWrite=credentialScope.extend({version:z.number().int().nonnegative(),token:z.string().min(1).max(8192)}).strict();
  const credentialRemove=credentialScope.extend({version:z.number().int().nonnegative()}).strict();
  const credentialUrl='/api/artifacts/:id/credentials/:slotKey';
  app.get<{Params:{id:string;slotKey:string}}>(credentialUrl,async(request,reply)=>{
    reply.header('Cache-Control','no-store');const args=credentialScope.parse(request.query);
    return credentials.status({artifactId:request.params.id,threadId:args.threadId,revision:args.artifactRevision},request.params.slotKey);
  });
  app.put<{Params:{id:string;slotKey:string}}>(credentialUrl,{bodyLimit:12*1024},async(request,reply)=>{
    reply.header('Cache-Control','no-store');const args=credentialWrite.parse(request.body);
    return credentials.save({artifactId:request.params.id,threadId:args.threadId,revision:args.artifactRevision},request.params.slotKey,args.token,args.version);
  });
  app.delete<{Params:{id:string;slotKey:string}}>(credentialUrl,{bodyLimit:2048},async(request,reply)=>{
    reply.header('Cache-Control','no-store');const args=credentialRemove.parse(request.body);
    return credentials.remove({artifactId:request.params.id,threadId:args.threadId,revision:args.artifactRevision},request.params.slotKey,args.version);
  });
  app.get("/api/events", async (request, reply) => {
    const query = request.query as { after?: string };
    const after = Number(query.after ?? 0);
    if (!Number.isSafeInteger(after) || after < 0) throw new HarnessError("INVALID_INPUT", "Event cursor is invalid");
    if (streams.size >= 32) return reply.code(429).send({ error: { code: "STREAM_LIMIT", message: "Too many event readers" } });
    reply.hijack(); reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    streams.add(reply.raw);
    streamEvents(reply.raw, service.store, after, () => streams.delete(reply.raw));
  });
  app.get<{ Params: { id: string } }>("/api/artifacts/:id/source", async (request, reply) => {
    const artifact = service.store.get<ArtifactRecord>("artifact", request.params.id);
    if (!artifact) throw new HarnessError("NOT_FOUND", "Artifact not found");
    return reply.type("text/plain; charset=utf-8").send(artifact.widget?.html ?? JSON.stringify(artifact.spec, null, 2));
  });
  app.get<{ Params: { id: string } }>("/api/artifacts/:id/mount", async (request, reply) => {
    if (!GENERATED_APPS_ENABLED) throw new HarnessError("CAPABILITY_UNAVAILABLE", "Generated apps are disabled until execution isolation passes its integrity gates");
    const artifact = service.store.get<ArtifactRecord>("artifact", request.params.id);
    if (!artifact?.widget || artifact.lifecycle !== "active") throw new HarnessError("NOT_FOUND", "Widget not available");
    const ticket = randomBytes(32).toString("hex"), token = randomBytes(32).toString("hex"), mountId = randomUUID();
    mounts.set(ticket, { artifactId: artifact.id, revision: artifact.revision, expiresAt: Date.now() + 30000 });
    for (const [key, value] of mounts) if (value.expiresAt < Date.now()) mounts.delete(key);
    reply.header("Cache-Control", "no-store");
    return { url: "http://localhost:" + widgetPort + "/widget/" + artifact.id + "/" + artifact.revision + "?ticket=" + ticket + "#token=" + token + "&mountId=" + mountId, token, mountId, revision: artifact.revision };
  });
  app.get<{ Params: { id: string }; Querystring: {path?: string} }>("/api/resources/:id/content", async (request, reply) => {
    const resource = service.store.get<ResourceGrant>("resource", request.params.id);
    if (!resource) throw new HarnessError("NOT_FOUND", "Resource not found");
    const relativePath=request.query.path;
    if (relativePath!==undefined && (typeof relativePath!=="string" || relativePath.length>4096 || !relativePath.length)) throw new HarnessError("INVALID_INPUT", "Use a nonempty relative resource path");
    const path = await service.resolveResource(resource.threadId, resource.id,relativePath);
    const bytes = await withResourceGrant(resource, service.store.dataDir, relativePath, false, new AbortController().signal, stable => readBoundFile(stable, 20 * 1024 * 1024));
    const type = mime(path);
    const filename = basename(path);
    reply.header("Content-Security-Policy", "sandbox; default-src 'none'").header("Cache-Control", "no-store").header("Content-Disposition", "inline; filename=\"" + filename.replace(/[^\x20-\x7e]|["\\]/g, "_") + "\"; filename*=UTF-8''" + encodeURIComponent(filename).replace(/['()*]/g, value => "%" + value.charCodeAt(0).toString(16).toUpperCase()));
    return reply.type(type === "text/html" ? "text/plain" : type).send(bytes);
  });
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>('/api/resources/:id/tree', async (request, reply) => {
    const resource = service.store.get<ResourceGrant>('resource', request.params.id);
    if (!resource) throw new HarnessError('NOT_FOUND', 'Resource not found');
    const relative = request.query.path;
    if (relative !== undefined && (typeof relative !== 'string' || relative.length > 4096)) throw new HarnessError('INVALID_INPUT', 'Invalid resource path');
    reply.header('Cache-Control', 'no-store');
    return withResourceGrant(resource, service.store.dataDir, relative || undefined, false, new AbortController().signal, async stable => {
      const info = await lstat(stable);
      if (info.isFile()) return { path: relative ?? '', entries: [{ name: basename(stable), path: relative ?? '', kind: 'file', bytes: info.size }], truncated: false };
      if (!info.isDirectory()) throw new HarnessError('CAPABILITY_DENIED', 'Only ordinary directories can be inspected');
      const names = await readdir(stable, { withFileTypes: true });
      const entries: { name: string; path: string; kind: 'file' | 'directory'; bytes: number }[] = [];
      // The parent directory remains under the native path guard. Never follow a
      // child link, and list a single level instead of traversing a live namespace.
      const listed = names.slice(0, 600);
      // lstat entries in bounded parallel batches instead of one syscall at a time.
      const stats = await Promise.all(listed.map(item => (item.isSymbolicLink() || (!item.isFile() && !item.isDirectory())) ? null : lstat(join(stable, item.name)).catch(() => null)));
      for (let index = 0; index < listed.length; index++) {
        const item = listed[index], child = stats[index];
        if (!child || child.isSymbolicLink() || (child.isFile() && child.nlink > 1)) continue;
        entries.push({ name: item.name, path: [relative?.replaceAll('\\', '/'), item.name].filter(Boolean).join('/'), kind: child.isDirectory() ? 'directory' : 'file', bytes: child.isFile() ? child.size : 0 });
      }
      entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1));
      return { path: relative ?? '', entries: entries.slice(0, 300), truncated: names.length > 600 || entries.length > 300 };
    });
  });
  app.get("/health", async () => ({ ok: true }));
  app.get(WIDGET_WORKER_PATH, async (_request, reply) => {
    reply.header("Content-Security-Policy", WIDGET_WORKER_CSP).header("Cache-Control", "no-cache");
    try { return reply.type("text/javascript; charset=utf-8").send(await readFile(resolve(assets, "dist/widget-runtime/worker.js"))); }
    catch { return reply.code(503).type("text/plain").send("Build the trusted widget runtime with pnpm build:widgets."); }
  });
  if (!options.dev) app.get("/*", async (request, reply) => {
    if (request.url.startsWith("/api/")) throw new HarnessError("NOT_FOUND", "Route not found");
    const root = resolve(assets, "dist/web"); let path = resolve(root, "." + decodeURIComponent(request.url.split("?")[0]));
    if (!inside(root, path)) throw new HarnessError("CAPABILITY_DENIED", "Path is unavailable");
    try { if (!(await stat(path)).isFile()) path = join(root, "index.html"); } catch { path = join(root, "index.html"); }
    try {
      const type=mime(path);
      if(type==='text/html'){
        // frame-src on the embedding document governs self-navigation of its
        // opaque children. A plug-in's own frame-src only governs grandchildren.
        const origin='http://'+String(request.headers.host),frames=(options.plugins?.list()??[]).map(plugin=>`${origin}/plugins/${plugin.id}/frame`);
        reply.header('Content-Security-Policy',`frame-src ${[...frames,`http://localhost:${widgetPort}/widget/`].join(' ')}; object-src 'none'; base-uri 'self'`);
      }
      return reply.type(type).send(await readFile(path));
    } catch { return reply.code(503).type("text/plain").send("Build the application with pnpm build, or use pnpm dev."); }
  });
  app.addHook("preClose", async () => {
    await Promise.all([...streams].map(stream => new Promise<void>(done => { stream.once('close', done); stream.destroy(); })));
    streams.clear();
  });
  return app;
}
export async function buildWidgetServer(service: Service, mounts: MountRegistry, port = 4318) {
  const app = Fastify({ logger: false });
  app.get<{ Params: { id: string; revision: string }; Querystring: { ticket?: string } }>("/widget/:id/:revision", async (request, reply) => {
    if (!["localhost:" + port, "127.0.0.1:" + port].includes(String(request.headers.host))) return reply.code(403).send("Invalid host");
    const ticket = request.query.ticket ?? "", mount = mounts.get(ticket); mounts.delete(ticket);
    if (!mount || mount.expiresAt < Date.now() || mount.artifactId !== request.params.id || mount.revision !== Number(request.params.revision)) return reply.code(403).send("Mount ticket expired. Reopen the interface.");
    const artifact = service.store.get<ArtifactRecord>("artifactVersion", mount.artifactId + "@" + mount.revision);
    if (!artifact?.widget) return reply.code(404).send("Widget unavailable");
    return reply.header("Content-Security-Policy", WIDGET_SHELL_CSP).header("Referrer-Policy", "no-referrer").header("X-Content-Type-Options", "nosniff").header("Cache-Control", "no-store").type("text/html; charset=utf-8").send(widgetShellDocument(artifact.id));
  });
  return app;
}
