import {expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {InboxView} from '../apps/web/src/InboxView.tsx';
import {InboxItemRow,InboxPane} from '../third-party/vespin/inbox-presentation.tsx';
import {oneColumn} from '../third-party/vespin/inbox-columns.ts';
import type {AttentionItem} from '../packages/contracts/attention.ts';
it('shares Inbox presentation without invoking a personal host or inventing available private records',()=>{
 const refresh=vi.fn(async()=>{}),mark=vi.fn(async()=>{});
 const html=renderToStaticMarkup(createElement(InboxView,{attention:{items:[],unread:0,error:'',refresh,markRead:mark,markUnread:mark},onOpenThread:()=>{},emptyTitle:'Company inbox is not connected',emptyMessage:'An approved private adapter is required.'}));
 expect(html).toContain('Company inbox is not connected');expect(html).not.toContain('caught up');expect(refresh).not.toHaveBeenCalled();expect(mark).not.toHaveBeenCalled();
});
it('retains the actual Vespin three-line row, unread gutter and above-title metadata arrangement',()=>{
 const onPress=vi.fn(),html=renderToStaticMarkup(createElement(InboxItemRow,{title:'Choose the current project',description:'The current request remains in its canonical conversation.',lead:{icon:createElement('span',null,'A'),label:'Current task'},meta:createElement('time',null,'now'),unread:true,current:true,muted:false,onPress,label:'Choose the current project, unread'}));
 expect(html).toContain('class="ui-list-row"');expect(html).toContain('data-meta="title"');expect(html).toContain('data-lead="above"');expect(html).toContain('ui-list-row-leading');expect(html).toContain('ui-unread-dot');expect(html).toContain('ui-list-row-head');expect(html).toContain('ui-list-row-lead-label');expect(html.indexOf('ui-list-row-lead-label')).toBeLessThan(html.indexOf('ui-list-row-title'));expect(html).toContain('data-current="true"');expect(onPress).not.toHaveBeenCalled();
});
it('uses the vendored list and reader presentation for canonical Gen items without adding send authority',()=>{
 const item:AttentionItem={id:'request:a:1',threadId:'thread-a',kind:'request',title:'A real conversation',summary:'Choose a destination',state:'needs-input',createdAt:'2026-11-04T00:00:00.000Z',updatedAt:'2026-11-04T00:00:00.000Z',read:false,popupDismissed:false,actionable:true,notificationKey:'request:a:1:needs-input',destination:{threadId:'thread-a'}},mark=vi.fn(async()=>{}),open=vi.fn();
 const html=renderToStaticMarkup(createElement(InboxView,{attention:{items:[item],unread:1,error:'',refresh:async()=>{},markRead:mark,markUnread:mark},onOpenThread:open}));
 expect(html).toContain('inbox-tasks-body');expect(html).toContain('sidebar-tasks');expect(html).toContain('ui-list-row');expect(html).toContain('inbox-view-items');expect(html).toContain('aria-label="Inbox filter"');expect(html).toContain('aria-label="Refresh inbox"');expect(html).not.toContain('agent-inbox-agent');expect(html).not.toContain('textarea');expect(mark).not.toHaveBeenCalled();expect(open).not.toHaveBeenCalled();
});
it('keeps Vespin subject and message structure while the canonical action remains outside vendored code',()=>{
 const html=renderToStaticMarkup(createElement(InboxPane,{title:'Current question',hidden:false,toolbar:createElement('button',null,'Open conversation'),children:createElement('p',null,'Canonical summary')}));
 expect(html).toContain('inbox-subject');expect(html).toContain('data-inbox-title=""');expect(html).toContain('inbox-board');expect(html).toContain('aria-label="Messages"');expect(html).toContain('Canonical summary');
});
it('uses the upstream 860/892 container-width hysteresis instead of a redesigned viewport breakpoint',()=>{
 expect(oneColumn(859,false)).toBe(true);expect(oneColumn(860,false)).toBe(false);expect(oneColumn(880,true)).toBe(true);expect(oneColumn(892,true)).toBe(false);
});
