import {app, BrowserWindow, dialog, ipcMain} from 'electron';
import {createServer} from 'node:http';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';
import {createMemoryExportDownloads} from '../../apps/desktop/memory-export.ts';

// Diagnostic-only process. It does not import the application host, accounts or providers.
const configPath = process.argv.find(value => value.startsWith('--fixture-config='))?.slice(17);
if (!configPath || resolve(configPath) !== configPath) throw Error('A fixed fixture configuration is required.');
const config = JSON.parse(await readFile(configPath, 'utf8')) as {mode: 'direct' | 'policy'; root: string; nonce: string; preload: string; debugPort: number};
if (!['direct', 'policy'].includes(config.mode) || resolve(config.root) !== config.root || !/^[a-f0-9]{48}$/.test(config.nonce) || config.preload !== join(config.root, 'preload.cjs') || !Number.isInteger(config.debugPort) || config.debugPort < 1 || config.debugPort > 65535) throw Error('Invalid fixture configuration.');
app.setPath('userData', join(config.root, 'profile'));
app.commandLine.appendSwitch('remote-debugging-port', String(config.debugPort));
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
app.commandLine.appendSwitch('enable-automation');

const title = 'M05 native Save diagnostic';
const value = {scope: {projectId: 'diagnostic:project', projectIdentity: 'a'.repeat(64), threadId: 'diagnostic-thread', accountId: null, bindingDigest: 'b'.repeat(64)}, redacted: true,
  items: [{id: 'diagnostic-memory', revision: 1, kind: 'CONSTRAINT', state: 'ACCEPTED', text: 'Synthetic diagnostic. Use UTC.', sourceDigests: ['c'.repeat(64)]}], tombstones: []};
const canonical = JSON.stringify(value, null, 2) + '\n';
const filename = 'project-memory-diagnostic_project.json';
const target = join(config.root, 'installed-memory-redacted-export.json');
const started = Date.now();
type Event = {phase: string; elapsedMs: number; [key: string]: unknown};
const events: Event[] = [];
const record = (phase: string, fields: Record<string, unknown> = {}) => {if (events.length < 32) events.push({phase, elapsedMs: Date.now() - started, ...fields});};
let closing = false, invoked = false, status = 'waiting';
let outcome: {status: string; admitted: boolean; filename: string; bytes: number; sha256: string} | null = null;
let window: BrowserWindow | undefined;
let documentUrl = '';
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/' && request.method === 'GET' && url.searchParams.get('fixture') === config.nonce) {
    response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"});
    response.end('<!doctype html><html lang="en"><title>' + title + '</title><body><h1>' + title + '</h1><button id="export">Export redacted JSON</button><output id="status">waiting</output><script>document.getElementById("export").addEventListener("click",()=>{document.getElementById("export").disabled=true;document.getElementById("status").textContent="pending";window.nativeSaveDiagnostic.start().then(value=>{document.getElementById("status").textContent=value.status},()=>{document.getElementById("status").textContent="failed"})})</script></body></html>'); return;
  }
  if (request.headers['x-fixture-owner'] !== config.nonce) {response.writeHead(403).end(); return;}
  if (url.pathname === '/state' && request.method === 'GET') {
    response.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
    response.end(JSON.stringify({version: 1, mode: config.mode, pid: process.pid, electron: process.versions.electron, status, outcome, events})); return;
  }
  if (url.pathname === '/shutdown' && request.method === 'POST') {
    closing = true; response.writeHead(200).end('{}');
    setTimeout(() => {window?.destroy(); server.close(() => app.quit());}, 25); return;
  }
  response.writeHead(404).end();
});
await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
const address = server.address();
if (!address || typeof address === 'string') throw Error('Fixture loopback address unavailable.');
const origin = 'http://127.0.0.1:' + address.port;
documentUrl = origin + '/?fixture=' + config.nonce;
await app.whenReady();
window = new BrowserWindow({title, width: 800, height: 600, show: true, webPreferences: {preload: config.preload, sandbox: true, contextIsolation: true, nodeIntegration: false}});
const owned = window, contents = owned.webContents, policy = createMemoryExportDownloads();
contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
contents.session.setPermissionCheckHandler(() => false);
contents.session.webRequest.onBeforeRequest((details, callback) => callback({cancel: !details.url.startsWith(origin + '/') && !details.url.startsWith('data:')}));
contents.setWindowOpenHandler(() => ({action: 'deny'}));
contents.on('will-navigate', event => event.preventDefault());
policy.guard(contents.session);
contents.session.on('will-download', (event, item, sender, frame) => {
  try {
    const main = contents.mainFrame;
    record('download-observed', {prevented: event.defaultPrevented, senderMatches: sender === contents, frameMatches: frame === main,
      originMatches: item.getInitiatorOrigin() === origin, filenameMatches: item.getFilename() === filename,
      dataUrl: item.getURL().startsWith('data:application/json;'), chainLength: item.getURLChain().length,
      titleMatches: item.getSaveDialogOptions().title === 'Export project memory'});
    item.once('done', (_event, state) => record('download-done', {state: ['completed', 'cancelled', 'interrupted'].includes(state) ? state : 'other'}));
  } catch {record('download-observation-unavailable');}
});
ipcMain.handle('diagnostic:native-save', async event => {
  if (invoked || closing || event.sender !== contents || event.senderFrame !== contents.mainFrame || contents.getURL() !== documentUrl) throw Error('The fixture export owner changed.');
  invoked = true; status = 'pending'; record('trigger-admitted', {mode: config.mode});
  try {
    if (config.mode === 'direct') {
      record('direct-dialog-requested');
      const result = await dialog.showSaveDialog(owned, {title: 'Export project memory', defaultPath: filename, filters: [{name: 'JSON', extensions: ['json']}], properties: ['showOverwriteConfirmation']});
      record('direct-dialog-returned', {cancelled: result.canceled, selectedExactTarget: result.filePath === target});
      if (result.canceled || result.filePath !== target) throw Error('The direct native dialog did not select the owned fixed target.');
      await writeFile(target, canonical, {flag: 'wx'});
      outcome = {status: 'saved', admitted: true, filename, bytes: Buffer.byteLength(canonical), sha256: createHash('sha256').update(canonical).digest('hex')};
    } else {
      outcome = await policy.export({contents, surface: {kind: 'main'}, documentUrl, isCurrent: () => !closing && !owned.isDestroyed()}, JSON.stringify(value));
    }
    status = String(outcome.status); record('export-settled', {status}); return outcome;
  } catch (cause) {
    status = 'failed';
    // Only the fixed production error vocabulary is retained, never arbitrary exception text.
    const text = cause instanceof Error ? cause.message : '';
    const refusal = /refusal=(NO_OWNED_EVENT|CONTENTS_MISMATCH|FRAME_MISMATCH|ORIGIN_MISMATCH|URL_MISMATCH|CHAIN_MISMATCH|FILENAME_MISMATCH)/.exec(text)?.[1] ?? null;
    record('export-failed', {refusal, productionError: text.startsWith('Project memory export: ')});
    throw Error('The fixture export failed.');
  }
});
await owned.loadURL(documentUrl);
record('renderer-ready');
process.stdout.write('M05_NATIVE_SAVE_READY=' + JSON.stringify({origin, documentUrl, pid: process.pid, electron: process.versions.electron}) + '\n');
app.on('window-all-closed', () => {server.close(); app.quit();});
setTimeout(() => {closing = true; owned.destroy(); server.close(); app.exit(2);}, 150000).unref();
