import {describe,expect,it} from 'vitest';
import {mkdtempSync,realpathSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {aggregate,captureOutputPath,coverageMatrix,frameTag,hasDistinctRecipe,imageStatus,isReducedOffender,motionKey,normalizeMotion,paddedClip,parseArgs,table,type CaptureEntry,type Motion} from '../../scripts/capture-ui/helpers';
import {discover,parseGitLog,resolveScope,type Run} from '../../scripts/capture-ui/scope';

const motion:Motion={screen:'s',state:'default',width:375,frame:'main',selector:'a',type:'CSSAnimation',animationName:'x',transitionProperty:'',properties:[],duration:2,delay:0,easing:'ease',iterations:1,fill:'both',keyframes:[]};

describe('table',()=>{
 it('renders an em-dash placeholder for empty input',()=>{
  expect(table([])).toBe('_None._\n');
 });
 it('escapes pipes and newlines, serializes objects and blanks nullish cells',()=>{
  const out=table([{a:'x|y',b:'line1\nline2',c:{k:1},d:undefined,e:null}]);
  expect(out).toBe('| a | b | c | d | e |\n| --- | --- | --- | --- | --- |\n| x\\|y | line1 line2 | {"k":1} |  | null |\n');
 });
 it('keys columns from the first row only',()=>{
  expect(table([{a:1,b:2},{a:3}])).toContain('| 3 |  |');
 });
});

describe('parseArgs edge cases',()=>{
 it('accepts diff scope, drops empty screen entries and lets the last flag win',()=>{
  expect(parseArgs(['--scope','diff'])).toMatchObject({scope:'diff'});
  expect(parseArgs(['--screens','a,,b,'])).toEqual(expect.objectContaining({screens:['a','b']}));
  expect(parseArgs(['--scope','diff','--scope','all']).scope).toBe('all');
 });
 it.each([['--since-days=1.5'],['--max-strips=2.5'],['--since-days=-3'],['--scope','--since-days'],['--since-days','--max-strips']])('rejects %s',(...args)=>{
  expect(()=>parseArgs(args)).toThrow();
 });
 it('validates --out ancestors that do not exist yet',()=>{
  const deep=join(tmpdir(),'capture-edge-'+process.pid,'nested','out');
  expect(parseArgs(['--out',deep]).out).toBe(deep);
 });
});

describe('captureOutputPath',()=>{
 it('returns canonical paths inside allowed roots',()=>{
  expect(captureOutputPath(join(tmpdir(),'a','b'))).toBe(join(realpathSync(tmpdir()),'a','b'));
  expect(captureOutputPath(tmpdir())).toBe(realpathSync(tmpdir()));
 });
 it('rejects a symlink that resolves outside the allowed roots',()=>{
  const root=mkdtempSync(join(tmpdir(),'capture-edge-'));
  try{
   symlinkSync('/',join(root,'link'),'dir');
   expect(()=>captureOutputPath(join(root,'link','file'))).toThrow('symlink escapes');
  }finally{rmSync(root,{recursive:true,force:true});}
 });
});

describe('motion normalization edges',()=>{
 it('clamps negative and non-finite durations, defaults missing delays',()=>{
  expect(normalizeMotion({...motion,duration:-5}).duration).toBe(0);
  expect(normalizeMotion({...motion,duration:'abc' as unknown as number}).duration).toBe(0);
  expect(normalizeMotion({...motion,delay:'x' as unknown as number}).delay).toBe(0);
  expect(normalizeMotion({...motion,iterations:'3'}).iterations).toBe('3');
 });
 it('keeps dedupe keys stable for equivalent motions',()=>{
  expect(motionKey(normalizeMotion({...motion,properties:['b','a','b']}))).toBe(motionKey(normalizeMotion({...motion,properties:['a','b']})));
 });
 it('flags reduced-motion offenders only past the duration threshold',()=>{
  expect(isReducedOffender({...motion,iterations:'Infinity'})).toBe(true);
  expect(isReducedOffender({...motion,duration:1,iterations:'Infinity'})).toBe(false);
  expect(isReducedOffender({...motion,iterations:'0'})).toBe(false);
 });
});

describe('coverageMatrix edges',()=>{
 const entry=(over:Partial<CaptureEntry>):CaptureEntry=>({screen:'controls',state:'hover',width:375,status:'captured',...over});
 it('ignores reduced runs and sorts captured widths',()=>{
  const matrix=coverageMatrix(['controls'],[
   entry({width:1440}),entry({width:375}),
   entry({width:768,reduced:true}),
   entry({state:'focus',status:'identical-to-default'}),
   entry({state:'focus',status:'failed',width:768}),
  ]);
  expect(matrix[0].hover).toBe('375,1440');
  expect(matrix[0].focus).toBe('I:375; F:768');
  expect(matrix[0].open).toBe('U');
 });
 it('prefers the explicit code over the status-derived marker',()=>{
  const matrix=coverageMatrix(['controls'],[entry({status:'identical-to-default',code:'S'})]);
  expect(matrix[0].hover).toBe('S:375');
 });
});

describe('aggregate edges',()=>{
 const pr=(number:number,files:string[])=>({number,title:`PR ${number}`,mergedAt:'2026-11-01',files:files.map(path=>({path}))});
 it('deduplicates files across pulls while keeping per-PR classifications',()=>{
  const scope=aggregate([pr(1,['apps/web/src/App.tsx','README.md']),pr(2,['apps/web/src/App.tsx'])]);
  expect(scope.screens).toEqual(['app-shell']);
  expect(scope.nonUi).toEqual(['README.md']);
  expect(scope.pulls[1].nonUi).toEqual([]);
  expect(scope.pulls[1].screens).toEqual(['app-shell']);
 });
 it('surfaces unmapped renderer files at both levels',()=>{
  const scope=aggregate([pr(1,['apps/web/src/FutureSurface.tsx'])]);
  expect(scope.unmapped).toEqual(['apps/web/src/FutureSurface.tsx']);
  expect(scope.pulls[0].unmapped).toEqual(['apps/web/src/FutureSurface.tsx']);
 });
});

describe('recipe and clip edges',()=>{
 it('treats steps, events and actions as distinct state recipes',()=>{
  expect(hasDistinctRecipe({steps:[{selector:'x',action:'click'}]})).toBe(true);
  expect(hasDistinctRecipe({event:{name:'n',detail:''}})).toBe(true);
  expect(hasDistinctRecipe({action:'hover'})).toBe(true);
  expect(hasDistinctRecipe({query:'a'},{query:'b'})).toBe(true);
  expect(hasDistinctRecipe({query:'a'})).toBe(true);
 });
 it('returns null for boxes fully outside the viewport and honours custom padding',()=>{
  expect(paddedClip({x:0,y:0,width:10,height:10},{width:100,height:100},0)).toEqual({x:0,y:0,width:10,height:10});
  expect(paddedClip({x:0,y:-50,width:10,height:10},{width:100,height:100})).toBeNull();
  expect(paddedClip({x:110,y:0,width:10,height:10},{width:100,height:100})).toBeNull();
 });
 it('falls back to the root pathname for nested frames',()=>{
  expect(frameTag([2],'https://host')).toBe('frame:2 /');
 });
 it('reports unmatched default hashes as captured',()=>{
  expect(imageStatus(undefined,'hash')).toBe('captured');
 });
});

describe('parseGitLog edges',()=>{
 it('keeps tabbed titles whole and only counts real PR references',()=>{
  expect(parseGitLog([
   'aaa\t2026-11-08\tSubject with\tembedded tabs (#7)',
   'bbb\t2026-11-08\tMerge pull request #123x not a merge',
   'ccc\t2026-11-08\tPrefix (#12) suffix',
   'ddd\t2026-11-08',
  ].join('\n'))).toEqual([
   {sha:'aaa',mergedAt:'2026-11-08',title:'Subject with\tembedded tabs (#7)',number:7},
   {sha:'bbb',mergedAt:'2026-11-08',title:'Merge pull request #123x not a merge',number:null},
   {sha:'ccc',mergedAt:'2026-11-08',title:'Prefix (#12) suffix',number:null},
  ]);
 });
});

describe('discover gh fallbacks',()=>{
 const now=new Date('2026-11-09T16:30:00.000Z');
 const gh='gh pr list --state merged --base main --limit 1000 --search merged:>=2026-10-10 --json number,title,mergedAt,files';
 const branch={'git rev-parse --abbrev-ref HEAD':'work/x\n','git diff --name-only -z origin/main...HEAD':'','git diff --name-only -z':'','git diff --cached --name-only -z':'','git ls-files --others --exclude-standard -z':''};
 const run=(responses:Record<string,string|Error>)=>{
  const calls:string[][]=[];const r:Run=(cmd,args)=>{calls.push([cmd,...args]);const v=responses[[cmd,...args].join(' ')];if(v instanceof Error)throw v;if(v===undefined)throw Error(`unexpected ${cmd}`);return v;};
  return {run:r,calls};
 };
 it('falls back to git when gh JSON is not an array',()=>{
  const {run:r}=run({[gh]:'{}',...branch,'git log origin/main --first-parent --since-as-filter=2026-10-10T00:00:00Z --format=%H%x09%cI%x09%s':'aaa\t2026-11-08\tSquash (#1)','git diff-tree --no-commit-id --name-only -z -r aaa^1 aaa':'a.ts\0'});
  const scope=discover(30,r,now);
  expect(scope.source).toBe('git');
  expect(scope.warnings).toEqual(['gh unavailable: Invalid gh PR response']);
 });
 it('warns when the gh page limit is reached',()=>{
  const prs=Array.from({length:1000},(_v,i)=>({number:i+1,title:`p${i}`,mergedAt:'2026-11-01',files:[]}));
  const {run:r}=run({[gh]:JSON.stringify(prs),...branch});
  const scope=discover(30,r,now);
  expect(scope.source).toBe('gh');
  expect(scope.warnings).toEqual(['gh limit reached; scope may be truncated.']);
  expect(scope.pulls).toHaveLength(1001);
 });
 it('diffs a parentless commit against the empty tree',()=>{
  const {run:r,calls}=run({[gh]:Error('no gh'),...branch,
   'git log origin/main --first-parent --since-as-filter=2026-10-10T00:00:00Z --format=%H%x09%cI%x09%s':'aaa\t2026-11-08\tInitial import',
   'git diff-tree --no-commit-id --name-only -z -r aaa^1 aaa':Error('unknown revision'),
   'git cat-file commit aaa':'tree abcdef\n\nInitial import\n',
   'git diff-tree --no-commit-id --name-only -z -r --root aaa':'root.ts\0',
  });
  const scope=discover(30,r,now);
  expect(scope.pulls[0].files).toEqual([{path:'root.ts'}]);
  expect(calls.some(args=>args.includes('--root'))).toBe(true);
 });
 it('rejects an empty HEAD name',()=>{
  const {run:r}=run({[gh]:'[]',...branch,'git rev-parse --abbrev-ref HEAD':'\n'});
  expect(()=>discover(30,r,now)).toThrow('empty HEAD name');
 });
 it('uses the first line of a non-Error failure in warnings',()=>{
  const r:Run=(cmd)=>{if(cmd==='gh')throw 'plain gh failure';throw Error(`${cmd} fail`);};
  expect(()=>discover(30,r,now)).toThrow(/plain gh failure/);
 });
});

describe('resolveScope routing',()=>{
 it('prefers explicit screens over every scope mode',()=>{
  const fail:Run=()=>{throw Error('no git');};
  expect(resolveScope({scope:'diff',screens:['app-shell'],sinceDays:7},fail).source).toBe('explicit-screens');
  expect(resolveScope({scope:'baseline',screens:['app-shell'],sinceDays:7},fail).source).toBe('explicit-screens');
 });
 it('runs discovery for diff scope without explicit screens',()=>{
  const now=new Date('2026-11-09T00:00:00.000Z');
  const r:Run=(cmd,args)=>{
   if(cmd==='gh')return '[]';
   if(args.includes('rev-parse'))return 'work/x\n';
   return '';
  };
  const scope=resolveScope({scope:'diff',screens:[],sinceDays:7},r,now);
  expect(scope.source).toBe('gh');expect('since' in scope && scope.since).toBe('2026-11-02');
 });
});
