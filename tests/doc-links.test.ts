import {describe,expect,it} from 'vitest';
import {execFileSync,spawnSync} from 'node:child_process';
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
  it('fails rather than reporting a clean scan if Git cannot list tracked files',()=>{
    const root=mkdtempSync(join(tmpdir(),'doc-links-no-git-'));
    try{
      const env={...process.env};
      delete env.GIT_DIR; delete env.GIT_WORK_TREE;
      const result=spawnSync(process.execPath,[script],{cwd:root,env,encoding:'utf8'});
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('git ls-files failed');
      expect(result.stdout).not.toContain('0 broken');
    }finally{rmSync(root,{recursive:true,force:true});}
  });

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
        'Local [evidence](docs/evidence/report.md), [preview](https://preview.example/thing), [host](http://127.0.0.1:5173) and [metadata](http://169.254.169.254/latest/meta-data).',
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
      expect(result.output).toContain('2 Markdown files, 11 links (external URLs skipped; pass --external): 3 broken, 0 warnings, 1 skipped as uncommitted');
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
  it('checks Markdown outside the root and docs, such as package readmes',()=>{
    const bench=fixture({
      'packages/widgets/README.md':'# Widgets\n\nSee [the missing policy](../standards/policy.md).\n',
      'packages/policy.md':'# Policy\n',
    });
    try{
      const result=bench.run();
      expect(result.status).toBe(1);
      expect(result.output).toContain('error packages/widgets/README.md:3 ../standards/policy.md\n    no tracked file or directory at packages/standards/policy.md');
    }finally{bench.cleanup();}
  });
  it('leaves the provenance trees and the retained upstream bytes unchecked',()=>{
    const bench=fixture({
      'README.md':'# Title\n\nSee [the plan](docs/implementation/v1/plan.md).\n',
      'docs/implementation/v1/plan.md':'See [the missing proof](gone.md) and [the missing report](../../report.md).\n',
      'docs/review-evidence/wo-1/README.md':'See [the missing capture](capture.png).\n',
      'third-party/vendor/README.md':'See [the upstream link](gone.md).\n',
    });
    try{
      const result=bench.run();
      expect(result.status).toBe(0);
      expect(result.output).toContain('1 Markdown files, 1 links');
    }finally{bench.cleanup();}
  });
  it('accepts custom anchors and GitHub colliding heading suffixes',()=>{
    const bench=fixture({
      'guide.md':'# Guide\n\n## Foo\n\n## Foo\n\n## Foo-1\n\n<a id="custom"></a>\n<a name="legacy"></a>\n',
      'README.md':'# Readme\n\nTo [a](guide.md#foo-1-1), [b](guide.md#foo-1), [c](guide.md#custom), [d](guide.md#legacy) and [e](guide.md#absent).\n',
    });
    try{
      const result=bench.run();
      expect(result.status).toBe(1);
      expect(result.output).toContain('error README.md:3 guide.md#absent\n    no heading or anchor "#absent" in guide.md');
      expect(result.output).toContain('1 broken');
    }finally{bench.cleanup();}
  });
  it('does not collect Markdown after the closing line of a chained raw comment',()=>{
    const bench=fixture({
      'README.md':'[phantom](guide.md#phantom), [real](guide.md#real), [custom](guide.md#custom)\n',
      'guide.md':'<!-- first --> <!-- second\n--> ## Phantom <a id="custom"></a>\n\n## Real\n',
    });
    try{
      const result=bench.run();
      expect(result.status).toBe(1);
      expect(result.output).toContain('error README.md:1 guide.md#phantom');
      expect(result.output).toContain('1 broken, 0 warnings');
    }finally{bench.cleanup();}
  });
  it('assigns colliding anchors in document order across heading styles',()=>{
    const bench=fixture({
      'guide.md':'Foo\n===\n\nFoo\n===\n\n## Foo-1\n',
      'README.md':'[actual anchor](guide.md#foo-1-1)\n',
    });
    try{
      const result=bench.run();
      expect(result.status).toBe(0);
      expect(result.output).toContain('0 broken');
    }finally{bench.cleanup();}
  });
  it('reads both destinations of a linked image',()=>{
    const bench=fixture({'README.md':'# Readme\n\n[![diagram](missing-image.png)](missing-page.md)\n'});
    try{
      const result=bench.run();
      expect(result.status).toBe(1);
      expect(result.output).toContain('error README.md:3 missing-image.png');
      expect(result.output).toContain('error README.md:3 missing-page.md');
      expect(result.output).toContain('2 broken');
    }finally{bench.cleanup();}
  });
  it('ignores example links inside blockquote fences and indented code',()=>{
    const bench=fixture({'README.md':'# Readme\n\n> ```\n> [quoted](nowhere-quoted.md)\n> ```\n\n    [indented](nowhere-indented.md)\n\nReal [link](#readme).\n'});
    try{
      const result=bench.run();
      expect(result.status).toBe(0);
      expect(result.output).not.toContain('nowhere-quoted.md');
      expect(result.output).not.toContain('nowhere-indented.md');
      expect(result.output).toContain('1 Markdown files, 1 links');
    }finally{bench.cleanup();}
  });
  it('flags the pre-move clone URL as well as the plain one',()=>{
    const bench=fixture({'README.md':'# Readme\n\n[clone](https://github.com/Skytuhua/Gen-V1.git) and [tree](https://github.com/Skytuhua/Gen-V1/tree/main)\n'});
    try{
      const result=bench.run();
      expect(result.status).toBe(1);
      expect(result.output.match(/stale repository URL/g)).toHaveLength(2);
    }finally{bench.cleanup();}
  });
  it('leaves the repository itself clean',()=>{
    const options={cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8' as const,windowsHide:true,stdio:['ignore','pipe','pipe'] as ['ignore','pipe','pipe']};
    expect(execFileSync(process.execPath,[script],options)).toContain('broken, 0 warnings');
  });
});

