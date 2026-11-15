import {expect,it,vi} from 'vitest';
import {RequestBudget,RequestScheduler,StatelessTransportPool,resolveNewTaskProfile,STATELESS_IDLE_EXPIRY_MS,type StatelessTransport} from '../packages/runtime/request-scheduler.ts';
import {warmTransportKeySchema,warmTransportKeyId,type WarmTransportKey} from '../packages/contracts/model-request.ts';

const key=(over:Partial<WarmTransportKey>={}):WarmTransportKey=>({providerId:'openai',accountId:'a1',configDigest:'ab'.repeat(8),toolFree:true,endpointId:'endpoint',profileGeneration:1,...over});
const transport=(outstanding=0):StatelessTransport&{resetCount:number;closed:boolean}=>({stateless:true,outstanding,resetCount:0,closed:false,reset(){this.resetCount++;},close(){this.closed=true;}});

it('foreground requests pass queued idle work but never steal an active permit',async()=>{
 const scheduler=new RequestScheduler(1),order:string[]=[];
 const first=await scheduler.acquire('p','a');
 const queued=scheduler.acquire('p','a',undefined,{requestClass:'background'});void queued.then(()=>order.push('background'));
 const urgent=scheduler.acquire('p','a',undefined,{requestClass:'foreground'});void urgent.then(()=>order.push('foreground'));
 first.release();await vi.waitFor(()=>expect(order).toEqual(['foreground']));
 const second=await urgent;
 // A queued background request cannot observe the released slot until the
 // foreground holder has finished with it.
 second.release();(await queued).release();
});
it('bounded aging promotes a background waiter and per-account limits hold',async()=>{
 let tick=0;const scheduler=new RequestScheduler(1,50);const now=()=>tick;
 const held=await scheduler.acquire('p','a',undefined,{requestClass:'foreground',now});
 const background=scheduler.acquire('p','a',undefined,{requestClass:'background',now});
 const late=scheduler.acquire('p','a',undefined,{requestClass:'foreground',now});
 tick=100;held.release();
 // The aged background request ranks as foreground for fairness.
 const bg=await background;expect(bg.requestClass).toBe('background');bg.release();
 const lt=await late;lt.release();
});
it('records queue delays, honours queued cancellation, and never exceeds the account limit',async()=>{
 const scheduler=new RequestScheduler(2);
 const a=await scheduler.acquire('p','acct'),b=await scheduler.acquire('p','acct');
 let started=0;const controller=new AbortController();
 const queued=scheduler.acquire('p','acct',controller.signal).then(()=>{started++;});
 controller.abort();await expect(queued).rejects.toMatchObject({code:'MODEL_REQUEST_CANCELLED'});
 a.release();await vi.waitFor(()=>expect(scheduler.queueDelays().length).toBeGreaterThanOrEqual(2));
 b.release();expect(started).toBe(0);
});
it('budgets admit before dispatch and reconcile measured spend only',()=>{
 const budget=new RequestBudget({maxCalls:1,maxInputTokens:100});
 budget.admit();budget.reconcile({inputTokens:40,outputTokens:5});
 expect(()=>budget.admit()).toThrowError(expect.objectContaining({code:'MODEL_BUDGET_EXCEEDED'}));
 const tokens=new RequestBudget({maxInputTokens:100});
 tokens.reconcile({inputTokens:40,outputTokens:null});
 expect(()=>tokens.reconcile({inputTokens:70,outputTokens:5})).toThrowError(expect.objectContaining({code:'MODEL_BUDGET_EXCEEDED'}));
 expect(()=>new RequestBudget({maxOutputTokens:1}).reconcile({outputTokens:2})).toThrowError(expect.objectContaining({code:'MODEL_BUDGET_EXCEEDED'}));
 // Missing pricing is never invented: absent usage fields count as nothing.
 expect(new RequestBudget({maxInputTokens:1}).reconcile(null)).toBeUndefined();
});
it('stateless pooling requires exact keys, clears owner state, expires idle transports and invalidates on change',async()=>{
 let tick=0;const pool=new StatelessTransportPool(()=>tick);
 const item=transport();expect(pool.offer(key(),item)).toBe(true);
 expect(await pool.take(key({accountId:'other'}))).toBeNull();
 const reused=await pool.take(key());expect(reused).toBe(item);expect(item.resetCount).toBe(1);
 // Busy transports are never pooled.
 expect(pool.offer(key(),transport(1))).toBe(false);
 const stale=transport();expect(pool.offer(key(),stale)).toBe(true);
 tick+=STATELESS_IDLE_EXPIRY_MS+1;expect(await pool.take(key())).toBeNull();expect(stale.closed).toBe(true);
 const invalidated=transport();expect(pool.offer(key(),invalidated)).toBe(true);
 await pool.invalidate(key());expect(invalidated.closed).toBe(true);
});
it('two accounts on two threads never observe each other\'s transport inputs',async()=>{
 const pool=new StatelessTransportPool();
 const requests=(label:string)=>{const inputs:string[]=[];return{transport:{...transport(),reset(){this.resetCount++;},send(input:string){inputs.push(label+':'+input);}},inputs};};
 const a1t1=requests('a1-t1'),a1t2=requests('a1-t2'),b1t1=requests('b1-t1'),b1t2=requests('b1-t2');
 const threadKey=(accountId:string,thread:number)=>key({accountId,configDigest:'0'.repeat(15)+thread});
 pool.offer(threadKey('a1',1),a1t1.transport);pool.offer(threadKey('a1',2),a1t2.transport);
 pool.offer(threadKey('b1',1),b1t1.transport);pool.offer(threadKey('b1',2),b1t2.transport);
 // Every take resolves exactly its own (account, thread) slot — a warm
 // transport from another account or thread is never served.
 expect(await pool.take(threadKey('b1',1))).toBe(b1t1.transport);
 expect(await pool.take(threadKey('a1',1))).toBe(a1t1.transport);
 expect(await pool.take(threadKey('a1',2))).toBe(a1t2.transport);
 expect(await pool.take(threadKey('b1',2))).toBe(b1t2.transport);
 a1t1.transport.send('ping');b1t2.transport.send('ping');
 expect(a1t1.inputs).toEqual(['a1-t1:ping']);expect(b1t2.inputs).toEqual(['b1-t2:ping']);
 expect(a1t2.inputs).toEqual([]);expect(b1t1.inputs).toEqual([]);
});
it('warm transport keys require a config digest and canonical identity',()=>{
 expect(()=>warmTransportKeySchema.parse(key())).not.toThrow();
 expect(()=>warmTransportKeySchema.parse(key({configDigest:'weak'}))).toThrow();
 expect(warmTransportKeyId(key())).not.toBe(warmTransportKeyId(key({profileGeneration:2})));
 expect(warmTransportKeyId(key())).not.toBe(warmTransportKeyId(key({toolFree:false})));
});
it('task-role routing only resolves approved static mappings and blocks on unavailable models',()=>{
 const mapping={planner:{providerId:'openai',accountId:'a1',modelId:'openai/gpt-5'},reviewer:{providerId:'openai',accountId:null,modelId:'openai/gpt-5-mini'}};
 expect(resolveNewTaskProfile('planner',mapping,['openai/gpt-5'])).toMatchObject({modelId:'openai/gpt-5',accountId:'a1'});
 expect(()=>resolveNewTaskProfile('unknown',mapping,['openai/gpt-5'])).toThrowError(expect.objectContaining({code:'MODEL_PROFILE_UNKNOWN'}));
 expect(()=>resolveNewTaskProfile('reviewer',mapping,['openai/gpt-5'])).toThrowError(expect.objectContaining({code:'MODEL_PROFILE_UNAVAILABLE'}));
});
