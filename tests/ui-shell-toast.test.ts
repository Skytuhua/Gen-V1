import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {dismissToast,toast,Toaster} from '../packages/ui-shell/Toast';

// The toast store is module-level: entries only leave when a DOM animation
// finishes, which never happens under renderToStaticMarkup. Push enough
// distinct messages to evict leftovers from earlier tests before asserting.
const drain=()=>{toast('drain-1');toast('drain-2');toast('drain-3');toast('drain-4');};
const markup=()=>renderToStaticMarkup(createElement(Toaster,{}));
const entryHtml=(message:string)=>{
 const part=markup().split('<div class="ui-toast"').find(chunk=>chunk.includes(`>${message}<`));
 expect(part,`a toast entry for ${JSON.stringify(message)}`).toBeDefined();
 return part!;
};

describe('toast()',()=>{
 it('returns 0 and renders nothing for a blank message',()=>{
  drain();
  expect(toast('   ')).toBe(0);
  expect(markup().match(/<div class="ui-toast"/g)).toHaveLength(3);
 });
 it('dedupes an identical message instead of stacking it',()=>{
  drain();
  toast('same');
  toast('same');
  expect(markup().match(/>same</g)).toHaveLength(1);
 });
 it('caps the stack at three entries and evicts the oldest',()=>{
  drain();
  toast('keep-1');toast('keep-2');toast('keep-3');toast('keep-4');
  const html=markup();
  expect(html.match(/<div class="ui-toast"/g)).toHaveLength(3);
  expect(html).not.toContain('>keep-1<');
  for(const message of ['keep-2','keep-3','keep-4']) expect(html).toContain(`>${message}<`);
 });
});

describe('dismissToast()',()=>{
 it('marks only the targeted entry closed',()=>{
  drain();
  const id=toast('bye');
  toast('stay');
  dismissToast(id);
  expect(entryHtml('bye')).toContain('data-state="closed"');
  expect(entryHtml('stay')).toContain('data-state="open"');
 });
});

describe('Toaster markup',()=>{
 it('mounts a Notifications region',()=>{
  drain();
  const html=markup();
  expect(html).toContain('role="region"');
  expect(html).toContain('aria-label="Notifications"');
 });
 it.each([{tone:'error' as const,role:'alert'},{tone:'info' as const,role:'status'},{tone:'success' as const,role:'status'}])('renders tone=$tone as role=$role',({tone,role})=>{
  drain();
  toast(`tone-${tone}`,{tone});
  const part=entryHtml(`tone-${tone}`);
  expect(part).toContain(`data-tone="${tone}"`);
  expect(part).toContain(`role="${role}"`);
 });
 it('renders the action label and the dismiss control',()=>{
  drain();
  toast('with-action',{action:{label:'Undo',onClick:()=>{}}});
  const part=entryHtml('with-action');
  expect(part).toContain('ui-toast-action');
  expect(part).toContain('>Undo<');
  expect(part).toContain('aria-label="Dismiss notification"');
 });
});
