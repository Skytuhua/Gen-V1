import {expect,it} from 'vitest';
import {orderSidebarProjects} from '../apps/web/src/ShellSidebar';
import type {ThreadNavigationRow} from '../packages/contracts/shell-read-models';

const row = (id:string, projectId:string|undefined, createdAt:string, updatedAt:string, order:number):ThreadNavigationRow =>
  ({id,title:id,projectId,projectName:null,createdAt,updatedAt,status:'ready',runId:null,presentation:{order}});

it('orders project groups without changing the incoming order of rows within each group',()=>{
  const rows=[
    row('a1','a','2026-03-01','2026-11-12',10),
    row('b','b','2026-01-01','2026-11-11',20),
    row('a2','a','2026-02-01','2026-11-13',1),
    row('none',undefined,'2026-04-01','2026-11-11',0),
  ];
  const ids=(order:'manual'|'recent'|'created')=>orderSidebarProjects(rows,true,order).map(x=>x.id);
  expect(ids('created')).toEqual(['b','a1','a2','none']);
  expect(ids('recent')).toEqual(['a1','a2','b','none']);
  expect(ids('manual')).toEqual(['none','a1','a2','b']);
  expect(orderSidebarProjects(rows,false,'recent')).toBe(rows);
  expect(rows.map(x=>x.id)).toEqual(['a1','b','a2','none']);
});

it('reads each project identity once, even in a workspace with many project groups',()=>{
  let reads=0;
  const rows=Array.from({length:750},(_,i)=>Object.defineProperty(
    row(String(i),undefined,'2026-01-01','2026-11-13',i),'projectId',
    {get(){reads++;return 'project-'+(i%150);}},
  ));
  const ordered=orderSidebarProjects(rows,true,'manual');
  expect(ordered).toHaveLength(rows.length);
  expect(ordered[1].id).toBe('150');
  expect(reads).toBe(rows.length);
});
