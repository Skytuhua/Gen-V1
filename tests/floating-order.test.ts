import {afterEach,describe,expect,it,vi} from 'vitest';
import {bringForward,layerFor,removeLayer,subscribeLayer} from '../apps/web/src/floating-order';

const ids=['first','second','third','fourth','fifth','sixth','seventh'];
afterEach(()=>ids.forEach(removeLayer));

describe('floating window stacking order',()=>{
 it('gives every window a distinct layer even beyond four windows',()=>{
  ids.forEach(bringForward);
  const layers=ids.map(layerFor);
  expect(new Set(layers).size).toBe(ids.length);
  expect(layerFor('seventh')).toBe(34+ids.length-1);
 });
 it('stacks by recency when a buried window is brought forward',()=>{
  ids.forEach(bringForward);
  bringForward('second');
  expect(layerFor('second')).toBe(34+ids.length-1);
  expect(layerFor('seventh')).toBe(34+ids.length-2);
 });
 it('keeps remaining windows ranked in order when one closes',()=>{
  ids.forEach(bringForward);
  removeLayer('fourth');
  expect(layerFor('fifth')).toBe(34+3);
  expect(layerFor('third')).toBe(34+2);
  expect(layerFor('fourth')).toBe(34);
 });
 it('notifies subscribers when the order changes',()=>{
  const refresh=vi.fn(),unsubscribe=subscribeLayer(refresh);
  bringForward('first');removeLayer('first');unsubscribe();bringForward('second');
  expect(refresh).toHaveBeenCalledTimes(2);
 });
});
