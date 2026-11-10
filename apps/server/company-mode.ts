import Fastify from 'fastify';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {open, readFile, stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {extname, join, relative, resolve, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {CompanyClient, CompanyError} from '../../packages/company-client/index.ts';
import {WorkPlanClient, WorkPlanError} from '../../packages/company-client/work-plan.ts';
import {COMPANY_PROTOCOL, COMPANY_SERVICE_BASELINE, COMPANY_BACKEND_CHECKPOINT, COMPANY_MANIFEST_SHA256, CompanyScopeSchema, ArtifactPreviewInputSchema} from '../../packages/company-contracts/index.ts';
import {acquireProfileLease} from './profile-lease.ts';
import {registerCompanyWorkflow, type CompanyInstructionClient, type CompanyWorkPlanClient, type CompanyWorkPlanReader} from './company-workflow.ts';
import {readApprovedJobFile} from './company-approved-job.ts';
import type {ApprovedJobRead} from '../../packages/company-contracts/approved-job-read.ts';
import {CompanyManagerError, CompanyManagerInputSchema} from '../../packages/company-manager/contracts.ts';
import type {CompanyManagerJournal} from '../../packages/company-manager/journal.ts';
import {COMPANY_MANAGER_CONTRACT_ID, COMPANY_MANAGER_CONTRACT_VERSION, COMPANY_MANAGER_BACKEND_CHECKPOINT, COMPANY_MANAGER_MANIFEST_SHA256, ProjectContextInputSchema, TaskContextInputSchema} from '../../packages/company-contracts/manager.ts';
import {COMPANY_PLANNING_CONTRACT_ID, COMPANY_PLANNING_CONTRACT_VERSION, COMPANY_PLANNING_BACKEND_CHECKPOINT, COMPANY_PLANNING_MANIFEST_SHA256, COMPANY_PLANNING_TRANSPORT, MandateSetInputSchema, IntakeRecordInputSchema, ProposalSubmitInputSchema, ProposalReviewInputSchema, PlanningContextInputSchema} from '../../packages/company-contracts/planning.ts';

// This host is a client of Company Control. It never creates a personal Service,
// native runtime, worker, company Store, publisher, or scheduling loop.
export type CompanyReader = Pick<CompanyClient, 'role' | 'status' | 'artifactPreview' | 'reviewPackage'>;
export type CompanyContextReader = Pick<CompanyClient, 'role' | 'projectContext' | 'taskContext'>;
export type CompanyPlanningClient = Pick<CompanyClient, 'role' | 'setMandate' | 'recordIntake' | 'submitProposal' | 'reviewProposal' | 'planningContext'>;
export interface CompanyHostOptions {port: number; dataDir: string; client?: CompanyReader; instructionClient?: CompanyInstructionClient; workPlanClient?: CompanyWorkPlanClient; workPlanReader?: CompanyWorkPlanReader; approvedJob?: ApprovedJobRead; manager?: CompanyManagerJournal; contextReader?: CompanyContextReader; planningClient?: CompanyPlanningClient}
export interface CompanyManagerHostComposition {manager: CompanyManagerJournal; close(): Promise<void>}
export type CompanyManagerHostFactory = (dataDir: string) => CompanyManagerHostComposition | Promise<CompanyManagerHostComposition>;
interface ServerOptions {port: number; client?: CompanyReader; instructionClient?: CompanyInstructionClient; workPlanClient?: CompanyWorkPlanClient; workPlanReader?: CompanyWorkPlanReader; approvedJob?: ApprovedJobRead; manager?: CompanyManagerJournal; contextReader?: CompanyContextReader; planningClient?: CompanyPlanningClient}
type Session = {csrf: string; expiresAt: number; ownerAuthenticated: boolean};
const sessionLifetime = 12 * 60 * 60 * 1000;
const emptyQuery = z.strictObject({});
const planningErrorStatus: Record<string, number> = {
  COMPANY_AUTH: 401, COMPANY_FORBIDDEN: 403, COMPANY_REQUEST: 400, COMPANY_NOT_FOUND: 404,
  COMPANY_MESSAGE_CONFLICT: 409, COMPANY_REVISION_CONFLICT: 409, COMPANY_STALE_BASIS: 409, COMPANY_REFERENCE_MISMATCH: 409,
  COMPANY_RECORD_TOO_LARGE: 413, COMPANY_STORAGE_UNAVAILABLE: 503, COMPANY_CAPABILITY_UNAVAILABLE: 503,
  COMPANY_TIMEOUT: 504, COMPANY_RESPONSE: 502, COMPANY_TRANSPORT: 503,
};
const workPlanLocalStatus: Record<string, number> = {REQUEST: 400, RESPONSE: 502, TIMEOUT: 504, ABORTED: 408};
const mime: Record<string, string> = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff'};
const companyCsp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function hostPort(value: unknown, allowEphemeral = false): number {
  const text = String(value);
  if (!/^\d{1,5}$/.test(text)) throw new Error('The company port must be an integer from 1 to 65535.');
  const port = Number(text);
  if (!Number.isSafeInteger(port) || port < (allowEphemeral ? 0 : 1) || port > 65535) throw new Error('The company port must be an integer from 1 to 65535.');
  return port;
}

export function readCompanyHostOptions(env: NodeJS.ProcessEnv = process.env): CompanyHostOptions {
  const directory = env.HARNESS_COMPANY_DATA_DIR;
  if (directory !== undefined && !directory.trim()) throw new Error('The company profile directory must be nonempty.');
  const origin = env.GEN_COMPANY_SERVICE_ORIGIN, token = env.GEN_COMPANY_SERVICE_TOKEN, tokenFile = env.GEN_COMPANY_SERVICE_TOKEN_FILE;
  if (tokenFile !== undefined && (token !== undefined || !tokenFile.trim() || !isAbsolute(tokenFile))) throw new Error('Use one explicit owner credential source and an absolute token-file path.');
  const hasCredential = Boolean(token || tokenFile);
  if (Boolean(origin) !== hasCredential) throw new Error('A company connection requires both its service origin and a separate owner service credential.');
  // This callback stays in the trusted host. Read only on a requested call,
  // bound the bytes before decoding, and let the service recheck current auth.
  const credential = tokenFile ? async () => {
    const handle = await open(tokenFile, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size < 1 || info.size > 4096) throw new Error('Owner credential unavailable.');
      const bytes = Buffer.alloc(4097), read = await handle.read(bytes, 0, bytes.length, 0);
      const value = bytes.subarray(0, read.bytesRead).toString('utf8');
      if (read.bytesRead !== info.size || !/^[\x21-\x7e]{1,4096}$/.test(value)) throw new Error('Owner credential unavailable.');
      return value;
    } finally {await handle.close();}
  } : () => token!;
  const intake = env.GEN_COMPANY_PLANNING_INTAKE;
  if (intake !== undefined && intake !== 'true' && intake !== 'false' || intake === 'true' && (!origin || !hasCredential)) throw new Error('Planning intake requires an explicit owner service connection.');
  const client = origin && hasCredential ? new CompanyClient({origin, role: 'owner', credential}) : undefined;
  const workPlans = env.GEN_COMPANY_WORK_PLANS;
  if (workPlans !== undefined && workPlans !== 'true' && workPlans !== 'false' || workPlans === 'true' && (!origin || !hasCredential)) throw new Error('Work plan storage requires an explicit owner service connection.');
  const approvedJob = env.GEN_COMPANY_APPROVED_JOB_FILE === undefined ? undefined : readApprovedJobFile(env.GEN_COMPANY_APPROVED_JOB_FILE);
  if (approvedJob && (!client || intake === 'true' || workPlans === 'true')) throw new Error('Approved job reads require a separate read-only company connection.');
  const planReader = approvedJob && origin ? new WorkPlanClient({origin, role: 'owner', credential}) : undefined;
  return {
    port: hostPort(env.HARNESS_COMPANY_PORT ?? 4319),
    dataDir: resolve(directory ?? join(env.LOCALAPPDATA ?? homedir(), 'GenerativeHarnessCompany')),
    ...(client ? {client, ...(intake === 'true' ? {instructionClient: client} : {})} : {}),
    ...(origin && hasCredential && workPlans === 'true' ? {workPlanClient: new WorkPlanClient({origin, role: 'owner', credential})} : {}),
    ...(approvedJob && client && planReader ? {approvedJob, workPlanReader: {role: 'owner' as const, read: planReader.read.bind(planReader)}, contextReader: {
      role: 'owner' as const,
      projectContext: (input: Parameters<CompanyClient['projectContext']>[0]) => {if (input.project_id !== approvedJob.projectId) return Promise.reject(new CompanyError('COMPANY_FORBIDDEN')); return client.projectContext(input);},
      taskContext: async () => {throw new CompanyError('COMPANY_CAPABILITY_UNAVAILABLE');},
    }} : {}),
  };
}

export async function buildCompanyServer(options: ServerOptions) {
  hostPort(options.port, true);
  if (options.client && options.client.role !== 'owner') throw new Error('The owner interface requires its own owner service credential.');
  if (options.contextReader && options.contextReader.role !== 'owner') throw new Error('The context interface requires its own owner service credential.');
  if (options.planningClient && options.planningClient.role !== 'owner') throw new Error('The planning interface requires its own owner service credential.');
  const app = Fastify({logger: false, bodyLimit: 32768, requestTimeout: 10000});
  const sessions = new Map<string, Session>();
  const listeningPort = () => {const address = app.server.address(); return address && typeof address !== 'string' ? address.port : options.port;};
  const currentSession = (cookie: string | undefined) => {
    const id = /(?:^|;\s*)company_session=([a-f0-9]{64})(?:;|$)/.exec(cookie ?? '')?.[1];
    const session = id ? sessions.get(id) : undefined;
    return session && session.expiresAt > Date.now() ? session : undefined;
  };
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof WorkPlanError) return reply.code(error.status ?? workPlanLocalStatus[error.code] ?? 503).send({error: {code: error.code, message: 'The company service could not confirm this exact work plan operation. Refresh the saved plan before another decision.'}});
    const invalid = error instanceof z.ZodError;
    const known = error instanceof CompanyError || error instanceof CompanyManagerError;
    const oversized = (error as {statusCode?: number}).statusCode === 413;
    const snapshotChanged = error instanceof CompanyError && error.restartRequired;
    const planning = request.routeOptions.url?.startsWith('/api/company/planning/') || request.routeOptions.url?.startsWith('/api/company/workflow');
    const planningStatus = planning && error instanceof CompanyError ? planningErrorStatus[error.code] : undefined;
    reply.code(oversized ? 413 : planningStatus ?? (snapshotChanged ? 409 : invalid || error instanceof CompanyManagerError && error.code === 'COMPANY_MANAGER_INPUT' ? 400 : 503)).send({error: {
      code: oversized ? 'COMPANY_REQUEST' : invalid ? 'INVALID_INPUT' : known ? error.code : 'COMPANY_UNAVAILABLE',
      message: oversized ? 'The company request is too large.' : invalid ? 'Use the exact company request fields and scope.' : known ? error.message : planning ? 'The company service could not complete this planning request.' : 'The company service could not complete this read.',
      ...(snapshotChanged ? {restartRequired: true} : {}),
    }});
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('Content-Security-Policy', companyCsp);
    const port = listeningPort();
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(String(request.headers.host))) return reply.code(403).send({error: {code: 'INVALID_HOST', message: 'Host is not allowed.'}});
    if (request.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(String(request.headers.origin))) return reply.code(403).send({error: {code: 'INVALID_ORIGIN', message: 'Origin is not allowed.'}});
    if (!request.url.startsWith('/api/')) return;
    emptyQuery.parse(request.query);
    if (request.url === '/api/bootstrap') return;
    const session = currentSession(request.headers.cookie);
    if (!session) return reply.code(401).send({error: {code: 'AUTH_REQUIRED', message: 'Reconnect to the company interface.'}});
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const supplied = Buffer.from(String(request.headers['x-harness-csrf'] ?? '')), expected = Buffer.from(session.csrf);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply.code(403).send({error: {code: 'CSRF_REQUIRED', message: 'Refresh the company interface before this read.'}});
    }
  });
  app.get('/api/bootstrap', async (request, reply) => {
    const existing = currentSession(request.headers.cookie);
    if (existing) return {csrfToken: existing.csrf, mode: 'company'};
    for (const [id, session] of sessions) if (session.expiresAt <= Date.now()) sessions.delete(id);
    if (sessions.size >= 256) return reply.code(503).send({error: {code: 'SESSION_LIMIT', message: 'The company interface has reached its local session limit.'}});
    const id = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
    sessions.set(id, {csrf, expiresAt: Date.now() + sessionLifetime, ownerAuthenticated: false});
    reply.header('Set-Cookie', `company_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetime / 1000}`);
    return {csrfToken: csrf, mode: 'company'};
  });
  app.get('/api/company/connection', async request => ({
    configured: Boolean(options.client), protocol: COMPANY_PROTOCOL, serviceBaseline: COMPANY_SERVICE_BASELINE,
    backendCheckpoint: COMPANY_BACKEND_CHECKPOINT, manifestSHA256: COMPANY_MANIFEST_SHA256,
    mode: options.planningClient ? 'planning_records' : 'read_only', ownerAuthenticated: currentSession(request.headers.cookie)?.ownerAuthenticated ?? false,
    capabilities: {status: Boolean(options.client), artifactPreview: false, reviewPackage: false, planning: false, dispatch: false, publication: false, events: false, emergencyStop: false},
    blockers: [
      ...(!options.client ? ['No separate Company Control owner connection is configured.'] : []),
      'Native planning, employee dispatch, owner mutations and publication are disabled in this client.',
      'Remote ingress, live capability negotiation and whole-process emergency termination are unavailable.',
      'E01 Gen migration requires separate acceptance and cutover; the current roster is unchanged.',
    ],
  }));
  const read = async (cookie: string | undefined, operation: (client: CompanyReader) => Promise<unknown>) => {
    const session = currentSession(cookie);
    if (!options.client) throw new Error('Company connection unavailable.');
    try {
      const data = await operation(options.client);
      if (session) session.ownerAuthenticated = true;
      return {data, receivedAt: new Date().toISOString(), source: 'company_service', protocol: COMPANY_PROTOCOL, serviceBaseline: COMPANY_SERVICE_BASELINE, backendCheckpoint: COMPANY_BACKEND_CHECKPOINT, manifestSHA256: COMPANY_MANIFEST_SHA256};
    } catch (error) {if (session) session.ownerAuthenticated = false; throw error;}
  };
  app.post('/api/company/status', async request => {
    const input = z.strictObject({scope: CompanyScopeSchema}).parse(request.body);
    return read(request.headers.cookie, client => client.status(input.scope));
  });
  app.post('/api/company/artifacts/preview', async request => {
    const input = ArtifactPreviewInputSchema.parse(request.body);
    return read(request.headers.cookie, client => client.artifactPreview(input));
  });
  if (Boolean(options.approvedJob) !== Boolean(options.workPlanReader)) throw new Error('Approved job reads require an exact read binding.');
  registerCompanyWorkflow(app, options.instructionClient, options.workPlanClient, options.approvedJob && options.workPlanReader ? {binding: options.approvedJob, client: options.workPlanReader} : undefined);
  // A separate reviewed candidate, supplied by trusted host composition only.
  // The ordinary CLI keeps it unavailable until backend ingress is verified.
  const contextPin = {contractId: COMPANY_MANAGER_CONTRACT_ID, contractVersion: COMPANY_MANAGER_CONTRACT_VERSION, backendCheckpoint: COMPANY_MANAGER_BACKEND_CHECKPOINT, manifestSHA256: COMPANY_MANAGER_MANIFEST_SHA256};
  app.get('/api/company/context/availability', async () => ({
    configured: Boolean(options.contextReader), ...contextPin, ownerHostOnly: true, engineAccess: false,
    blockers: options.contextReader ? [] : ['The company context candidate has no verified backend ingress configured.'],
  }));
  const contextRead = async (cookie: string | undefined, operation: (client: CompanyContextReader) => Promise<unknown>) => {
    const session = currentSession(cookie);
    if (!options.contextReader) throw new Error('Company context unavailable.');
    try {
      const data = await operation(options.contextReader);
      if (session) session.ownerAuthenticated = true;
      return {data, receivedAt: new Date().toISOString(), source: 'company_service', ...contextPin};
    } catch (error) {if (session) session.ownerAuthenticated = false; throw error;}
  };
  app.post('/api/company/context/project', async request => {
    const input = ProjectContextInputSchema.parse(request.body);
    return contextRead(request.headers.cookie, client => client.projectContext(input));
  });
  app.post('/api/company/context/task', async request => {
    const input = TaskContextInputSchema.parse(request.body);
    return contextRead(request.headers.cookie, client => client.taskContext(input));
  });
  // Planning-record storage is a separate owner capability. No CLI flag installs
  // it, and no model tool receives this client or its credential.
  const planningPin = {contractId: COMPANY_PLANNING_CONTRACT_ID, contractVersion: COMPANY_PLANNING_CONTRACT_VERSION, backendCheckpoint: COMPANY_PLANNING_BACKEND_CHECKPOINT, manifestSHA256: COMPANY_PLANNING_MANIFEST_SHA256};
  app.get('/api/company/planning/availability', async () => ({
    configured: Boolean(options.planningClient), ...planningPin, mode: 'planning_records_only',
    executionAuthorized: false, dispatchAuthorized: false, engineAccess: false,
    blockers: options.planningClient ? [] : ['The planning command candidate has no verified backend ingress configured.'],
  }));
  const planningCall = async (cookie: string | undefined, operation: (client: CompanyPlanningClient) => Promise<unknown>) => {
    if (!options.planningClient) throw new CompanyError('COMPANY_CAPABILITY_UNAVAILABLE');
    const session = currentSession(cookie);
    try {
      const data = await operation(options.planningClient);
      if (session) session.ownerAuthenticated = true;
      return {data, receivedAt: new Date().toISOString(), source: 'company_service', ...planningPin};
    } catch (error) {if (session) session.ownerAuthenticated = false; throw error;}
  };
  const planningBody = {bodyLimit: COMPANY_PLANNING_TRANSPORT.requestBytes};
  app.post('/api/company/planning/mandate', planningBody, async request => {
    const input = MandateSetInputSchema.parse(request.body);
    return planningCall(request.headers.cookie, client => client.setMandate(input));
  });
  app.post('/api/company/planning/intake', planningBody, async request => {
    const input = IntakeRecordInputSchema.parse(request.body);
    return planningCall(request.headers.cookie, client => client.recordIntake(input));
  });
  app.post('/api/company/planning/proposal', planningBody, async request => {
    const input = ProposalSubmitInputSchema.parse(request.body);
    return planningCall(request.headers.cookie, client => client.submitProposal(input));
  });
  app.post('/api/company/planning/review', planningBody, async request => {
    const input = ProposalReviewInputSchema.parse(request.body);
    return planningCall(request.headers.cookie, client => client.reviewProposal(input));
  });
  app.post('/api/company/planning/context', planningBody, async request => {
    const input = PlanningContextInputSchema.parse(request.body);
    return planningCall(request.headers.cookie, client => client.planningContext(input));
  });
  // These are Gen interaction endpoints, not new Company Control operations.
  // Trusted host code supplies an admitted E01 runtime with a separate employee
  // credential. No environment flag or browser request can construct one.
  app.get('/api/company/manager/availability', async () => ({
    configured: Boolean(options.manager), mode: 'shadow_proposals',
    admission: 'checked_per_request', dispatchAuthorized: false, durableCompanyStorage: false,
    blockers: options.manager ? [] : ['Trusted E01 inference admission and company runtime composition are unavailable.'],
  }));
  const managerReference = CompanyManagerInputSchema.omit({instruction: true});
  const ownerProject = (cookie: string | undefined, projectId: string) => read(cookie, client => client.status({kind: 'project', id: projectId}));
  const manager = () => {if (!options.manager) throw new CompanyManagerError('COMPANY_MANAGER_BLOCKED'); return options.manager;};
  app.post('/api/company/manager/propose', async request => {
    const input = CompanyManagerInputSchema.parse(request.body), journal = manager();
    await ownerProject(request.headers.cookie, input.projectId);
    return journal.propose(input);
  });
  app.post('/api/company/manager/request', async (request, reply) => {
    const input = managerReference.parse(request.body), journal = manager();
    await ownerProject(request.headers.cookie, input.projectId);
    const record = journal.get(input.projectId, input.requestId);
    return record ?? reply.code(404).send({error: {code: 'NOT_FOUND', message: 'The local manager interaction is unavailable.'}});
  });
  app.post('/api/company/manager/cancel', async request => {
    const input = managerReference.parse(request.body), journal = manager();
    await ownerProject(request.headers.cookie, input.projectId);
    return journal.cancel(input.projectId, input.requestId);
  });
  app.get('/', async (_request, reply) => reply.redirect('/company'));
  app.get('/*', async (request, reply) => {
    if (request.url.startsWith('/api/') || request.url.startsWith('/widget-runtime/')) return reply.code(404).send({error: {code: 'NOT_FOUND', message: 'This company capability is unavailable.'}});
    const root = fileURLToPath(new URL('../../dist/web/', import.meta.url));
    const pathname = decodeURIComponent(request.url.split('?')[0]);
    const path = pathname === '/company' || pathname.startsWith('/company/') ? join(root, 'index.html') : resolve(root, '.' + pathname);
    const within = relative(root, path);
    if (within.startsWith('..') || isAbsolute(within)) return reply.code(404).send();
    try {
      if (!(await stat(path)).isFile()) return reply.code(404).send();
      return reply.type(mime[extname(path)] ?? 'application/octet-stream').send(await readFile(path));
    } catch {return reply.code(503).type('text/plain').send('Build the Gen application with pnpm build to open the company interface.');}
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({error: {code: 'NOT_FOUND', message: 'This company capability is unavailable.'}}));
  app.addHook('onClose', async () => {sessions.clear();});
  app.addHook('preClose', async () => {await options.manager?.dispose();});
  return app;
}

