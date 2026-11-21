import {describe,expect,it} from 'vitest';
import {agentProjectCatalog, agentProjectFilterOptions} from '../apps/web/src/agents-workspace/project-catalog';

describe('agent project filter catalog (AUD-12)',()=>{
 it('drops an authoritatively removed project that no visible agent references',()=>{
  const agents=[{projectId:'p1',projectName:'One'}];
  const before=agentProjectCatalog([{id:'p1',name:'One'},{id:'p2',name:'Two'}],agents);
  expect([...before.keys()]).toEqual(['p1','p2']);
  const after=agentProjectCatalog([{id:'p1',name:'One'}],agents);
  expect([...after.keys()]).toEqual(['p1']);
 });
 it('retains a removed project that a visible agent still references',()=>{
  const catalog=agentProjectCatalog([{id:'p1',name:'One'}],[{projectId:'p2',projectName:'Two'}]);
  expect([...catalog.keys()]).toEqual(['p1','p2']);
  expect(catalog.get('p2')).toBe('Two');
 });
 it('falls back to the project id when the agent has no project name',()=>{
  expect(agentProjectCatalog([],[{projectId:'p3',projectName:null}]).get('p3')).toBe('p3');
 });
 it('ignores unbound agents and does not accumulate across calls',()=>{
  const agents=[{projectId:null,projectName:null}];
  expect([...agentProjectCatalog([{id:'p1',name:'One'}],agents).keys()]).toEqual(['p1']);
  const first=agentProjectCatalog([{id:'p1',name:'One'},{id:'p2',name:'Two'}],[]);
  const second=agentProjectCatalog([{id:'p1',name:'One'}],[]);
  expect([...first.keys()]).toEqual(['p1','p2']);
  expect([...second.keys()]).toEqual(['p1']);
 });
});

describe('agent project filter options (AUD-13)',()=>{
 const catalog=agentProjectCatalog([{id:'p1',name:'One'}],[]);
 it('keeps an applied filter visible when its project left the catalog',()=>{
  const options=agentProjectFilterOptions(catalog,'p-gone');
  expect(options.some(option=>option.value==='p-gone')).toBe(true);
 });
 it('does not duplicate a project already in the catalog',()=>{
  const options=agentProjectFilterOptions(catalog,'p1');
  expect(options.filter(option=>option.value==='p1')).toHaveLength(1);
 });
 it('leaves the option list untouched for all/none scopes',()=>{
  expect(agentProjectFilterOptions(catalog,undefined).map(option=>option.value)).toEqual(['$all','p1','$none']);
  expect(agentProjectFilterOptions(catalog,null).map(option=>option.value)).toEqual(['$all','p1','$none']);
 });
});
