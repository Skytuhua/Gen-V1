import {describe,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../scripts/check-doc-links.mjs',import.meta.url));

function fixture(files:Record<string,string>){
  const root=mkdtempSync(join(tmpdir(),'doc-links-')),git=(...args:string[])=>execFileSync('git',['-C',root,...args],{
    encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true,
    env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'},
  });
  git('init','--quiet');
  for(const [path,content] of Object.entries(files)){const target=join(root,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,content);}
  git('add','--all');
  const run=(...args:string[])=>{
    const options={cwd:root,encoding:'utf8' as const,windowsHide:true,stdio:['ignore','pipe','pipe'] as ['ignore','pipe','pipe']};
    try{return {status:0,output:execFileSync(process.execPath,[script,...args],options)};}
    catch(error){const failed=error as {status:number;stdout:string;stderr:string};return {status:failed.status,output:failed.stdout+failed.stderr};}
  };
  return {root,run,cleanup:()=>rmSync(root,{recursive:true,force:true,maxRetries:3})};
}

describe('documentation link check',()=>{
  it('reports the file, line and reason for a dead path, a missing anchor and a moved repository URL',()=>{
    const bench=fixture({
      '.gitignore':'/docs/evidence/\n',
      'docs/guide.md':'# Slugged heading\n\n## Repeated\n\n## Repeated\n',
      'docs/evidence/report.md':'# Local proof\n',
      'README.md':[
        '# Title',
        '',
        'Good [guide](docs/guide.md#slugged-heading), [sibling](#title) and [duplicate](docs/guide.md#repeated-1).',
        '',
        'Missing [page](docs/missing.md) and [anchor](docs/guide.md#no-such-heading).',
        '',
        'Moved [release](https://github.com/Skytuhua/Gen-V1/releases/tag/v0.6.1) and [clone](https://github.com/skytuhua-org/Gen-V1.git).',
        '',
        'Local [evidence](docs/evidence/report.md) and [preview](https://preview.example/thing) and [host](http://127.0.0.1:5173).',
        '',
        'Inline `[code](nowhere.md)`, a commented `<!-- [hidden](nowhere.md) -->` and a fenced block:',
        '',
        '```markdown',
        '[example](nowhere.md)',
        '```',
      ].join('\n'),
    });
    try{
      const result=bench.run();
      expect(result.status).toBe(1);
      expect(result.output).toContain('error README.md:5 docs/missing.md\n    no tracked file or directory at docs/missing.md');
      expect(result.output).toContain('error README.md:5 docs/guide.md#no-such-heading\n    no heading or anchor "#no-such-heading" in docs/guide.md');
      expect(result.output).toContain('error README.md:7 https://github.com/Skytuhua/Gen-V1/releases/tag/v0.6.1');
      expect(result.output).toContain('stale repository URL');
      expect(result.output).not.toContain('nowhere.md');
      expect(result.output).not.toContain('error README.md:9');
      expect(result.output).toContain('2 Markdown files, 10 links (external URLs skipped; pass --external): 3 broken, 0 warnings, 1 skipped as uncommitted');
    }finally{bench.cleanup();}
  });
  it('accepts links across files, parent directories and duplicate headings',()=>{
    const bench=fixture({
      'README.md':'# Title\n\nGuide [headings](docs/guide.md#repeated-1) and [top](#title).\n',
      'docs/guide.md':'# Repeated\n\n## Repeated\n\nNested [readme](../README.md#title).\n',
    });
    try{
      const result=bench.run();
      expect(result.status).toBe(0);
      expect(result.output).toContain('2 Markdown files, 3 links (external URLs skipped; pass --external): 0 broken, 0 warnings');
    }finally{bench.cleanup();}
  });
  it('leaves the provenance trees docs/implementation and docs/review-evidence unchecked',()=>{
    const bench=fixture({
      'README.md':'# Title\n\nSee [the plan](docs/implementation/v1/plan.md).\n',
      'docs/implementation/v1/plan.md':'See [the missing proof](gone.md) and [the missing report](../../report.md).\n',
      'docs/review-evidence/wo-1/README.md':'See [the missing capture](capture.png).\n',
    });
    try{
      const result=bench.run();
      expect(result.status).toBe(0);
      expect(result.output).toContain('1 Markdown files, 1 links');
    }finally{bench.cleanup();}
  });
  it('leaves the repository itself clean',()=>{
    const options={cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8' as const,windowsHide:true,stdio:['ignore','pipe','pipe'] as ['ignore','pipe','pipe']};
    expect(execFileSync(process.execPath,[script],options)).toContain('broken, 0 warnings');
  });
});
