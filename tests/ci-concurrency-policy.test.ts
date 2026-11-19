import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const workflow=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
const concurrency=/^concurrency:\n((?: {2}.*\n)+)/m.exec(workflow)?.[1]??'';
const setting=(name:string)=>new RegExp('^ {2}'+name+':\\s*(.+)$','m').exec(concurrency)?.[1]?.trim();

it('cancels superseded pull-request runs but lets post-merge push verification finish',()=>{
 // The push run on a protected branch verifies a commit that already landed.
 // Cancelling it on the next merge meant no main run ever completed, so the
 // value must stay conditional on the event rather than a literal true, and it
 // must name pull_request specifically so an inverted comparison cannot pass.
 expect(setting('cancel-in-progress')).toBe("${{ github.event_name == 'pull_request' }}");
 expect(setting('group')).toContain('github.ref');
 // Removing the push trigger would also stop cancelling those runs, but it
 // would stop verifying merged commits too.
 expect(workflow).toMatch(/^on:\n {2}push:\n {4}branches: \[main[,]/m);
});

it('keeps two landed main revisions in different groups without changing same-PR cancellation',()=>{
 const group=setting('group')!;
 const key=(github:Record<string,string>)=>group.replace(/\$\{\{\s*([\s\S]*?)\s*\}\}/g,(_,expression:string)=>String(runInNewContext('('+expression+')',{github},{timeout:100})));
 const push={workflow:'CI',event_name:'push',ref:'refs/heads/main',sha:'a'.repeat(40)};
 expect(key(push)).not.toBe(key({...push,sha:'b'.repeat(40)}));
 expect(key(push)).not.toBe(key({...push,event_name:'workflow_dispatch'}));
 const pr={...push,event_name:'pull_request',ref:'refs/pull/42/merge'};
 expect(key(pr)).toBe(key({...pr,sha:'b'.repeat(40)}));
 expect(key(pr)).not.toBe(key({...pr,ref:'refs/pull/43/merge'}));
});
