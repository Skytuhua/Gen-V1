import type {SurfaceSpec} from '../packages/contracts/index.ts';

export const SOFTWARE_REVIEW_PROVENANCE='Deterministic software-interface fixtures. File contents, test outcomes, API contracts and pipeline records are fictional; no test, network request, build or deployment is executed by these views.';
export const SOFTWARE_FIXTURE_DATA={
  Diagnostics:{title:'Test failures',items:[
    {id:'quantity',title:'includes item quantity',status:'failed',file:'quantity.test.mjs',line:4,message:'Expected 12, received 3',expected:'12',actual:'3',code:'assert.equal(total([{price:3, quantity:4}]), 12);',durationMs:8},
    {id:'empty',title:'empty basket returns zero',status:'passed',file:'total.test.mjs',line:8,durationMs:2},
    {id:'rounding',title:'rounds the final total',status:'not-run',file:'total.test.mjs',line:14}],source:'Supplied test output and source files'},
  ChangeSet:{title:'Proposed changes',files:[
    {id:'total',path:'src/total.ts',status:'modified',additions:1,deletions:1,patch:'@@ -1,3 +1,3 @@\n export function total(items) {\n-  return items.reduce((sum, item) => sum + item.price, 0);\n+  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);\n }',note:'Keep the total(items) signature unchanged.'},
    {id:'test',path:'tests/total.test.ts',status:'added',additions:4,deletions:0,patch:'@@ -0,0 +1,4 @@\n+test("includes quantity", () => {\n+  assert.equal(total([{price:3, quantity:4}]), 12);\n+});\n+'}],source:'Proposed patch; no file has been changed'},
  ApiExplorer:{title:'Orders API',endpoints:[
    {id:'create',method:'POST',path:'/orders',summary:'Create an order',parameters:[{name:'Idempotency-Key',location:'header',type:'string',required:true,description:'Reuse the key when retrying the same order.'}],request:'{\n  "items": [{"sku":"notebook", "quantity":2}]\n}',responses:[{status:201,body:'{\n  "id": "ord_123",\n  "status": "created"\n}'},{status:409,body:'{"error":"idempotency_conflict"}'}]},
    {id:'read',method:'GET',path:'/orders/{id}',summary:'Inspect an order',parameters:[{name:'id',location:'path',type:'string',required:true}],responses:[{status:200,body:'{"id":"ord_123","status":"created"}'},{status:404,body:'{"error":"not_found"}'}]}],source:'Supplied OpenAPI document; requests are not sent'},
  Pipeline:{title:'Release checks',stages:[
    {id:'test',name:'Tests',status:'passed',command:'node --test -- tests/total.test.mjs',durationMs:184,log:'2 tests passed\n0 tests failed'},
    {id:'types',name:'Typecheck',status:'failed',command:'pnpm typecheck',durationMs:860,dependsOn:['test'],log:'src/orders.ts:42: Type number is not assignable to type string.'},
    {id:'build',name:'Build',status:'blocked',command:'pnpm build',dependsOn:['types']},
    {id:'release',name:'Publish',status:'not-run',dependsOn:['build']}],source:'Supplied CI log. Build and release executors are not connected'},
};
export type SoftwareFixtureName=keyof typeof SOFTWARE_FIXTURE_DATA;
export function softwareDevelopmentSpec(name:SoftwareFixtureName,actionId?:string):SurfaceSpec{
  return {root:'work',elements:{work:{type:name,props:{dataBinding:'software',stateKey:'selection',...(actionId?{actionId,actionLabel:name==='Diagnostics'?'Investigate failure':name==='ChangeSet'?'Review selected file':name==='ApiExplorer'?'Review endpoint':'Inspect stage'}:{})}}}};
}
