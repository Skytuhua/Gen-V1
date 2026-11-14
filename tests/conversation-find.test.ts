import {describe,it,expect} from 'vitest';
import {findTextOffsets, nextFindIndex, retainFindIndex} from '../apps/web/src/conversation-find';
describe('conversation find',()=>{
 it('finds literal phrases without interpreting regex or losing Unicode offsets',()=>{
  expect(findTextOffsets('😀 WorkSPACE workspace [a]. [a].','workspace')).toEqual([{start:3,end:12},{start:13,end:22}]);
  expect(findTextOffsets('a+b aab a+b','a+b')).toEqual([{start:0,end:3},{start:8,end:11}]);
  expect(findTextOffsets('İ test TEST','test')).toEqual([{start:2,end:6},{start:7,end:11}]);
  expect(findTextOffsets('anything','')).toEqual([]);
 });
 it('wraps in both directions and handles no results',()=>{
  expect(nextFindIndex(2,1,3)).toBe(0);expect(nextFindIndex(0,-1,3)).toBe(2);expect(nextFindIndex(0,1,0)).toBe(-1);
 });
 it('retains the active message offset through prepend and background arrivals',()=>{
  expect(retainFindIndex(['older:0','m:4','later:0'],'m:4')).toBe(1);
  expect(retainFindIndex(['new:0'],'removed:0')).toBe(0);expect(retainFindIndex([],null)).toBe(-1);
 });
});
