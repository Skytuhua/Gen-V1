import {describe,expect,it} from 'vitest';
import {probeUrl} from '../scripts/check-doc-links.mjs';

const respond=(status,headers={})=>new Response(null,{status,headers});
const stub=(...replies)=>{
  const seen=[];
  const request=url=>{seen.push(url+' HEAD');return Promise.resolve((replies.length>1?replies.shift():replies[0])());};
  return {request,seen};
};

describe('external link classification',()=>{
  it('accepts a success and reports 404 and 410 as dead',async()=>{
    expect(await probeUrl('https://alpha.com/x',{request:async()=>respond(200)})).toBeNull();
    expect(await probeUrl('https://alpha.com/x',{request:async()=>respond(404)})).toEqual({reason:'HTTP 404',dead:true});
    expect(await probeUrl('https://alpha.com/x',{request:async()=>respond(410)})).toEqual({reason:'HTTP 410',dead:true});
  });
  it('retries a failing server and warns instead of failing',async()=>{
    let attempts=0;
    const outcome=await probeUrl('https://alpha.com/x',{retryDelayMs:0,request:async()=>{attempts+=1;return respond(503);}});
    expect(outcome).toEqual({reason:'HTTP 503',dead:false});
    expect(attempts).toBe(6);
  });
  it('falls back to GET when HEAD is refused, and warns on a client error that is not dead',async()=>{
    const seen=[];
    const request=async(url,init)=>{seen.push(url+' '+init.method);return respond(seen.length===1?405:200);};
    expect(await probeUrl('https://alpha.com/x',{request,retryDelayMs:0})).toBeNull();
    expect(seen).toEqual(['https://alpha.com/x HEAD','https://alpha.com/x GET']);
    expect(await probeUrl('https://alpha.com/x',{request:async()=>respond(403),retryDelayMs:0})).toEqual({reason:'HTTP 403',dead:false});
  });
  it('reports a missing host as dead and a network failure as a warning',async()=>{
    const refusing=code=>async()=>{throw Object.assign(new Error('fetch failed'),{cause:{code}});};
    expect(await probeUrl('https://gone.invalid.example/x',{request:refusing('ENOTFOUND'),retryDelayMs:0})).toEqual({reason:'request failed (ENOTFOUND)',dead:true});
    expect(await probeUrl('https://alpha.com/x',{request:refusing('ECONNRESET'),retryDelayMs:0})).toEqual({reason:'request failed (ECONNRESET)',dead:false});
  });
  it('follows a public redirect and refuses one that leaves the public internet',async()=>{
    const publicHop=stub(()=>respond(301,{location:'https://beta.com/x'}),()=>respond(200));
    expect(await probeUrl('https://alpha.com/x',{request:publicHop.request,retryDelayMs:0})).toBeNull();
    expect(publicHop.seen).toEqual(['https://alpha.com/x HEAD','https://beta.com/x HEAD']);

    const privateHop=stub(()=>respond(302,{location:'http://169.254.169.254/latest/meta-data'}));
    expect(await probeUrl('https://alpha.com/x',{request:privateHop.request,retryDelayMs:0})).toEqual({reason:'redirects to a non-public address',dead:false});
    expect(privateHop.seen).toEqual(['https://alpha.com/x HEAD']);
  });
  it('stops after five redirect hops',async()=>{
    let hop=0;
    const outcome=await probeUrl('https://alpha.com/x',{retryDelayMs:0,request:async url=>{hop+=1;return respond(302,{location:url+'/'+hop});}});
    expect(outcome).toEqual({reason:'redirect loop',dead:false});
    expect(hop).toBe(5);
  });
});
