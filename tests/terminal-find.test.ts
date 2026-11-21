import {describe,expect,it} from 'vitest';
import {terminalFindCounter} from '../apps/web/src/TerminalFind';

describe('terminalFindCounter',()=>{
 it('is empty before any search',()=>{
  expect(terminalFindCounter(null,1000)).toBe('');
 });
 it('reports no results',()=>{
  expect(terminalFindCounter({index:-1,count:0},1000)).toBe('No results');
 });
 it('reports the one-based active position',()=>{
  expect(terminalFindCounter({index:2,count:12},1000)).toBe('3 of 12');
 });
 it('reports the count when no match is active',()=>{
  expect(terminalFindCounter({index:-1,count:5},1000)).toBe('5 results');
 });
 it('marks the count capped at the highlight limit',()=>{
  expect(terminalFindCounter({index:9,count:1000},1000)).toBe('10 of 1000+');
 });
});
