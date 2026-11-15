import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {validateSurface} from '../packages/ui-catalog';

const css=readFileSync(new URL('../apps/web/src/styles.css',import.meta.url),'utf8');
const luminance=(hex:string)=>{
  const channels=hex.slice(1).match(/.{2}/g)!.map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
  return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
};
const contrast=(a:string,b:string)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const themes={
  light:{accent:['#3b5bdb','#e9edff'],success:['#06724f','#e2f5ed'],danger:['#c92a3e','#fff0f1'],warning:['#815400','#fff2d2'],category:['#6d3ea2','#f2eaff']},
  dark:{accent:['#91a7ff','#1b2440'],success:['#2dd4a0','#123329'],danger:['#ff6b7e','#3b2028'],warning:['#ffc247','#3c2c0c'],category:['#d0adff','#302340']},
};
describe('WO-8 fixed semantic colors',()=>{
  for(const [theme,pairs] of Object.entries(themes))it(`${theme} preserves the specified pairs and passes AA for text and meaningful marks`,()=>{
    const tokens:Record<string,string>={};
    for(const match of css.matchAll(/(:root(?:\[data-theme="dark"\])?)\s*\{([^}]+)\}/g)){
      if(theme==='light'&&match[1]!==':root')continue;
      for(const token of match[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))tokens[token[1]]=token[2].trim();
    }
    const resolve=(key:string):string=>tokens[key].startsWith('var(')?resolve(tokens[key].slice(4,-1)):tokens[key];
    for(const [name,pair] of Object.entries(pairs)){
      const fg=resolve(`--${name}-fg`),bg=resolve(`--${name}-bg`);
      expect([fg,bg]).toEqual(pair);
      expect(contrast(fg,bg),`${theme} ${name} text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(fg,bg),`${theme} ${name} mark`).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(resolve('--text'),resolve('--accent-bg'))).toBeGreaterThanOrEqual(4.5);
    // Fixed semantic pairs must not inherit a user-selected project accent.
    tokens['--accent']='#ffffff';expect(resolve('--accent-fg')).toBe(pairs.accent[0]);
  });
});
describe('T14 running semantics stay fixed under a custom accent',()=>{
 const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
 const runningRules=[
  ['../apps/web/src/task-interface.css',/\.status-running\s*\{([^}]+)\}/],
  ['../apps/web/src/relationship-graph.css',/\.graph-edge\.status-running\s*\{([^}]+)\}/],
  ['../apps/web/src/software-development.css',/\.software-state-running\s*\{([^}]+)\}/],
  ['../apps/web/src/software-development.css',/\.software-stage-node\.software-state-running\s*\{([^}]+)\}/],
  ['../apps/web/src/agents-workspace/agents-workspace.css',/\.agents-work-state\[data-state='RUNNING'\]\s*\{([^}]+)\}/],
 ] as const;
 it('running status references the fixed --accent-fg, never the customizable --accent',()=>{
  for(const [path,pattern] of runningRules){
   const match=read(path).match(pattern);
   expect(match,`${path} has a running-status rule`).not.toBeNull();
   const declaration=match![1];
   expect(declaration,`${path} running must use the fixed semantic blue`).toContain('var(--accent-fg)');
   expect(declaration,`${path} running must not use the customizable accent`).not.toMatch(/var\(--accent\)/);
  }
 });
 it('a custom project accent does not recolor the running status',()=>{
  const css=read('../apps/web/src/styles.css');
  const tokens:Record<string,string>={};
  for(const match of css.matchAll(/(:root(?:\[data-theme="dark"\])?)\s*\{([^}]+)\}/g)){
   if(match[1]!==':root')continue;
   for(const token of match[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))tokens[token[1]]=token[2].trim();
  }
  // appearance.css overrides --accent with the user's project accent; the fixed
  // semantic pair must be unaffected.
  tokens['--accent']='#ff0000';
  const resolve=(key:string):string=>tokens[key].startsWith('var(')?resolve(tokens[key].slice(4,-1)):tokens[key];
  expect(resolve('--accent-fg')).toBe('#3b5bdb');
  expect(resolve('--accent-fg')).not.toBe('#ff0000');
 });
});
describe('T14 completed semantics use the fixed green, not an undefined token',()=>{
 const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
 it('agents completed/verified work state references the fixed --success-fg, never the undefined --ok',()=>{
  const css=read('../apps/web/src/agents-workspace/agents-workspace.css');
  const match=css.match(/\.agents-work-state\[data-state='COMPLETED_REPORTED'\][^{]*\{([^}]+)\}/);
  expect(match,'agents completed-state rule exists').not.toBeNull();
  const declaration=match![1];
  expect(declaration,'completed must use the fixed semantic green').toContain('var(--success-fg)');
  expect(declaration,'completed must not use the undefined --ok token').not.toMatch(/var\(--ok/);
 });
 for(const theme of ['light','dark'])it(`${theme} completed green text stays readable on the surface`,()=>{
  const css=read('../apps/web/src/styles.css');
  const tokens:Record<string,string>={};
  for(const match of css.matchAll(/(:root(?:\[data-theme="dark"\])?)\s*\{([^}]+)\}/g)){
   if(theme==='light'&&match[1]!==':root')continue;
   for(const token of match[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))tokens[token[1]]=token[2].trim();
  }
  const resolve=(key:string):string=>tokens[key].startsWith('var(')?resolve(tokens[key].slice(4,-1)):tokens[key];
  const six=(hex:string)=>hex.length===4?'#'+[...hex.slice(1)].map(char=>char+char).join(''):hex;
  expect(contrast(six(resolve('--success-fg')),six(resolve('--surface'))),`${theme} completed text on surface`).toBeGreaterThanOrEqual(4.5);
 });
});
describe('T14 agents work-state stopped and needs-input semantics',()=>{
 const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
 const css=()=>read('../apps/web/src/agents-workspace/agents-workspace.css');
 it('INTERRUPTED is a neutral stopped state, never a red failure',()=>{
  // A resumable interruption must not share the FAILED red rule (agent status or work state).
  expect(css()).not.toMatch(/data-state=['"]interrupted['"]\][^{]*\{[^}]*var\(--danger/i);
 });
 it('WAITING_HUMAN uses the fixed needs-input amber',()=>{
  const match=css().match(/\.agents-work-state\[data-state='WAITING_HUMAN'\]\s*\{([^}]+)\}/);
  expect(match,'WAITING_HUMAN rule exists').not.toBeNull();
  expect(match![1],'needs-input must use the fixed amber').toContain('var(--warning-fg)');
 });
 it('working agent status uses the fixed running blue',()=>{
  const match=css().match(/\.agents-agent-state\[data-state="working"\]\s*\{([^}]+)\}/);
  expect(match,'working agent-state rule exists').not.toBeNull();
  expect(match![1],'working must use the fixed running blue').toContain('var(--accent-fg)');
 });
 it('completed agent status uses the fixed green',()=>{
  const match=css().match(/\.agents-agent-state\[data-state="completed"\]\s*\{([^}]+)\}/);
  expect(match,'completed agent-state rule exists').not.toBeNull();
  expect(match![1],'completed must use the fixed green').toContain('var(--success-fg)');
 });
});
it('accepts explicit numeric column metadata without treating text codes as numbers',()=>{
  const spec={root:'table',elements:{table:{type:'Table',props:{rowsBinding:'rows',columns:[{key:'count',label:'Count',type:'number'},{key:'code',label:'Code'}]}}}};
  expect(()=>validateSurface(spec)).not.toThrow();
  expect(()=>validateSurface({...spec,elements:{table:{...spec.elements.table,props:{...spec.elements.table.props,columns:[{key:'count',label:'Count',type:'automatic'}]}}}})).toThrow();
});
