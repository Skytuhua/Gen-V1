import {describe,expect,it} from 'vitest';
import {SOFTWARE_DATA_SCHEMAS,SOFTWARE_SCHEMAS,SOFTWARE_DISCOVERY} from '../packages/ui-catalog/software-development';
import {SOFTWARE_FIXTURE_DATA} from '../scripts/software-development-fixtures';

describe('source-bound software-development surfaces',()=>{
  it('admits four source-bound views without executable or URL props',()=>{
    for(const schema of Object.values(SOFTWARE_SCHEMAS)){
      expect(schema.safeParse({dataBinding:'evidence',stateKey:'selected',actionId:'inspect',actionLabel:'Inspect'}).success).toBe(true);
      expect(schema.safeParse({dataBinding:'evidence',stateKey:'selected',onClick:'fetch("/execute")'}).success).toBe(false);
      expect(schema.safeParse({dataBinding:'evidence',stateKey:'__proto__'}).success).toBe(false);
    }
  });
  it('accepts actual diagnostic, diff, contract and stage-shaped records',()=>{
    for(const [name,schema] of Object.entries(SOFTWARE_DATA_SCHEMAS))expect(schema.safeParse(SOFTWARE_FIXTURE_DATA[name as keyof typeof SOFTWARE_FIXTURE_DATA]).success,name).toBe(true);
  });
  it('rejects duplicate identities, oversized collections and invented execution fields',()=>{
    const diagnostic=SOFTWARE_FIXTURE_DATA.Diagnostics;
    expect(SOFTWARE_DATA_SCHEMAS.Diagnostics.safeParse({...diagnostic,items:[diagnostic.items[0],diagnostic.items[0]]}).success).toBe(false);
    expect(SOFTWARE_DATA_SCHEMAS.Diagnostics.safeParse({...diagnostic,items:Array.from({length:101},(_,i)=>({...diagnostic.items[0],id:String(i)}))}).success).toBe(false);
    expect(SOFTWARE_DATA_SCHEMAS.Pipeline.safeParse({...SOFTWARE_FIXTURE_DATA.Pipeline,execute:'npm publish'}).success).toBe(false);
    expect(SOFTWARE_DATA_SCHEMAS.ApiExplorer.safeParse({...SOFTWARE_FIXTURE_DATA.ApiExplorer,endpoints:[{id:'e',method:'TRACE',path:'/users'}]}).success).toBe(false);
  });
  it('keeps source statuses distinct from labels and rejects broken dependencies',()=>{
    const pipeline=SOFTWARE_FIXTURE_DATA.Pipeline;
    expect(SOFTWARE_DATA_SCHEMAS.Pipeline.safeParse({...pipeline,stages:[{id:'build',name:'Passed',status:'not-run'}]}).success).toBe(true);
    expect(SOFTWARE_DATA_SCHEMAS.Pipeline.safeParse({...pipeline,stages:[{id:'build',name:'Build',status:'passed',dependsOn:['missing']}]}).success).toBe(false);
    expect(SOFTWARE_DATA_SCHEMAS.ChangeSet.safeParse({files:[{id:'a',path:'a.ts',status:'modified',patch:'x'.repeat(40001)}]}).success).toBe(false);
  });
  it('discovers all three software domains without granting new execution authority',()=>{
    expect(SOFTWARE_DISCOVERY.workflows.map(workflow=>workflow.id)).toEqual(['debugging-tests','architecture-api','build-release']);
    expect(JSON.stringify(SOFTWARE_DISCOVERY)).toContain('exact native approval');
    expect(SOFTWARE_DISCOVERY.execution).toContain('No new executor');
  });
});
