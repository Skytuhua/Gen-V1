import {afterEach, expect, it} from 'vitest';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {StdioLspAdapter} from '../packages/core/code-intelligence.ts';

const roots: string[] = [], adapters: StdioLspAdapter[] = [];
afterEach(async () => {
  for (const adapter of adapters.splice(0)) await adapter.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true, maxRetries: 5});
});

// A minimal LSP peer: Content-Length framing and one `initialize` answer.
const server = (body: string) => `
${body}
function start(){
let buffer=Buffer.alloc(0);
process.stdin.on('data',value=>{
 buffer=Buffer.concat([buffer,value]);
 for(;;){
  const header=buffer.indexOf('\\r\\n\\r\\n');
  if(header<0)return;
  const match=/Content-Length:\\s*(\\d+)/i.exec(buffer.subarray(0,header).toString('utf8'));
  if(!match){buffer=buffer.subarray(header+4);continue;}
  const length=Number(match[1]);
  if(buffer.length<header+4+length)return;
  const message=JSON.parse(buffer.subarray(header+4,header+4+length).toString('utf8'));
  buffer=buffer.subarray(header+4+length);
  if(message.id===undefined)continue;
  const result=message.method==='initialize'?{capabilities:{positionEncoding:'utf-8'}}:null;
  const payload=Buffer.from(JSON.stringify({jsonrpc:'2.0',id:message.id,result}));
  process.stdout.write('Content-Length: '+payload.length+'\\r\\n\\r\\n');
  process.stdout.write(payload);
 }
});
}
`;

async function fixture(body: string) {
  const root = await mkdtemp(join(tmpdir(), 'gen-lsp-stdio-'));
  roots.push(root);
  const script = join(root, 'server.cjs');
  await writeFile(script, server(body));
  const adapter = new StdioLspAdapter({language: 'test', executable: process.execPath, argv: [script], configDigest: 'a'.repeat(64)}, root);
  adapters.push(adapter);
  return {root, adapter};
}

const document = (root: string, version = 1) => {
  const path = join(root, 'sample.ts');
  return {path, uri: pathToFileURL(path).href, languageId: 'typescript', version, digest: '0'.repeat(64), text: 'const value = 1;\n'};
};

it('initializes a language server that logs to stderr before answering', {timeout: 20000}, async () => {
  // Wait for a 4 MiB stderr write before reading the first request. An unread
  // pipe stalls the callback; a synchronous fd write can instead throw EAGAIN.
  const {root, adapter} = await fixture(`process.stderr.write(Buffer.alloc(4*1024*1024,120),error=>{if(error)throw error;start();});`);
  await adapter.openDocument(document(root), new AbortController().signal);
  expect(adapter.encoding).toBe('UTF8');
});

