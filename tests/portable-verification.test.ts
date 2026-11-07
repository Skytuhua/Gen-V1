import {createServer} from 'node:net';
import {afterEach,expect,it} from 'vitest';
import {verificationPorts,assertWrapperArguments} from '../scripts/portable-verification.ts';

const servers:ReturnType<typeof createServer>[]=[];
afterEach(async()=>{await Promise.all(servers.splice(0).map(server=>new Promise<void>(done=>server.close(()=>done()))));});

it('allocates distinct available loopback ports while existing listeners remain untouched',async()=>{
 const existing=createServer();servers.push(existing);await new Promise<void>(done=>existing.listen(0,'127.0.0.1',done));
 const occupied=(existing.address() as {port:number}).port;
 const ports=await verificationPorts();expect(new Set(ports).size).toBe(3);expect(ports).not.toContain(occupied);expect(existing.listening).toBe(true);
 for(const port of ports){const server=createServer();servers.push(server);await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});}
});

it('requires this launch nonce in the actual browser command line before inspecting or closing it',()=>{
 expect(()=>assertWrapperArguments(['app.exe','--harness-verification=earlier'],'fresh')).toThrow(/does not belong/i);
 expect(()=>assertWrapperArguments(['app.exe','--harness-verification=fresh'],'fresh')).not.toThrow();
});
