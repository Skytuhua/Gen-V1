import {describe,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// The broker-free custody bookkeeping suite is a python3 unittest module that
// cannot match the vitest include pattern itself; this wrapper keeps it inside
// the existing pnpm test gate. POSIX-only like the broker it guards.
describe('Linux path-guard cleanup bookkeeping',()=>{
 it.skipIf(process.platform==='win32')('passes the broker-free custody suite',()=>{
  execFileSync('python3',['-I','-S','-B',fileURLToPath(new URL('./linux_path_guard_cleanup.py',import.meta.url))],{stdio:'inherit'});
 });
});
