import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';

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
