import {createElement} from 'react';
import {readFileSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import type {ProjectContext} from '../packages/contracts/workspace';
import {EMPTY_USAGE} from '../packages/contracts';
import {DEFAULT_PREFERENCES} from '../packages/contracts/preferences';
import {ProjectContextCard} from '../apps/web/src/ProjectContextCard';
import {UsageFooter} from '../apps/web/src/UsageFooter';
import {UsageSummary} from '../apps/web/src/WorkspacePanelBodies';
import {WorkspaceSurfaceBody} from '../apps/web/src/WorkspaceSurfaceBody';
import {runtimeUsageReport} from '../apps/web/src/usage-presentation';
import {taskFixture} from './e2e/task-interface-fixture';

const context:ProjectContext={project:{id:'p',name:'Project',rootPath:'C:/Synthetic',authority:{kind:'local'},createdAt:'2026-11-10T00:00:00Z'},threadId:'a',branch:'main',head:'abc',machineName:'Machine',editor:{available:false,label:'Editor'},changes:{added:4,removed:2,files:1},lineage:[],scripts:[],capabilities:{git:true,terminal:false,pullRequests:false}};
const usage={...EMPTY_USAGE,inputTokens:18321,outputTokens:791,cost:0.012345,sessionPercent:23.456,weeklyPercent:67.89,contextTokens:18000,contextWindow:100000};
describe('proven duplicate removals',()=>{
 it.each([undefined,false])('retains overview Changes when equivalence is %s',composerChangesAvailable=>{
  const html=renderToStaticMarkup(createElement(ProjectContextCard,{context,onShowChanges:()=>{},composerChangesAvailable}));
  expect(html).toContain('1 changed files');expect(html).toContain('>Changes</span>');
 });
 it('hides only the proven equivalent overview shortcut',()=>{
  const html=renderToStaticMarkup(createElement(ProjectContextCard,{context,onShowChanges:()=>{},composerChangesAvailable:true}));
  expect(html).not.toContain('>Changes</span>');expect(html).toContain('>main</span>');expect(html).toContain('Project tools');
 });
 it('removes footer detail rows when an owner and Usage destination exist',()=>{
  const html=renderToStaticMarkup(createElement(UsageFooter,{usage,visible:true,threadId:'a',onOpenUsage:()=>{}}));
  expect(html).not.toContain('<dl>');expect(html).toContain('Open Usage');expect(html).toContain('18,321 input tokens');
 });
 it.each([{threadId:'a'}, {onOpenUsage:()=>{}}, {}])('retains full details without a proven owner destination: %j',props=>{
  const html=renderToStaticMarkup(createElement(UsageFooter,{usage,visible:true,...props}));
  for(const text of ['Input tokens','18,321','Output tokens','791','Reported cost','0.012345','23.456%','67.89%'])expect(html).toContain(text);
 });
 it('keeps all footer values in the same-owner full report',()=>{
  expect(runtimeUsageReport({id:'a',title:'Owner A',modelId:'provider/model'},usage)).toMatchObject({scopeId:'a',scopeLabel:'Owner A',inputTokens:18321,outputTokens:791,cost:{amount:0.012345},limits:[{id:'session',usedPercent:23.456},{id:'weekly',usedPercent:67.89}]});
 });
 it('keeps context capacity separate and retains unknown values',()=>{
  const html=renderToStaticMarkup(createElement(UsageSummary,{usage}));expect(html).toContain('Context window');expect(html).toContain('18%');expect(html).toContain('18K of 100K');
  expect(renderToStaticMarkup(createElement(UsageFooter,{visible:true}))).toContain('Not reported');
 });
 it('retains the real Notes route and its explicit owner rather than the active thread',()=>{
  const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Synthetic'}}}});
  snapshot.threads.push({...snapshot.threads[0],id:'other'});snapshot.activeThreadId='other';
  snapshot.memory=[{id:'n',threadId:'task-thread',key:'decision',content:'Owner note',revision:1,author:'user',updatedAt:'2026-11-10T00:00:00Z'}];
  const html=renderToStaticMarkup(createElement(WorkspaceSurfaceBody,{kind:'notes',binding:{authority:{kind:'local'},threadId:'task-thread'},snapshot,refresh:async()=>{},preferences:DEFAULT_PREFERENCES}));
  expect(html).toContain('Owner note');expect(html.match(/aria-label="Thread memory"/g)).toHaveLength(1);
  const usageHtml=renderToStaticMarkup(createElement(WorkspaceSurfaceBody,{kind:'usage',binding:{authority:{kind:'local'},threadId:'task-thread'},snapshot,refresh:async()=>{},preferences:DEFAULT_PREFERENCES}));
  expect(usageHtml).not.toContain('aria-label="Thread memory"');
  expect(usageHtml).not.toContain('Note decision');
 });
 it('opts the production main and split summary owners into the retained composer Changes route',()=>{
  const app=readFileSync(new URL('../apps/web/src/App.tsx',import.meta.url),'utf8');
  const summaries=app.split('<ProjectContextSurface').slice(1).filter(value=>value.includes("key={thread?.id??'new'}"));
  expect(summaries).toHaveLength(2);
  for(const summary of summaries)expect(summary.split('/>')[0]).toContain('composerChangesAvailable={Boolean(thread&&!threadParent(thread)&&!delegatedThread(thread)&&!pinnedThreadId&&!embeddedThreadId)}');
 });
 it('respects the footer visibility preference',()=>{expect(renderToStaticMarkup(createElement(UsageFooter,{usage,visible:false}))).toBe('');});
});
