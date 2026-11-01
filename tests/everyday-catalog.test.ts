import {it,expect} from 'vitest';
import {EVERYDAY_SCHEMAS,EVERYDAY_DATA_SCHEMAS,boundedEverydayData} from '../packages/ui-catalog/everyday';
it('admits source-bound props and rejects secret values or action/state wiring on credential entry',()=>{
 expect(EVERYDAY_SCHEMAS.Stats.parse({dataBinding:'metrics',stateKey:'selected'})).toEqual({dataBinding:'metrics',stateKey:'selected'});
 for(const extra of [{token:'synthetic-sentinel'},{stateKey:'token'},{actionId:'submit'},{url:'https://example.invalid'}])expect(EVERYDAY_SCHEMAS.CredentialEntry.safeParse({slotKey:'key',label:'API token',service:'Example',...extra}).success).toBe(false);
});
it('retains explicit unknown stats, bounds records and requires currency identity for currency values',()=>{
 expect(EVERYDAY_DATA_SCHEMAS.Stats.safeParse({metrics:[{id:'unknown',label:'Missing',value:null}]}).success).toBe(true);
 expect(EVERYDAY_DATA_SCHEMAS.Stats.safeParse({metrics:Array.from({length:13},(_,i)=>({id:'m'+i,label:'Metric',value:i}))}).success).toBe(false);
 expect(EVERYDAY_DATA_SCHEMAS.Stats.safeParse({metrics:[{id:'money',label:'Cost',value:12,format:'currency'}]}).success).toBe(false);
 expect(EVERYDAY_DATA_SCHEMAS.Stats.safeParse({metrics:[{id:'m',label:'A',value:Infinity}]}).success).toBe(false);
});
it('requires stable unique identities and bounded explicitly supplied comparison values',()=>{
 const value={options:[{id:'a',label:'A',values:{cost:12}},{id:'b',label:'B',values:{cost:null}}],criteria:[{id:'cost',label:'Cost',unit:'credits'}]};
 expect(EVERYDAY_DATA_SCHEMAS.Comparison.safeParse(value).success).toBe(true);
 expect(EVERYDAY_DATA_SCHEMAS.Comparison.safeParse({...value,options:[value.options[0],value.options[0]]}).success).toBe(false);
 expect(EVERYDAY_DATA_SCHEMAS.Comparison.safeParse({...value,criteria:[...value.criteria,{id:'cost',label:'Duplicate'}]}).success).toBe(false);
 expect(EVERYDAY_DATA_SCHEMAS.Comparison.safeParse({...value,options:[{id:'a',label:'A',values:{invented:'value'}}]}).success).toBe(false);
});
it('rejects hostile collection lengths before touching their entries',()=>{
 const huge=new Array(100000000);Object.defineProperty(huge,'0',{get(){throw Error('must not traverse');}});
 expect(boundedEverydayData('Stats',{metrics:huge})).toBe(false);expect(boundedEverydayData('Comparison',{options:huge,criteria:[]})).toBe(false);
 expect(boundedEverydayData('Stats',{metrics:[{id:'x',label:'X',value:1,series:huge}]})).toBe(false);
});
