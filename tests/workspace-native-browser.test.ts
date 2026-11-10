import {expect,it} from 'vitest';
import {detachOwnedBrowser} from '../apps/desktop/browser-lifecycle.ts';

it('parks the displaced docked view without destroying it and can restore that same view on rollback',()=>{
 const views=new Set<string>(['original']);
 const main:{browser?:typeof original;dockedBrowser?:typeof original}={};
 const original={id:'original',owner:main as unknown,alive:true};main.dockedBrowser=original;
 detachOwnedBrowser(main,original,view=>views.delete(view.id));
 expect(main.dockedBrowser).toBeUndefined();expect(original.owner).toBeUndefined();expect(views.size).toBe(0);expect(original.alive).toBe(true);
 // A replacement cannot leave the displaced view in the main content tree.
 const replacement={id:'replacement',owner:main as unknown,alive:true};main.dockedBrowser=replacement;views.add(replacement.id);
 detachOwnedBrowser(main,replacement,view=>views.delete(view.id));
 main.dockedBrowser=original;original.owner=main;views.add(original.id);
 expect([...views]).toEqual(['original']);expect(main.dockedBrowser).toBe(original);expect(replacement.owner).toBeUndefined();expect(replacement.alive).toBe(true);
});
