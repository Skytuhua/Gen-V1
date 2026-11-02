import {createInterface} from 'node:readline';
const pending=new Map();
let writes=Promise.resolve();
const write=value=>process.stdout.write(JSON.stringify(value)+'\n');
createInterface({input:process.stdin}).on('line',line=>{
 const message=JSON.parse(line);
 if(message.hostResult){const request=pending.get(message.hostResult.id);if(request){pending.delete(message.hostResult.id);write({id:request,result:message.hostResult.result});}return;}
 const {id,method,params}=message;
 if(method==='never')return;
 if(method==='invalid'){process.stdout.write('invalid protocol\n');return;}
 if(method==='host'){pending.set('host-1',id);write({hostCall:{id:'host-1',name:'fixture.read',args:params,ctx:{threadId:'thread',runId:'run',epoch:1}}});return;}
 if(method==='event'){write({event:'fixture.event',ctx:{threadId:'thread',runId:'run',epoch:1},data:params});write({id,result:true});return;}
 if(method==='environment'){write({id,result:{home:process.env.HOME,keyPresent:Boolean(process.env.OPENAI_API_KEY),noSite:process.env.PYTHONNOUSERSITE,noLazyInstall:process.env.HERMES_DISABLE_LAZY_INSTALLS}});return;}
 const bytes=Buffer.from(JSON.stringify({id,result:params})+'\n'),emoji=bytes.indexOf(Buffer.from('😀')),split=emoji>=0?emoji+1:bytes.length-3;
 writes=writes.then(()=>new Promise(done=>{process.stdout.write(bytes.subarray(0,split));setImmediate(()=>{process.stdout.write(bytes.subarray(split));done();});}));
});
