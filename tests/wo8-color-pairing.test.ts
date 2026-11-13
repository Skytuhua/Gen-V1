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
it('accepts explicit numeric column metadata without treating text codes as numbers',()=>{
  const spec={root:'table',elements:{table:{type:'Table',props:{rowsBinding:'rows',columns:[{key:'count',label:'Count',type:'number'},{key:'code',label:'Code'}]}}}};
  expect(()=>validateSurface(spec)).not.toThrow();
  expect(()=>validateSurface({...spec,elements:{table:{...spec.elements.table,props:{...spec.elements.table.props,columns:[{key:'count',label:'Count',type:'automatic'}]}}}})).toThrow();
});
