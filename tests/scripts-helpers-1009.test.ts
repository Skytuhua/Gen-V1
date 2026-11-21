import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,existsSync,readFileSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {collectGitTools,stageGitTools} from '../scripts/git-assets.ts';
import {apiResponse} from '../scripts/capture-ui/api.ts';
import {MOTION_PROBE_SOURCE} from '../scripts/motion-probe.ts';
import {EXPLORATION_REVIEW_DATA,explorationElements} from '../scripts/exploration-review-data.ts';
import {vendorIntegrations} from '../scripts/vendor-integrations.ts';

const dirs:string[]=[];
afterEach(()=>{while(dirs.length)rmSync(dirs.pop()!,{recursive:true,force:true});vi.unstubAllGlobals();});
const fresh=(name:string)=>{const dir=realpathSync(mkdtempSync(join(tmpdir(),name)));dirs.push(dir);return dir;};
const sha=(data:Buffer)=>createHash('sha256').update(data).digest('hex');

function toolBundle(root:string){
  for(const tool of ['git','gh']){
    const dir=join(root,'.harness-tool-bundles',tool);mkdirSync(dir,{recursive:true});
    writeFileSync(join(dir,'payload-'+tool),'tool-bytes-'+tool);
  }
  const files=['git','gh'].map(tool=>{
    const path=`.harness-tool-bundles/${tool}/payload-${tool}`,data=readFileSync(join(root,path));
    return {path,bytes:data.length,sha256:sha(data)};
  }).sort((a,b)=>a.path.localeCompare(b.path));
  const manifest={version:1,git:{version:'v',url:'u',archiveSha256:'a'.repeat(64)},github:{version:'v',url:'u',archiveSha256:'b'.repeat(64)},bytes:files.reduce((n,f)=>n+f.bytes,0),files};
  mkdirSync(join(root,'third-party/git-tools'),{recursive:true});
  writeFileSync(join(root,'third-party/git-tools/manifest.json'),JSON.stringify(manifest));
  return files;
}

describe('git-assets collectGitTools/stageGitTools',()=>{
 it('verifies a custody manifest and stages a byte-identical copy',async()=>{
  const root=fresh('git-src-'),files=toolBundle(root);
  const manifest=await collectGitTools(root);
  expect(manifest.files).toHaveLength(2);
  expect(manifest.bytes).toBe(files[0].bytes+files[1].bytes);
  const host=fresh('git-host-');
  await expect(stageGitTools(root,host)).resolves.toMatchObject({files:2});
  expect(readFileSync(join(host,'.harness-tool-bundles/git/payload-git'),'utf8')).toBe('tool-bytes-git');
  expect(existsSync(join(host,'third-party/git-tools/manifest.json'))).toBe(true);
 });
 it('rejects tampered payloads, bad versions and path escapes',async()=>{
  const root=fresh('git-src-');toolBundle(root);
  const manifest=join(root,'third-party/git-tools/manifest.json');
  writeFileSync(join(root,'.harness-tool-bundles/git/payload-git'),'tampered');
  await expect(collectGitTools(root)).rejects.toThrow(/custody changed/i);
  toolBundle(root);
  writeFileSync(manifest,JSON.stringify({...JSON.parse(readFileSync(manifest,'utf8')),version:2}));
  await expect(collectGitTools(root)).rejects.toThrow(/manifest is invalid/i);
  toolBundle(root);
  const valid=JSON.parse(readFileSync(manifest,'utf8'));
  valid.files.push({path:'.harness-tool-bundles/git/../../escape',bytes:1,sha256:'0'.repeat(64)});
  writeFileSync(manifest,JSON.stringify(valid));
  await expect(collectGitTools(root)).rejects.toThrow(/path is invalid|outside/i);
 });
 it('rejects a missing manifest',async()=>{
  const root=fresh('git-empty-');mkdirSync(join(root,'.harness-tool-bundles/git'),{recursive:true});
  await expect(collectGitTools(root)).rejects.toThrow();
 });
});

describe('apiResponse',()=>{
 const url=(path:string)=>new URL('https://host.test'+path);
 it('returns undefined on error or unmatched route',()=>{
  expect(apiResponse(url('/api/projects/p/files'),true)).toBeUndefined();
  expect(apiResponse(url('/api/unknown'))).toBeUndefined();
 });
 it('serves bounded file listings and file text',()=>{
  const list=apiResponse(url('/api/projects/p/files')) as {entries:unknown[];truncated:boolean};
  expect(list.entries).toHaveLength(1);expect(list.truncated).toBe(false);
  const empty=apiResponse(url('/api/projects/p/files'),false,true) as {entries:unknown[]};
  expect(empty.entries).toHaveLength(0);
  const file=apiResponse(url('/api/projects/p/file?path=src/main.ts')) as {text:string;sha256:string};
  expect(file.text.split('\n')).toHaveLength(60);expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
 });
 it('serves comparison fixtures for file and summary routes',()=>{
  const summary=apiResponse(url('/api/projects/p/comparison')) as {state:string};
  expect(summary.state).toBe('ready');
  const file=apiResponse(url('/api/projects/p/comparison/file')) as {state:string;text:string};
  expect(file.text).toContain('capture fixture value');
 });
});

describe('MOTION_PROBE_SOURCE',()=>{
 it('is a self-contained recording-only probe with bounded buffers',()=>{
  expect(MOTION_PROBE_SOURCE).toContain('__motionProbe');
  expect(MOTION_PROBE_SOURCE).toContain('requestAnimationFrame');
  expect(MOTION_PROBE_SOURCE).toContain('15000');
  expect(MOTION_PROBE_SOURCE).toContain('__reviewMotionSink');
  expect(MOTION_PROBE_SOURCE).not.toMatch(/fetch|XMLHttpRequest|sendBeacon/);
 });
});

describe('exploration-review-data',()=>{
 it('builds surface elements carrying the resource id',()=>{
  const elements=explorationElements('res-42');
  expect(JSON.stringify(elements)).toContain('res-42');
  expect(Object.keys(elements)).toEqual(expect.arrayContaining(['exploration','annotateImage','chooseSchedule','exploreLogs']));
 });
 it('ships non-empty review data',()=>expect(Object.keys(EXPLORATION_REVIEW_DATA).length).toBeGreaterThan(0));
});

describe('vendorIntegrations network boundary',()=>{
 it('fails closed when the upstream tree request fails',async()=>{
  vi.stubGlobal('fetch',async()=>({ok:false,status:503}));
  await expect(vendorIntegrations(fresh('vendor-'))).rejects.toThrow(/unavailable|503/i);
 });
});
