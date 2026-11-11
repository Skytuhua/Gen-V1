import {describe,expect,it} from 'vitest';
import {DESKTOP_CHANNELS} from '../packages/desktop-contract/index.ts';
import {parseBrowserCommand,pluginDesktopChannelAllowed,requireExistingDetachedSurface} from '../apps/desktop/window-policy.ts';
import {ensureMainDockedBrowser} from '../apps/desktop/docked-browser.ts';

describe('explicit in-app browser opening',()=>{
 it('admits only the fixed no-argument command',()=>{
  expect(parseBrowserCommand({type:'open'})).toEqual({type:'open'});
  for(const value of [{type:'open',browserId:'other'},{type:'open',url:'https://example.com'},{type:'open',surface:{kind:'main'}},{type:'open',native:true}])expect(()=>parseBrowserCommand(value)).toThrow();
 });
 it('keeps plug-in browser IPC and new detached native windows denied',()=>{
  expect(pluginDesktopChannelAllowed(DESKTOP_CHANNELS.browser)).toBe(false);
  expect(()=>requireExistingDetachedSurface({kind:'browser',browserId:'new'},[{kind:'main'}])).toThrow('unavailable');
 });
 it('creates one blank view inside the main owner and reuses it without another allocation',()=>{
  type Browser={id:string;owner?:unknown};const owner:{surface:{kind:string};dockedBrowser?:Browser}={surface:{kind:'main'}};let allocations=0,attachments=0;
  const create=()=>({id:'host-generated-'+(++allocations)}),attach=(view:Browser)=>{attachments++;view.owner=owner;owner.dockedBrowser=view;},dispose=()=>{throw Error('The attached view must remain open');};
  const first=ensureMainDockedBrowser(owner,create,attach,dispose),second=ensureMainDockedBrowser(owner,create,attach,dispose);
  expect(first).toBe(second);expect(allocations).toBe(1);expect(attachments).toBe(1);expect(owner.dockedBrowser).toBe(first);
 });
 it('refuses non-main requests and existing foreign custody before allocating or moving anything',()=>{
  const child={surface:{kind:'browser'}},view={id:'child-browser',owner:child},main={surface:{kind:'main'},dockedBrowser:view};let allocated=false,attached=false,disposed=false;
  const create=()=>{allocated=true;return{id:'new'};},attach=()=>{attached=true;},dispose=()=>{disposed=true;};
  for(const kind of ['plugin','thread','browser','workspace'])expect(()=>ensureMainDockedBrowser({surface:{kind}},create,attach,dispose)).toThrow();
  expect(()=>ensureMainDockedBrowser(main,create,attach,dispose)).toThrow();
  expect(allocated||attached||disposed).toBe(false);expect(view.owner).toBe(child);expect(main.dockedBrowser).toBe(view);
 });
 it('opens an independent view without borrowing or disposing an existing child browser',()=>{
  type Browser={id:string;owner?:unknown};const child={surface:{kind:'browser'}},childView:Browser={id:'child-browser',owner:child},registry=new Map([[childView.id,childView]]),main:{surface:{kind:string};dockedBrowser?:Browser}={surface:{kind:'main'}};
  const opened=ensureMainDockedBrowser(main,()=>{const view:Browser={id:'new-main-browser'};registry.set(view.id,view);return view;},view=>{view.owner=main;main.dockedBrowser=view;},()=>{throw Error('No existing browser may be disposed');});
  expect(registry.size).toBe(2);expect(opened).not.toBe(childView);expect(childView.owner).toBe(child);expect(registry.get(childView.id)).toBe(childView);
 });
 it('refuses conflicting main custody and an already-owned factory result without disposal',()=>{
  type Browser={id:string;owner?:unknown};const child={surface:{kind:'browser'}},existing:Browser={id:'child-browser',owner:child},main:{surface:{kind:string};browser?:Browser}={surface:{kind:'main'},browser:existing};let allocated=false,disposed=false;
  const create=()=>{allocated=true;return existing;},dispose=()=>{disposed=true;};
  expect(()=>ensureMainDockedBrowser(main,create,()=>{},dispose)).toThrow('conflicting');expect(allocated).toBe(false);
  expect(()=>ensureMainDockedBrowser({surface:{kind:'main'}},create,()=>{},dispose)).toThrow('already belongs');expect(disposed).toBe(false);expect(existing.owner).toBe(child);
 });
 it('cleans up only a newly allocated view if attaching fails',()=>{
  type Browser={id:string;owner?:unknown};const owner:{surface:{kind:string};dockedBrowser?:Browser}={surface:{kind:'main'}},created:Browser={id:'new'};const disposed:Browser[]=[];
  expect(()=>ensureMainDockedBrowser(owner,()=>created,view=>{owner.dockedBrowser=view;view.owner=owner;throw Error('Attach failed');},view=>disposed.push(view))).toThrow('Attach failed');
  expect(owner.dockedBrowser).toBeUndefined();expect(created.owner).toBeUndefined();expect(disposed).toEqual([created]);
 });
});
