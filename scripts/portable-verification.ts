import {createServer} from 'node:net';

export async function verificationPorts():Promise<[number,number,number]>{
 const servers:ReturnType<typeof createServer>[]=[];
 try{
  const ports:number[]=[];
  for(let index=0;index<3;index++){
   const server=createServer();servers.push(server);
   await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
   ports.push((server.address() as {port:number}).port);
  }
  return ports as [number,number,number];
 }finally{await Promise.all(servers.map(server=>new Promise<void>(done=>server.close(()=>done()))));}
}

export function assertWrapperArguments(args:string[],nonce:string){
 if(!args.includes('--harness-verification='+nonce))throw Error('The connected browser does not belong to this verification launch');
}
