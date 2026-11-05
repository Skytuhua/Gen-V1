/** Park a view during a layout transaction so rollback can reuse its WebContents. */
export function detachOwnedBrowser<T extends {owner?:unknown}>(owner:{browser?:T;dockedBrowser?:T},browser:T,detach:(browser:T)=>void):void {
 if(browser.owner!==owner)return;
 detach(browser);
 if(owner.browser===browser)owner.browser=undefined;
 if(owner.dockedBrowser===browser)owner.dockedBrowser=undefined;
 browser.owner=undefined;
}
/** Dispose only views still owned here. Reparenting clears the old owner first. */
export function releaseOwnedBrowsers<T extends {id:string;owner?:unknown}>(owner:{browser?:T;dockedBrowser?:T},records:Map<string,T>,dispose:(browser:T)=>void):void {
 const attached=[owner.browser,owner.dockedBrowser];owner.browser=undefined;owner.dockedBrowser=undefined;
 for(const browser of attached)if(browser&&browser.owner===owner){browser.owner=undefined;records.delete(browser.id);dispose(browser);}
}