export async function launchCompanyHost(options: CompanyHostOptions, composeManager?: CompanyManagerHostFactory) {
  hostPort(options.port, true);
  if (composeManager && options.manager) throw new CompanyManagerError('COMPANY_MANAGER_BLOCKED');
  const profile = acquireProfileLease(options.dataDir);
  let app: Awaited<ReturnType<typeof buildCompanyServer>> | undefined;
  let composition: CompanyManagerHostComposition | undefined;
  try {
    // Only trusted code supplies this factory. The normal environment/browser
    // path never creates one and imports no manager runtime or account service.
    composition = await composeManager?.(profile.dataDir);
    app = await buildCompanyServer({...options, ...(composition ? {manager: composition.manager} : {})});
    if (composition) app.addHook('onClose', () => composition!.close());
    await app.listen({host: '127.0.0.1', port: options.port});
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('The company interface did not establish its loopback listener.');
    let closing: Promise<void> | undefined;
    const owned = app;
    return {origin: `http://127.0.0.1:${address.port}`, pid: process.pid, close: () => closing ??= owned.close().then(() => profile.close())};
  } catch (error) {
    try {await app?.close(); await composition?.close();} catch {throw new CompanyManagerError('COMPANY_MANAGER_CLEANUP');}
    profile.close(); throw error;
  }
}
