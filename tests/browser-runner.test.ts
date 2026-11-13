import {beforeEach,describe,expect,it,vi} from 'vitest';
import {spawnSync} from 'node:child_process';
import {existsSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {browserSuites,validateBrowserSuites,type BrowserSuite} from '../scripts/browser-suites.ts';
import {browserTestMain,runBrowserSuites} from '../scripts/test-browser.ts';

vi.mock('node:child_process',()=>({spawnSync:vi.fn()}));
const result=(status:number|null=0)=>({status,signal:null} as ReturnType<typeof spawnSync>);
const only=(name:string)=>browserSuites.find(suite=>suite.name===name)!;
beforeEach(()=>{vi.mocked(spawnSync).mockReset().mockReturnValue(result());});

describe('browser suite entrypoint',()=>{
  it('assigns every real spec exactly once to an existing authored configuration',()=>{
    const specs=readdirSync(new URL('./e2e/',import.meta.url),{recursive:true}).map(String).map(path=>path.replaceAll('\\','/')).filter(path=>/\.spec\.[cm]?[jt]sx?$/.test(path));
    expect(specs.length).toBeGreaterThan(100);
    expect(()=>validateBrowserSuites(specs)).not.toThrow();
    for(const suite of browserSuites)expect(existsSync(new URL('../'+suite.config,import.meta.url)),suite.config).toBe(true);
  });

  it('rejects uncovered, duplicate and obsolete assignments instead of silently losing tests',()=>{
    const suite:BrowserSuite={name:'fixture',config:'fixture.config.ts',specs:['one.spec.ts']};
    expect(()=>validateBrowserSuites(['one.spec.ts','new.spec.ts'],[suite])).toThrow(/missing \[new.spec.ts\]/);
    expect(()=>validateBrowserSuites(['one.spec.ts'],[suite,{...suite,name:'duplicate'}])).toThrow(/duplicate \[one.spec.ts\]/);
    expect(()=>validateBrowserSuites([],[suite])).toThrow(/unknown \[one.spec.ts\]/);
  });

  it('selects the repository-root fixture and excludes overlapping caller projects',()=>{
    expect(runBrowserSuites([only('terminal-read'),only('files-reading')],true)).toBe(0);
    const calls=vi.mocked(spawnSync).mock.calls;
    expect(calls[0][1]).toContain('tests/e2e/terminal-read.playwright.config.ts');
    const pattern=new RegExp(calls[0][1]!.find(value=>value.endsWith('terminal-read\\.spec\\.ts$'))!);
    expect(pattern.test('C:\\repo\\tests\\e2e\\terminal-read.spec.ts')).toBe(true);
    expect(pattern.test('/repo/tests/e2e/terminal-read.spec.ts')).toBe(true);
    expect(pattern.test('/repo/tests/e2e/older-terminal-read.spec.ts')).toBe(false);
    expect(calls[0][1]).toContain('--list');
    expect(calls[1][1]).toContain('--project');
    expect(calls[1][1]).toContain('files-reading');
    expect(calls[1][1]).not.toContain('shared-panels\\.spec\\.ts$');
  });

  it('isolates all three Memory modes and their discovery reports from ambient settings',()=>{
    vi.stubEnv('GEN_MEMORY_MODE','journal');
    try{
      expect(runBrowserSuites(['memory-recovery','memory-recovery-app','memory-recovery-journal'].map(only),true)).toBe(0);
      const calls=vi.mocked(spawnSync).mock.calls;
      expect(calls.map(call=>call[2]?.env?.GEN_MEMORY_MODE)).toEqual(['','app','journal']);
      expect(calls.every(call=>call[2]?.env?.GEN_E2E==='1')).toBe(true);
      expect(new Set(calls.map(call=>call[2]?.env?.PLAYWRIGHT_JSON_OUTPUT_FILE)).size).toBe(3);
    }finally{vi.unstubAllEnvs();}
  });

  it('stops before another suite after a child failure and preserves its exit code',()=>{
    vi.mocked(spawnSync).mockReturnValueOnce(result(7));
    expect(runBrowserSuites([only('root'),only('terminal-read')])).toBe(7);
    expect(spawnSync).toHaveBeenCalledTimes(1);
  });

  it('retains prior reports when the same suite is invoked again',()=>{
    runBrowserSuites([only('root')]);runBrowserSuites([only('root')]);
    const reports=vi.mocked(spawnSync).mock.calls.map(call=>call[2]?.env?.PLAYWRIGHT_JSON_OUTPUT_FILE);
    expect(new Set(reports).size).toBe(2);
  });

  it('treats an interrupted child or failed spawn as failure',()=>{
    vi.mocked(spawnSync).mockReturnValueOnce({...result(null),signal:'SIGTERM'});
    expect(runBrowserSuites([only('root')])).toBe(1);
    const failure=Error('Browser launcher unavailable');
    vi.mocked(spawnSync).mockReturnValueOnce({...result(null),error:failure});
    expect(()=>runBrowserSuites([only('root')])).toThrow(failure);
  });

  it('rejects an unknown suite or configuration override before starting a process',()=>{
    expect(()=>browserTestMain(['--suite','misspelled'])).toThrow(/Unknown browser suite/);
    expect(()=>browserTestMain(['--config','elsewhere.ts'])).toThrow(/Usage/);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('disables the development-host proxy only for the explicit browser runner',async()=>{
    try{
      vi.stubEnv('GEN_E2E','1');vi.resetModules();
      expect((await import('../vite.config.ts')).default.server?.proxy).toBeUndefined();
      vi.stubEnv('GEN_E2E','0');vi.resetModules();
      expect((await import('../vite.config.ts')).default.server?.proxy?.['/api']).toMatchObject({target:'http://127.0.0.1:4317'});
    }finally{vi.unstubAllEnvs();}
  });

  it('runs a selected suite without changing its source configuration',()=>{
    expect(browserTestMain(['--suite','browser-action','--list'])).toBe(0);
    expect(spawnSync).toHaveBeenCalledTimes(1);
    const [executable,args,options]=vi.mocked(spawnSync).mock.calls[0];
    expect(executable).toBe(process.execPath);
    expect(args).toContain('tests/e2e/browser-action.playwright.config.ts');
    expect(options).toMatchObject({cwd:resolve(import.meta.dirname,'..'),stdio:'inherit',windowsHide:true});
  });
});

it('QA #130 passes the actual overridden Playwright output to its fixture server',()=>{
 runBrowserSuites([only('file-checkpoints')]);
 const [,args,options]=vi.mocked(spawnSync).mock.calls[0];
 expect(options?.env?.GEN_BROWSER_OUTPUT_DIR).toBe(args![args!.indexOf('--output')+1]);
});

it('QA #130 every WO-5 fixture derives its cache from the runner output override',async()=>{
 const output=resolve('/tmp','wo5-runner-override','artifacts');vi.stubEnv('GEN_BROWSER_OUTPUT_DIR',output);vi.resetModules();
 try{
  for(const name of ['vite','saved-drafts','file-checkpoints','terminal-excerpts','conversation-find','project-search','redundant-ui']){
   const path=name==='vite'?'../tests/e2e/vite.config.ts':`../tests/e2e/${name}.vite.config.ts`;
   const config=(await import(path)).default;
   expect(String(config.cacheDir).startsWith(output+'/'),name).toBe(true);
  }
 }finally{vi.unstubAllEnvs();vi.resetModules();}
});
