import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {readFileSync} from 'node:fs';
import {buildServer} from '../../apps/server/server';
import {Service} from '../../packages/core/service';
import type {RuntimeAdapter} from '../../packages/contracts';
import {researchFixture, context, command, textSource} from '../research-fixture';

const f = await researchFixture();
const runtime: RuntimeAdapter = {configure() {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
const service = new Service(f.store, runtime), app = await buildServer(service, {port: 5529, dev: false});
app.post<{Body: {action: string}}>('/api/__research-test', async request => {
  if (request.body.action === 'reset') {
    f.store.db.prepare("DELETE FROM entities WHERE kind LIKE 'research%'").run();
    f.store.internal('grant', null, () => f.store.put('resource', f.grant.id, f.thread.id, f.grant));
  }
  if (request.body.action === 'revoke') f.store.internal('revoke', null, () => f.store.remove('resource', f.grant.id));
  if (request.body.action === 'restore') f.store.internal('grant', null, () => f.store.put('resource', f.grant.id, f.thread.id, f.grant));
  if (request.body.action === 'many') for (let i = 0; i < 45; i++) await service.command({...textSource(crypto.randomUUID(), 'abc'), payload: {...context, sourceId: 'source-' + String(i).padStart(2, '0'), title: `Synthetic source ${i}`, expectedRevision: 0, input: {kind: 'text', text: 'abc'}}});
  if (request.body.action === 'conflict') {
    const document = service.research.list(context, {kind: 'documents'}).items[0];
    await service.command(command(crypto.randomUUID(), 'document.save', {documentId: document.id, expectedRevision: document.revision, title: 'Shared findings', kind: 'findings', body: 'Saved elsewhere', citations: []}));
  }
  if (request.body.action === 'revise') {
    const source = service.research.list(context, {kind: 'sources'}).items[0];
    await service.command(command(crypto.randomUUID(), 'source.capture', {sourceId: source.id, title: source.title, expectedRevision: source.revision, input: {kind: 'text', text: 'Changed capture'}}));
  }
  return {ok: true};
});
await app.listen({host: '127.0.0.1', port: 5530});
const candidate = process.env.RESEARCHUI_APP_CANDIDATE;
const vite = await createServer({configFile: false, root: 'apps/web', plugins: [
  {name: 'research-owned-App-candidate', enforce: 'pre', load(id) {if (candidate && id.replaceAll('\\', '/').split('?')[0].endsWith('/apps/web/src/App.tsx')) return readFileSync(candidate, 'utf8');}},
  react(),
], server: {host: '127.0.0.1', port: 5529, strictPort: true, proxy: {'/api': {target: 'http://127.0.0.1:5530', changeOrigin: false}}}});
await vite.listen();
async function close() {await vite.close(); await app.close(); await service.dispose(); await f.close(); process.exit(0);}
process.once('SIGTERM', () => void close()); process.once('SIGINT', () => void close());
