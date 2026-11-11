interface DockedBrowserOwner<T> {surface:{kind:string};browser?:T;dockedBrowser?:T}
/** Open only a host-created view in the existing main window. Existing child
 * views remain with their owner, and repeated requests retain current bounds. */
export function ensureMainDockedBrowser<T extends {id:string;owner?:unknown}>(owner:DockedBrowserOwner<T>,create:()=>T,attach:(browser:T)=>void,dispose:(browser:T)=>void):T {
 if(owner.surface.kind!=='main')throw Error('Only the main workspace can open a docked browser.');
 if(owner.browser)throw Error('The main window has conflicting browser custody.');
 const existing=owner.dockedBrowser;
 if(existing){if(existing.owner!==owner)throw Error('The docked browser belongs to another window.');return existing;}
 const browser=create();
 if(browser.owner!==undefined)throw Error('The browser already belongs to another window.');
 try{
  attach(browser);
  if(owner.dockedBrowser!==browser||browser.owner!==owner)throw Error('Browser ownership could not be established.');
 }catch(error){
  if(owner.dockedBrowser===browser)owner.dockedBrowser=undefined;
  if(owner.browser===browser)owner.browser=undefined;
  if(browser.owner===owner)browser.owner=undefined;
  if(browser.owner===undefined)try{dispose(browser);}catch(cleanupError){throw new AggregateError([error,cleanupError],'The in-app browser could not be opened or fully cleaned up.');}
  throw error;
 }
 return browser;
}
