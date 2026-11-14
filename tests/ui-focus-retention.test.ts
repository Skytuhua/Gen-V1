import {expect, it, vi} from 'vitest';
import {retainFocus, usableFocusable} from '../packages/ui-shell/focus-retention';

it('selects a tab stop rather than a visible control removed from keyboard or assistive navigation', () => {
  const candidate = (tabIndex:number, hidden=false) => ({
    tabIndex, getClientRects: () => [{}],
    closest: (selector:string) => hidden && selector.includes('aria-hidden') ? {} : null,
  });
  const excluded=candidate(-1), hidden=candidate(0,true), usable=candidate(0);
  const root={querySelectorAll:()=>[excluded,hidden,usable]} as unknown as HTMLElement;
  expect(usableFocusable(root)).toBe(usable);
});

it.each(['owner replaced','listener released'])('ignores queued focus recovery after %s', operation => {
  const listeners = new Map<string, (event:FocusEvent)=>void>();
  const body={};
  const document={
    body, activeElement:body,
    addEventListener(name:string,cb:(event:FocusEvent)=>void){listeners.set(name,cb);},
    removeEventListener(name:string){listeners.delete(name);},
  } as unknown as Document;
  const makeRoot=()=>({
    isConnected:true, ownerDocument:document, contains:()=>true, querySelectorAll:()=>[], focus:vi.fn(),
  });
  const first=makeRoot(), second=makeRoot();
  let root=first;
  const queued:(()=>void)[]=[];
  const release=retainFocus(document,()=>root as unknown as HTMLElement,cb=>queued.push(cb));
  listeners.get('focusout')!({target:{},relatedTarget:null} as unknown as FocusEvent);
  expect(queued).toHaveLength(1);
  if(operation==='owner replaced')root=second;else release();
  queued[0]();
  expect(first.focus).not.toHaveBeenCalled();
  expect(second.focus).not.toHaveBeenCalled();
  release();
});
