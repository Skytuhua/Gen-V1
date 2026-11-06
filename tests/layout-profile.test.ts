import {expect,it} from 'vitest';
import {createSplitWorkspaceLayout,applySplitWorkspaceCommand} from '../packages/core/split-workspace-layout';
import {splitLayoutArrangement,resolveSavedLayoutId} from '../apps/web/src/layout-profile';

it('compares real splits, tab order, active tabs, collapse, geometry and parked views',()=>{
 const initial=createSplitWorkspaceLayout(),split=applySplitWorkspaceCommand(initial,'pane.split',{paneId:'pane-main',newPaneId:'other',splitId:'columns',axis:'horizontal',ratio:.6});
 expect(splitLayoutArrangement(split)).not.toBe(splitLayoutArrangement(initial));
 for(const change of [ {...split,root:{...split.root,ratio:.7}}, {...split,panes:{...split.panes,other:{...split.panes.other,collapsed:true}}}])expect(splitLayoutArrangement(change as typeof split)).not.toBe(splitLayoutArrangement(split));
 const tabs=structuredClone(initial);tabs.views={one:{id:'one',kind:'files',binding:{authority:{kind:'local'}}},two:{id:'two',kind:'terminal',binding:{authority:{kind:'local'}}}};tabs.panes['pane-main']={id:'pane-main',viewIds:['one','two'],activeViewId:'one',collapsed:false};
 const basis=splitLayoutArrangement(tabs);for(const mutate of [(v:typeof tabs)=>v.panes['pane-main'].viewIds.reverse(),(v:typeof tabs)=>{v.panes['pane-main'].activeViewId='two';},(v:typeof tabs)=>{v.panes['pane-main'].viewIds.pop();v.parkedViewIds.push('two');}]){const changed=structuredClone(tabs);mutate(changed);expect(splitLayoutArrangement(changed)).not.toBe(basis);}
});
it('ignores revision/history/focus and object insertion order without retaining ownership fields',()=>{
 const layout=createSplitWorkspaceLayout();layout.views.tool={id:'tool',kind:'files',binding:{authority:{kind:'local'},threadId:'private-conversation',resourceId:'private-resource',projectId:'private-project'}};layout.panes['pane-main'].viewIds=['tool'];layout.panes['pane-main'].activeViewId='tool';
 const fingerprint=splitLayoutArrangement(layout);expect(fingerprint).not.toMatch(/private|binding|authority|threadId|resourceId|projectId/);
 const changed={...layout,revision:99,undoDepth:10,redoDepth:3,focusedPaneId:'another',views:Object.fromEntries(Object.entries(layout.views).reverse())};expect(splitLayoutArrangement(changed)).toBe(fingerprint);
});
it('selects by exact newly created identity rather than a duplicate name or list order',()=>{
 const before=[{id:'existing',name:'Desk'}],after=[{id:'new',name:'Desk'},...before];expect(resolveSavedLayoutId(before,after)).toBe('new');
 expect(resolveSavedLayoutId(before,[...after].reverse(),'existing')).toBe('existing');
 expect(()=>resolveSavedLayoutId(before,before)).toThrow(/identify|saved/i);expect(()=>resolveSavedLayoutId([],after)).toThrow(/identify|saved/i);expect(()=>resolveSavedLayoutId(before,[],'existing')).toThrow(/available|saved/i);
});
it('normalizes split object property order when comparing the same arrangement',()=>{
 const layout=applySplitWorkspaceCommand(createSplitWorkspaceLayout(),'pane.split',{paneId:'pane-main',newPaneId:'other',splitId:'columns',axis:'horizontal',ratio:.6});const reordered={...layout,root:Object.fromEntries(Object.entries(layout.root).reverse()) as typeof layout.root};expect(splitLayoutArrangement(reordered)).toBe(splitLayoutArrangement(layout));
});