it('checks anchors from rendered headings, not comments or fenced code',()=>{
  const bench=fixture({
    'README.md':'[real](guide.md#run-setup) [fenced](guide.md#run-setup-1) [sample](guide.md#sample) [comment](guide.md#comment) [custom](guide.md#real-anchor)',
    'guide.md':[
      '<!--', '## Comment', '-->', '',
      '  ```markdown','## Run setup','<a id="sample"></a>','  ```','',
      '## Run `setup`','<a id="real-anchor"></a>',
    ].join('\n'),
  });
  try{
    const result=bench.run();
    expect(result.status).toBe(1);
    for(const anchor of ['run-setup-1','sample','comment'])expect(result.output).toContain('no heading or anchor "#'+anchor+'"');
    expect(result.output).not.toContain('no heading or anchor "#run-setup"');
    expect(result.output).not.toContain('no heading or anchor "#real-anchor"');
    expect(result.output).toContain('3 broken');
  }finally{bench.cleanup();}
});

it('retains real anchors around comments and quoted code fences',()=>{
  const bench=fixture({
    'README.md':'[compact](guide.md#ab) [outside](guide.md#real-between) [after](guide.md#after-quote)',
    'guide.md':[
      '## A<!-- description -->B', '',
      '```html', '<!--', '```', '',
      '## Real between', '',
      '```html', '-->', '```', '',
      '> ```markdown', '> ## Example', '',
      '## After quote',
    ].join('\n'),
  });
  try{
    const result=bench.run();
    expect(result.status,result.output).toBe(0);
  }finally{bench.cleanup();}
});

it('does not turn trailing text in HTML comment blocks into anchors',()=>{
  const bench=fixture({
    'README.md':'[real](guide.md#example) [invented](guide.md#example-1) [also invented](guide.md#outside)',
    'guide.md':['<!-- note -->## Example','', '## Example','', '<!--', '--> ## Outside'].join('\n'),
  });
  try {
    const result=bench.run();
    expect(result.status,result.output).toBe(1);
    expect(result.output).toContain('no heading or anchor "#example-1"');
    expect(result.output).toContain('no heading or anchor "#outside"');
    expect(result.output).not.toContain('no heading or anchor "#example"');
  } finally { bench.cleanup(); }
});

it('keeps rendered anchors after a comment terminator without indexing indented examples',()=>{
  const bench=fixture({
    'README.md':'[single](guide.md#single) [multiple](guide.md#multiple) [example one](guide.md#example-one) [example two](guide.md#example-two)',
    'guide.md':[
      '<!-- single --> <a id="single"></a>',
      '    <a id="example-one"></a>',
      '',
      '<!-- multi',
      '--> <a name="multiple"></a>',
      '    <a id="example-two"></a>',
    ].join('\n'),
  });
  try{
    const result=bench.run();
    expect(result.status).toBe(1);
    for(const anchor of ['example-one','example-two'])expect(result.output).toContain('no heading or anchor "#'+anchor+'"');
    for(const anchor of ['single','multiple'])expect(result.output).not.toContain('no heading or anchor "#'+anchor+'"');
    expect(result.output).toContain('2 broken');
  }finally{bench.cleanup();}
});

it('does not count an ATX heading again before a thematic break',()=>{
  const bench=fixture({
    'guide.md':'# Build\n---\n\n# Build\n',
    'README.md':'[real duplicate](guide.md#build-1) [phantom anchor](guide.md#-build)\n',
  });
  try{
    const result=bench.run();
    expect(result.status,result.output).toBe(1);
    expect(result.output).toContain('no heading or anchor "#-build"');
    expect(result.output).not.toContain('no heading or anchor "#build-1"');
  }finally{bench.cleanup();}
});
