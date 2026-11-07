import {expect,it} from 'vitest';
import {createSplitWorkspaceLayout,applySplitWorkspaceCommand,minimumSplitSize} from '../packages/core/split-workspace-layout.ts';
import {toolPlacementCommand} from '../apps/web/src/split-tool-placement.ts';
const local={kind:'local' as const};
it('keeps an explicitly captured plan owner and fits it beside the complete existing layout',()=>{
 let layout=createSplitWorkspaceLayout();layout=applySplitWorkspaceCommand(layout,'view.open',{view:{id:'a',kind:'thread',binding:{authority:local,threadId:'a'}}});layout=applySplitWorkspaceCommand(layout,'pane.split',{paneId:'pane-main',newPaneId:'right',splitId:'first',axis:'horizontal',view:{id:'b',kind:'thread',binding:{authority:local,threadId:'b'}}});
 const view={id:'plan:a',kind:'plan' as const,binding:{authority:local,threadId:'a'}},command=toolPlacementCommand(layout,view,'right',true,{width:1352,height:900});
 expect(command.payload.view).toEqual(view);expect(command.type).toBe('pane.split');expect(command.payload.outer).toBe(true);
 const ratio=command.payload.ratio as number;expect((1352-6)*ratio).toBeGreaterThanOrEqual(minimumSplitSize(layout).width);expect((1352-6)*(1-ratio)).toBeGreaterThanOrEqual(240);
});
it('uses a recoverable tab when no legal split fits and reopens an existing plan without another area',()=>{
 let layout=createSplitWorkspaceLayout();const view={id:'plan:a',kind:'plan' as const,binding:{authority:local,threadId:'a'}};
 const command=toolPlacementCommand(layout,view,'pane-main',true,{width:330,height:250});expect(command.type).toBe('view.open');
 layout=applySplitWorkspaceCommand(layout,command.type,command.payload);expect(toolPlacementCommand(layout,view,'pane-main',true,{width:1352,height:900}).type).toBe('view.open');
});
it('reuses the empty area left by a parked plan on a new plan publication',()=>{
 let layout=createSplitWorkspaceLayout();layout=applySplitWorkspaceCommand(layout,'view.open',{view:{id:'a',kind:'thread',binding:{authority:local,threadId:'a'}}});const view={id:'plan:a',kind:'plan' as const,binding:{authority:local,threadId:'a'}};
 layout=applySplitWorkspaceCommand(layout,'pane.split',{paneId:'pane-main',newPaneId:'plan-area',splitId:'first',axis:'horizontal',view});layout=applySplitWorkspaceCommand(layout,'view.park',{viewId:view.id});
 const command=toolPlacementCommand(layout,view,'pane-main',true,{width:1352,height:900});expect(command.type).toBe('view.open');expect(command.payload.paneId).toBe('plan-area');expect(Object.keys(applySplitWorkspaceCommand(layout,command.type,command.payload).panes)).toHaveLength(2);
});
